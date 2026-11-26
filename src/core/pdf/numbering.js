import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { embedFontForText, parseHexColor } from './font-helper.js';

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
 * Stamps page numbers / headers / footers onto an existing PDFDocument in place.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {NumberingConfig} config - Numbering options
 * @param {{ onProgress?: (pct: number, stage: string) => void, abortToken?: { aborted?: boolean } }} [options={}]
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
    let x;
    if (alignment === 'left') {
      x = marginX;
    } else if (alignment === 'right') {
      x = Math.max(marginX, width - textWidth - marginX);
    } else {
      x = Math.max(marginX, (width - textWidth) / 2);
    }

    const y = placement === 'top' ? height - marginY - fontSize : marginY;

    page.drawText(label, {
      x,
      y,
      size: fontSize,
      font,
      color,
      opacity
    });

    if ((idx + 1) % 20 === 0) {
      onProgress?.(82 + Math.round(((idx + 1) / pages.length) * 10), 'Adding page numbers...');
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
