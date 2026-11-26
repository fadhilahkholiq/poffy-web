import {
  destroyPdfJsDoc,
  loadPdfJsInWorker
} from '../render/pdfjs-worker-runtime.js';
import { parsePageRange } from '../utils/page-range.js';
import { createZipArchive } from '../utils/zip.js';
import { assertNotAborted, yieldToLoop } from './doc-loader.js';

/**
 * Reconstructs ordered lines, paragraph breaks, and inferred Markdown headings from
 * `pdfjs-dist` `page.getTextContent()` items using Y-bucket + X-sort layout geometry.
 * @param {any[]} rawItems
 * @returns {{ lines: { text: string, y: number, fontSize: number, gapBefore: number, isHeading: boolean, headingLevel: 0|1|2 }[], items: { text: string, x: number, y: number, width: number, height: number, fontName: string }[], bodyFontSize: number, charCount: number }}
 */
export function analyzeTextLayoutItems(rawItems = []) {
  const spans = rawItems
    .filter((it) => typeof it?.str === 'string' && it.str.length > 0)
    .map((it) => {
      const tr = it.transform || [10, 0, 0, 10, 0, 0];
      const fontHeight = Math.max(
        1,
        Number(it.height) || Math.hypot(Number(tr[0]) || 0, Number(tr[1]) || 0) || 10
      );
      return {
        text: it.str,
        x: Number(tr[4] ?? 0),
        y: Number(tr[5] ?? 0),
        width: Math.max(0, Number(it.width ?? 0)),
        height: fontHeight,
        fontName: String(it.fontName || '')
      };
    });

  if (spans.length === 0) {
    return { lines: [], items: [], bodyFontSize: 12, charCount: 0 };
  }

  // Compute dominant body font height weighted by non-whitespace character count
  const charWeightsBySize = new Map();
  for (const s of spans) {
    const bucket = Math.round(s.height * 2) / 2;
    const w = Math.max(1, s.text.trim().length);
    charWeightsBySize.set(bucket, (charWeightsBySize.get(bucket) || 0) + w);
  }
  let bodyFontSize = 12;
  let maxCharsForSize = -1;
  for (const [sz, weight] of charWeightsBySize.entries()) {
    if (weight > maxCharsForSize) {
      maxCharsForSize = weight;
      bodyFontSize = sz;
    }
  }
  const yBucketTol = Math.max(2.5, bodyFontSize * 0.35);

  // Group into lines using Y proximity, then sort spans left-to-right within each line
  spans.sort((a, b) => {
    if (Math.abs(a.y - b.y) > yBucketTol) return b.y - a.y;
    return a.x - b.x;
  });

  /** @type {typeof spans[]} */
  const lineGroups = [];
  let currentGroup = [spans[0]];
  let currentY = spans[0].y;

  for (let i = 1; i < spans.length; i += 1) {
    const s = spans[i];
    if (Math.abs(s.y - currentY) > yBucketTol) {
      lineGroups.push(currentGroup);
      currentGroup = [s];
      currentY = s.y;
    } else {
      currentGroup.push(s);
    }
  }
  lineGroups.push(currentGroup);

  const builtLines = [];
  for (const group of lineGroups) {
    group.sort((a, b) => a.x - b.x);
    let lineText = '';
    let weightedHeightSum = 0;
    let charWeight = 0;

    for (let i = 0; i < group.length; i += 1) {
      const seg = group[i];
      if (i > 0) {
        const prev = group[i - 1];
        const prevEndX = prev.x + prev.width;
        const gap = seg.x - prevEndX;
        if (
          !prev.text.endsWith(' ') &&
          !seg.text.startsWith(' ') &&
          gap > Math.max(1.2, seg.height * 0.16)
        ) {
          lineText += ' ';
        }
      }
      lineText += seg.text;
      const len = seg.text.trim().length;
      weightedHeightSum += seg.height * len;
      charWeight += len;
    }

    const cleaned = lineText.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const avgHeight = charWeight > 0 ? weightedHeightSum / charWeight : group[0].height;
    builtLines.push({
      text: cleaned,
      y: group[0].y,
      fontSize: avgHeight,
      gapBefore: 0,
      isHeading: false,
      headingLevel: /** @type {0|1|2} */ (0)
    });
  }

  // Compute inter-line vertical gaps to detect paragraph breaks
  const gaps = [];
  for (let i = 1; i < builtLines.length; i += 1) {
    const g = builtLines[i - 1].y - builtLines[i].y;
    if (g > 0) {
      builtLines[i].gapBefore = g;
      gaps.push(g);
    }
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianLineStep =
    sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : bodyFontSize * 1.25;

  for (const line of builtLines) {
    const ratio = line.fontSize / Math.max(1, bodyFontSize);
    if (line.text.length <= 120 && ratio >= 1.65) {
      line.isHeading = true;
      line.headingLevel = 1;
    } else if (line.text.length <= 120 && ratio >= 1.2) {
      line.isHeading = true;
      line.headingLevel = 2;
    }
    line.isParagraphBreak = line.gapBefore > medianLineStep * 1.5;
  }

  const charCount = builtLines.reduce((acc, l) => acc + l.text.length, 0);
  return {
    lines: builtLines,
    items: spans,
    bodyFontSize,
    charCount
  };
}

/**
 * Formats analyzed per-page text data into `.txt`, `.md`, or `.json`.
 * @param {{ pageNumber: number, lines: any[], items: any[], charCount: number }[]} pageResults
 * @param {'txt'|'md'|'json'} format
 * @param {boolean} [includePageMarkers=true]
 * @returns {string}
 */
export function formatExtractedDocumentText(pageResults, format = 'txt', includePageMarkers = true) {
  if (format === 'json') {
    return JSON.stringify(
      {
        pageCount: pageResults.length,
        pages: pageResults.map((p) => ({
          page: p.pageNumber,
          charCount: p.charCount,
          text: p.lines.map((l) => l.text).join('\n'),
          items: p.items
        }))
      },
      null,
      2
    );
  }

  const sections = [];
  for (const p of pageResults) {
    const parts = [];
    if (includePageMarkers) {
      parts.push(format === 'md' ? `<!-- Page ${p.pageNumber} -->` : `--- Page ${p.pageNumber} ---`);
    }
    for (let i = 0; i < p.lines.length; i += 1) {
      const l = p.lines[i];
      if (i > 0 && (l.isParagraphBreak || l.isHeading)) {
        parts.push('');
      }
      if (format === 'md' && l.isHeading) {
        parts.push(`${l.headingLevel === 1 ? '#' : '##'} ${l.text}`);
      } else {
        parts.push(l.text);
      }
    }
    sections.push(parts.join('\n'));
  }

  return sections.join('\n\n').trim();
}

/**
 * Extracts readable structured text from a single PDF buffer using `pdfjs-dist`.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [config={}]
 * @param {'txt'|'md'|'json'} [config.format='txt']
 * @param {string} [config.rangeExpression='all']
 * @param {boolean} [config.includePageMarkers=true]
 * @param {string} [fileName='']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 */
export async function extractTextFromPdfBuffer(pdfBytes, config = {}, fileName = '', options = {}) {
  const { format = 'txt', rangeExpression = 'all', includePageMarkers = true } = config;
  const { onProgress, abortToken } = options;

  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);
  try {
    const totalPages = pdfjsDoc.numPages;
    const indices = parsePageRange(rangeExpression || 'all', totalPages);
    const pageResults = [];
    let totalChars = 0;

    for (let i = 0; i < indices.length; i += 1) {
      assertNotAborted(abortToken);
      const pageIdx = indices[i];
      const page = await pdfjsDoc.getPage(pageIdx + 1);
      try {
        const content = await page.getTextContent();
        const analyzed = analyzeTextLayoutItems(content.items || []);
        totalChars += analyzed.charCount;
        pageResults.push({
          pageNumber: pageIdx + 1,
          ...analyzed
        });
      } finally {
        page.cleanup();
      }

      onProgress?.(
        Math.round(((i + 1) / Math.max(1, indices.length)) * 95),
        `Extracting text from page ${i + 1} of ${indices.length}...`,
        i + 1,
        indices.length
      );
      await yieldToLoop();
    }

    const formatted = formatExtractedDocumentText(pageResults, format, includePageMarkers);
    const avgCharsPerPage = indices.length > 0 ? totalChars / indices.length : 0;
    const likelyScanned = totalChars < 12 || avgCharsPerPage < 15;

    onProgress?.(100, 'Text extraction complete.', indices.length, indices.length);
    return {
      text: formatted,
      totalChars,
      pagesExtracted: indices.length,
      totalPages,
      likelyScanned,
      format
    };
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}

/**
 * Batch extracts text from multiple PDFs and bundles results into a single `.zip` via `fflate`.
 * @param {{ name: string, buffer: ArrayBuffer|Uint8Array }[]} files
 * @param {{ format?: 'txt'|'md'|'json', rangeExpression?: string, includePageMarkers?: boolean }} [config={}]
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 */
export async function batchExtractTextZip(files, config = {}, options = {}) {
  const { onProgress, abortToken } = options;
  const format = config.format || 'txt';
  const ext = format === 'md' ? 'md' : format === 'json' ? 'json' : 'txt';
  const encoder = new TextEncoder();
  const zipEntries = [];
  let scannedCount = 0;

  for (let i = 0; i < files.length; i += 1) {
    assertNotAborted(abortToken);
    const file = files[i];
    const res = await extractTextFromPdfBuffer(file.buffer, config, file.name, {
      abortToken,
      onProgress: (pct, stage) =>
        onProgress?.(
          Math.round(((i + pct / 100) / files.length) * 92),
          `${file.name}: ${stage}`,
          i + 1,
          files.length
        )
    });
    if (res.likelyScanned) scannedCount += 1;
    const base = file.name.replace(/\.pdf$/i, '') || `document_${i + 1}`;
    zipEntries.push({
      name: `${base}.${ext}`,
      data: encoder.encode(res.text)
    });
  }

  assertNotAborted(abortToken);
  onProgress?.(96, 'Packaging text files into ZIP...', files.length, files.length);
  const zipBytes = createZipArchive(zipEntries, 6);
  onProgress?.(100, 'Batch text ZIP ready.', files.length, files.length);

  return {
    buffer: zipBytes,
    fileName: `poffy_extracted_text_${ext}.zip`,
    mimeType: 'application/zip',
    fileCount: files.length,
    scannedCount
  };
}
