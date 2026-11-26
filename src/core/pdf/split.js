import { PDFDocument } from 'pdf-lib';
import { parsePageRange, parsePageRangeGroups } from '../utils/page-range.js';
import { createZipArchive } from '../utils/zip.js';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';

/**
 * @typedef {Object} SplitPartOutput
 * @property {string} name - Output PDF filename
 * @property {Uint8Array} data - Serialized PDF bytes
 */

/**
 * @typedef {Object} SplitOptions
 * @property {'ranges'|'extract'|'every_n'|'burst'} mode - Split strategy
 * @property {string} [rangeExpression=''] - Range string for 'ranges' or 'extract'
 * @property {number[]} [selectedIndices=[]] - Direct 0-based page indices for 'extract'
 * @property {number} [everyN=1] - Chunk size for 'every_n'
 * @property {string} [baseName='document'] - Base filename prefix
 * @property {string} [sourceName='document.pdf'] - Source label for error reporting
 * @property {(percent: number, stage: string) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Strips ".pdf" extension cleanly for naming derived split files.
 * @param {string} name - Original filename
 * @returns {string}
 */
function stripPdfExtension(name) {
  return String(name || 'document').replace(/\.pdf$/i, '') || 'document';
}

/**
 * Extracts a specific list of 0-based page indices into a new PDFDocument.
 * @param {PDFDocument} srcDoc - Parsed source PDF
 * @param {number[]} indices - 0-based page indices
 * @returns {Promise<Uint8Array>}
 */
async function buildSubDocument(srcDoc, indices) {
  const outDoc = await PDFDocument.create();
  const BATCH_SIZE = 20;
  for (let i = 0; i < indices.length; i += BATCH_SIZE) {
    const slice = indices.slice(i, i + BATCH_SIZE);
    const copied = await outDoc.copyPages(srcDoc, slice);
    for (const page of copied) {
      outDoc.addPage(page);
    }
    await yieldToLoop();
  }
  return outDoc.save({ useObjectStreams: true });
}

/**
 * Splits or extracts pages from a PDF buffer according to the requested mode.
 * Returns either a single PDF or a packaged ZIP archive when multiple files are produced.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Source PDF bytes
 * @param {SplitOptions} options - Split parameters
 * @returns {Promise<{ buffer: Uint8Array, fileName: string, mimeType: 'application/pdf'|'application/zip', fileCount: number }>}
 */
export async function splitPdf(pdfBytes, options) {
  const {
    mode,
    rangeExpression = '',
    selectedIndices = [],
    everyN = 1,
    baseName = 'document',
    sourceName = 'document.pdf',
    onProgress,
    abortToken
  } = options;

  assertNotAborted(abortToken);
  onProgress?.(10, 'Parsing PDF for split...');
  const srcDoc = await loadPdfSafe(pdfBytes, sourceName);
  const totalPages = srcDoc.getPageCount();
  if (totalPages === 0) {
    throw new Error('Source PDF has zero pages.');
  }

  const stem = stripPdfExtension(baseName);
  /** @type {{ name: string, indices: number[] }[]} */
  const groups = [];

  if (mode === 'extract') {
    const indices =
      selectedIndices.length > 0
        ? selectedIndices.filter((i) => i >= 0 && i < totalPages)
        : parsePageRange(rangeExpression, totalPages);
    if (indices.length === 0) {
      throw new Error('Select at least one page or specify a valid page range to extract.');
    }
    const bytes = await buildSubDocument(srcDoc, indices);
    onProgress?.(100, 'Extraction complete.');
    return {
      buffer: bytes,
      fileName: `${stem}_extracted.pdf`,
      mimeType: 'application/pdf',
      fileCount: 1
    };
  }

  if (mode === 'ranges') {
    const parsedGroups = parsePageRangeGroups(rangeExpression, totalPages);
    parsedGroups.forEach((indices, idx) => {
      const first = indices[0] + 1;
      const last = indices[indices.length - 1] + 1;
      const label = first === last ? `p${first}` : `p${first}-${last}`;
      groups.push({
        name: `${stem}_part${idx + 1}_${label}.pdf`,
        indices
      });
    });
  } else if (mode === 'every_n') {
    const step = Math.max(1, Math.floor(Number(everyN) || 1));
    const estimatedParts = Math.ceil(totalPages / step);
    if (estimatedParts > 2000) {
      throw new Error(`Split would generate ${estimatedParts} files (max 2000). Increase chunk size N.`);
    }
    let part = 1;
    for (let i = 0; i < totalPages; i += step) {
      const end = Math.min(i + step, totalPages);
      const indices = Array.from({ length: end - i }, (_, offset) => i + offset);
      groups.push({
        name: `${stem}_part${part}_p${i + 1}-${end}.pdf`,
        indices
      });
      part += 1;
    }
  } else if (mode === 'burst') {
    if (totalPages > 2000) {
      throw new Error(`Burst mode supports up to 2000 pages per archive (document has ${totalPages}).`);
    }
    const padWidth = String(totalPages).length;
    for (let i = 0; i < totalPages; i += 1) {
      const pageLabel = String(i + 1).padStart(padWidth, '0');
      groups.push({
        name: `${stem}_page_${pageLabel}.pdf`,
        indices: [i]
      });
    }
  } else {
    throw new Error(`Unsupported split mode: ${mode}`);
  }

  /** @type {SplitPartOutput[]} */
  const outputs = [];
  for (let i = 0; i < groups.length; i += 1) {
    assertNotAborted(abortToken);
    const group = groups[i];
    const data = await buildSubDocument(srcDoc, group.indices);
    outputs.push({ name: group.name, data });
    const pct = 15 + Math.round(((i + 1) / groups.length) * 75);
    onProgress?.(pct, `Splitting part ${i + 1} of ${groups.length}...`);
    await yieldToLoop();
  }

  if (outputs.length === 1) {
    onProgress?.(100, 'Split complete.');
    return {
      buffer: outputs[0].data,
      fileName: outputs[0].name,
      mimeType: 'application/pdf',
      fileCount: 1
    };
  }

  assertNotAborted(abortToken);
  onProgress?.(94, 'Packaging ZIP archive...');
  const zipBytes = createZipArchive(outputs, 1);
  onProgress?.(100, 'ZIP archive ready.');
  return {
    buffer: zipBytes,
    fileName: `${stem}_split.zip`,
    mimeType: 'application/zip',
    fileCount: outputs.length
  };
}
