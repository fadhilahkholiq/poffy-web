import { formatBatesLabel } from '../utils/bates-format.js';
import { createZipArchive } from '../utils/zip.js';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { embedFontForText, parseHexColor } from './font-helper.js';

export { formatBatesLabel };

/**
 * @typedef {Object} NumberingConfig
 * @property {boolean} [enabled=true]
 * @property {string} [template='Page {n} of {total}'] - Format template supporting {n} and {total}
 * @property {number} [startNumber=1] - Starting number for first numbered page
 * @property {boolean} [skipCover=false] - Skip the very first page
 * @property {'bottom'|'top'} [placement='bottom'] - Vertical edge
 * @property {'left'|'center'|'right'} [alignment='center'] - Horizontal alignment
 * @property {number} [marginX=36] - Horizontal edge margin in points
 * @property {number} [marginY=24] - Vertical edge margin in points
 * @property {number} [fontSize=11] - Font size in points
 * @property {string} [fontFamily='Helvetica'] - Font family
 * @property {string} [color='#3a3a3a'] - Hex color
 * @property {number} [opacity=0.85] - Opacity (0-1)
 * @property {Uint8Array|ArrayBuffer|null} [fallbackFontBytes] - Optional local TTF bytes
 */

/**
 * @typedef {Object} BatesConfig
 * @property {string} [prefix='CASE-']
 * @property {string} [suffix='']
 * @property {number} [padding=5] - Zero-padding width for {counter:pad}
 * @property {number} [startNumber=1] - Global starting counter
 * @property {string} [template='{prefix}{counter:pad}{suffix}']
 * @property {'bottom'|'top'} [placement='bottom']
 * @property {'left'|'center'|'right'} [alignment='right']
 * @property {number} [marginX=36]
 * @property {number} [marginY=24]
 * @property {number} [fontSize=10]
 * @property {string} [fontFamily='Helvetica']
 * @property {string} [color='#1a1a1a']
 * @property {number} [opacity=0.9]
 * @property {boolean} [includeCsvManifest=true]
 * @property {boolean} [skipCover=false]
 * @property {Uint8Array|ArrayBuffer|null} [fallbackFontBytes]
 */

/**
 * Escapes a field value cleanly for RFC-4180 CSV output.
 * @param {string|number} val
 * @returns {string}
 */
function escapeCsvCell(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

/**
 * Computes (x, y) placement coordinates for a page header/footer or Bates stamp.
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {number} textWidth
 * @param {number} fontSize
 * @param {'top'|'bottom'} placement
 * @param {'left'|'center'|'right'} alignment
 * @param {number} marginX
 * @param {number} marginY
 * @returns {{ x: number, y: number }}
 */
function computeNumberCoordinates(
  pageWidth,
  pageHeight,
  textWidth,
  fontSize,
  placement,
  alignment,
  marginX,
  marginY
) {
  let x;
  if (alignment === 'left') {
    x = marginX;
  } else if (alignment === 'right') {
    x = Math.max(marginX, pageWidth - textWidth - marginX);
  } else {
    x = Math.max(marginX, (pageWidth - textWidth) / 2);
  }
  const y = placement === 'top' ? pageHeight - marginY - fontSize : marginY;
  return { x, y };
}

/**
 * Stamps page numbers / headers / footers onto an existing PDFDocument in place.
 * Preserves existing Single File / Workspace Export behavior.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {NumberingConfig} config - Numbering options
 * @param {{ onProgress?: (pct: number, stage: string, current?: number, total?: number) => void, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<import('pdf-lib').PDFDocument>}
 */
export async function applyPageNumbersToDocument(pdfDoc, config, options = {}) {
  if (!config || config.enabled === false) {
    return pdfDoc;
  }

  const { onProgress, abortToken } = options;
  const pages = pdfDoc.getPages();
  if (pages.length === 0) return pdfDoc;

  const template = String(config.template || 'Page {n} of {total}');
  const startNumber = Number.isFinite(Number(config.startNumber))
    ? Number(config.startNumber)
    : 1;
  const skipCover = Boolean(config.skipCover);
  const placement = config.placement === 'top' ? 'top' : 'bottom';
  const alignment = config.alignment || 'center';
  const marginX = Math.max(8, Number(config.marginX ?? 36));
  const marginY = Math.max(8, Number(config.marginY ?? 24));
  const fontSize = Math.max(6, Math.min(72, Number(config.fontSize ?? 11) || 11));
  const color = parseHexColor(config.color || '#3a3a3a');
  const opacity = Math.max(0.05, Math.min(1, Number(config.opacity ?? 0.85)));

  const startIndex = skipCover ? 1 : 0;
  const numberedCount = Math.max(0, pages.length - startIndex);
  if (numberedCount === 0) return pdfDoc;

  const sampleRendered = template
    .replaceAll('{n}', String(startNumber + numberedCount))
    .replaceAll('{total}', String(startNumber + numberedCount - 1));

  const { font } = await embedFontForText(
    pdfDoc,
    sampleRendered,
    config.fontFamily || 'Helvetica',
    config.fallbackFontBytes || null
  );

  const totalLabel = String(startNumber + numberedCount - 1);

  for (let idx = startIndex; idx < pages.length; idx += 1) {
    assertNotAborted(abortToken);
    const page = pages[idx];
    const { width, height } = page.getSize();
    const displayNum = startNumber + (idx - startIndex);
    const label = template
      .replaceAll('{n}', String(displayNum))
      .replaceAll('{total}', totalLabel);

    const textWidth = font.widthOfTextAtSize(label, fontSize);
    const { x, y } = computeNumberCoordinates(
      width,
      height,
      textWidth,
      fontSize,
      placement,
      alignment,
      marginX,
      marginY
    );

    page.drawText(label, {
      x,
      y,
      size: fontSize,
      font,
      color,
      opacity
    });

    if ((idx + 1) % 20 === 0) {
      onProgress?.(
        82 + Math.round(((idx + 1) / pages.length) * 10),
        'Adding page numbers...',
        idx + 1,
        pages.length
      );
      await yieldToLoop();
    }
  }

  return pdfDoc;
}

/**
 * Convenience standalone function that loads a PDF buffer, applies page numbers, and saves bytes.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {NumberingConfig} config
 * @returns {Promise<Uint8Array>}
 */
export async function numberPdfBuffer(pdfBytes, config) {
  const doc = await loadPdfSafe(pdfBytes);
  await applyPageNumbersToDocument(doc, config);
  return doc.save({ useObjectStreams: true });
}

/**
 * Batch Bates Numbering across an ordered queue of PDF files.
 * Maintains a continuous global counter across file boundaries and packages outputs
 * (plus an optional CSV manifest) into a single ZIP archive via fflate.
 * @param {{ id: string, name: string, buffer: ArrayBuffer|Uint8Array }[]} files
 * @param {BatesConfig} [config={}]
 * @param {{ onProgress?: (pct: number, stage: string, current?: number, total?: number) => void, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: Uint8Array, fileName: string, mimeType: 'application/zip', fileCount: number, totalPagesStamped: number, manifestRows: { filename: string, start_bates: string, end_bates: string, page_count: number }[] }>}
 */
export async function batchBatesNumbering(files, config = {}, options = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Add at least one PDF file to the Bates queue.');
  }

  const {
    prefix = 'CASE-',
    suffix = '',
    padding = 5,
    startNumber = 1,
    template = '{prefix}{counter:pad}{suffix}',
    placement = 'bottom',
    alignment = 'right',
    marginX = 36,
    marginY = 24,
    fontSize = 10,
    fontFamily = 'Helvetica',
    color = '#1a1a1a',
    opacity = 0.9,
    includeCsvManifest = true,
    skipCover = false,
    fallbackFontBytes = null
  } = config;

  const { onProgress, abortToken } = options;
  const safeStart = Math.max(0, Math.floor(Number(startNumber ?? 1)));
  const safePadding = Math.max(1, Math.min(12, Math.floor(Number(padding ?? 5))));
  const safeMarginX = Math.max(8, Number(marginX ?? 36));
  const safeMarginY = Math.max(8, Number(marginY ?? 24));
  const safeFontSize = Math.max(6, Math.min(72, Number(fontSize ?? 10) || 10));
  const parsedColor = parseHexColor(color);
  const safeOpacity = Math.max(0.05, Math.min(1, Number(opacity ?? 0.9)));
  const dateStr = new Date().toISOString().slice(0, 10);

  let globalCounter = safeStart;
  let totalPagesStamped = 0;

  /** @type {{ name: string, data: Uint8Array }[]} */
  const zipEntries = [];
  /** @type {{ filename: string, start_bates: string, end_bates: string, page_count: number }[]} */
  const manifestRows = [];

  for (let fIdx = 0; fIdx < files.length; fIdx += 1) {
    assertNotAborted(abortToken);
    const file = files[fIdx];
    const doc = await loadPdfSafe(file.buffer, file.name);
    const pages = doc.getPages();
    const stem = String(file.name || 'document').replace(/\.pdf$/i, '') || 'document';
    const startIdx = skipCover ? 1 : 0;

    if (pages.length > startIdx) {
      const sampleLabel = formatBatesLabel(template, {
        prefix,
        suffix,
        counter: globalCounter + pages.length,
        padding: safePadding,
        filename: stem,
        n: pages.length,
        total: pages.length,
        date: dateStr
      });

      const { font } = await embedFontForText(doc, sampleLabel, fontFamily, fallbackFontBytes);

      let firstBates = '';
      let lastBates = '';

      for (let pIdx = startIdx; pIdx < pages.length; pIdx += 1) {
        assertNotAborted(abortToken);
        const page = pages[pIdx];
        const { width, height } = page.getSize();
        const label = formatBatesLabel(template, {
          prefix,
          suffix,
          counter: globalCounter,
          padding: safePadding,
          filename: stem,
          n: pIdx + 1,
          total: pages.length,
          date: dateStr
        });

        if (!firstBates) firstBates = label;
        lastBates = label;

        const textWidth = font.widthOfTextAtSize(label, safeFontSize);
        const { x, y } = computeNumberCoordinates(
          width,
          height,
          textWidth,
          safeFontSize,
          placement === 'top' ? 'top' : 'bottom',
          alignment,
          safeMarginX,
          safeMarginY
        );

        page.drawText(label, {
          x,
          y,
          size: safeFontSize,
          font,
          color: parsedColor,
          opacity: safeOpacity
        });

        globalCounter += 1;
        totalPagesStamped += 1;

        if ((pIdx + 1) % 15 === 0) {
          await yieldToLoop();
        }
      }

      const stampedName = `${stem}_bates.pdf`;
      const bytes = await doc.save({ useObjectStreams: true });
      zipEntries.push({ name: stampedName, data: bytes });
      manifestRows.push({
        filename: stampedName,
        start_bates: firstBates,
        end_bates: lastBates,
        page_count: pages.length
      });
    } else {
      const stampedName = `${stem}_bates.pdf`;
      const bytes = await doc.save({ useObjectStreams: true });
      zipEntries.push({ name: stampedName, data: bytes });
      manifestRows.push({
        filename: stampedName,
        start_bates: '',
        end_bates: '',
        page_count: pages.length
      });
    }

    const pct = Math.round(((fIdx + 1) / files.length) * 90);
    onProgress?.(pct, `Stamped ${file.name} (${fIdx + 1}/${files.length})...`, fIdx + 1, files.length);
    await yieldToLoop();
  }

  if (includeCsvManifest) {
    const csvLines = [
      'filename,start_bates,end_bates,page_count',
      ...manifestRows.map((row) =>
        [
          escapeCsvCell(row.filename),
          escapeCsvCell(row.start_bates),
          escapeCsvCell(row.end_bates),
          escapeCsvCell(row.page_count)
        ].join(',')
      )
    ];
    zipEntries.push({
      name: 'bates_manifest.csv',
      data: new TextEncoder().encode(csvLines.join('\r\n') + '\r\n')
    });
  }

  assertNotAborted(abortToken);
  onProgress?.(95, 'Packaging Bates ZIP archive...', files.length, files.length);
  const zipBytes = createZipArchive(zipEntries, 1);
  onProgress?.(100, 'Batch Bates export ready.', files.length, files.length);

  return {
    buffer: zipBytes,
    fileName: 'poffy_bates_batch.zip',
    mimeType: 'application/zip',
    fileCount: files.length,
    totalPagesStamped,
    manifestRows
  };
}
