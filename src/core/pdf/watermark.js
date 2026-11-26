import { degrees } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { embedFontForText, parseHexColor } from './font-helper.js';

/**
 * @typedef {Object} TextWatermarkConfig
 * @property {'text'} kind
 * @property {boolean} [enabled=true]
 * @property {string} text - Watermark text
 * @property {number} [opacity=0.25] - Opacity between 0 and 1
 * @property {string} [fontFamily='HelveticaBold'] - Font family
 * @property {number} [fontSize=48] - Font size in points
 * @property {string} [color='#0a0a0a'] - Hex color
 * @property {number} [rotation=-35] - Rotation angle in degrees
 * @property {'center'|'top-left'|'top-right'|'bottom-left'|'bottom-right'|'tiled'} [position='center']
 * @property {number} [tileGap=140] - Spacing between diagonal tiles in points
 * @property {number[]} [pageIndices] - Optional 0-based target page indices (defaults to all)
 * @property {Uint8Array|ArrayBuffer|null} [fallbackFontBytes] - Optional local TTF bytes
 */

/**
 * @typedef {Object} ImageWatermarkConfig
 * @property {'image'} kind
 * @property {boolean} [enabled=true]
 * @property {ArrayBuffer|Uint8Array} imageBytes - PNG or JPG image bytes
 * @property {'png'|'jpg'} imageFormat - Image format
 * @property {number} [scale=0.3] - Fraction of page width (0.05 to 1.0), aspect ratio locked
 * @property {number} [opacity=0.35] - Opacity between 0 and 1
 * @property {'center'|'top-left'|'top-right'|'bottom-left'|'bottom-right'} [position='bottom-right']
 * @property {number} [margin=36] - Edge margin in points
 * @property {number[]} [pageIndices] - Optional 0-based target page indices
 */

/**
 * Computes (x, y) anchor coordinates inside a page box for non-tiled placement.
 * @param {number} pageWidth
 * @param {number} pageHeight
 * @param {number} itemWidth
 * @param {number} itemHeight
 * @param {string} position
 * @param {number} margin
 * @returns {{ x: number, y: number }}
 */
function computeAnchorPosition(pageWidth, pageHeight, itemWidth, itemHeight, position, margin = 36) {
  switch (position) {
    case 'top-left':
      return { x: margin, y: pageHeight - itemHeight - margin };
    case 'top-right':
      return { x: pageWidth - itemWidth - margin, y: pageHeight - itemHeight - margin };
    case 'bottom-left':
      return { x: margin, y: margin };
    case 'bottom-right':
      return { x: pageWidth - itemWidth - margin, y: margin };
    case 'center':
    default:
      return {
        x: (pageWidth - itemWidth) / 2,
        y: (pageHeight - itemHeight) / 2
      };
  }
}

/**
 * Applies a text or image watermark onto an already-loaded PDFDocument in place.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {TextWatermarkConfig|ImageWatermarkConfig} config - Watermark configuration
 * @param {{ onProgress?: (pct: number, stage: string) => void, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<import('pdf-lib').PDFDocument>}
 */
export async function applyWatermarkToDocument(pdfDoc, config, options = {}) {
  if (!config || config.enabled === false) {
    return pdfDoc;
  }

  const { onProgress, abortToken } = options;
  const pages = pdfDoc.getPages();
  const targetIndices =
    Array.isArray(config.pageIndices) && config.pageIndices.length > 0
      ? config.pageIndices.filter((idx) => idx >= 0 && idx < pages.length)
      : pages.map((_, idx) => idx);

  if (targetIndices.length === 0) {
    return pdfDoc;
  }

  if (config.kind === 'image') {
    const rawBytes =
      config.imageBytes instanceof Uint8Array
        ? config.imageBytes
        : new Uint8Array(config.imageBytes);
    if (rawBytes.byteLength === 0) {
      throw new Error('Image watermark file is empty.');
    }

    const embedded =
      config.imageFormat === 'png'
        ? await pdfDoc.embedPng(rawBytes)
        : await pdfDoc.embedJpg(rawBytes);

    const scaleRatio = Math.max(0.05, Math.min(1, Number(config.scale ?? 0.3) || 0.3));
    const opacity = Math.max(0.02, Math.min(1, Number(config.opacity ?? 0.35)));
    const margin = Math.max(0, Number(config.margin ?? 36));
    const position = config.position || 'bottom-right';
    const aspect = embedded.height / Math.max(1, embedded.width);

    for (let i = 0; i < targetIndices.length; i += 1) {
      assertNotAborted(abortToken);
      const page = pages[targetIndices[i]];
      const { width, height } = page.getSize();
      const drawWidth = width * scaleRatio;
      const drawHeight = drawWidth * aspect;
      const { x, y } = computeAnchorPosition(width, height, drawWidth, drawHeight, position, margin);

      page.drawImage(embedded, {
        x,
        y,
        width: drawWidth,
        height: drawHeight,
        opacity
      });

      if ((i + 1) % 10 === 0) {
        onProgress?.(65 + Math.round(((i + 1) / targetIndices.length) * 20), 'Stamping image watermark...');
        await yieldToLoop();
      }
    }
    return pdfDoc;
  }

  // Text watermark
  const text = String(config.text ?? '').trim();
  if (!text) {
    return pdfDoc;
  }

  const fontSize = Math.max(8, Math.min(200, Number(config.fontSize ?? 48) || 48));
  const opacity = Math.max(0.02, Math.min(1, Number(config.opacity ?? 0.25)));
  const rotation = Number(config.rotation ?? 0) || 0;
  const color = parseHexColor(config.color || '#0a0a0a');
  const position = config.position || 'center';
  const tileGap = Math.max(40, Number(config.tileGap ?? 140) || 140);

  const { font } = await embedFontForText(
    pdfDoc,
    text,
    config.fontFamily || 'HelveticaBold',
    config.fallbackFontBytes || null
  );

  const lines = text.split(/\r?\n/);
  const lineWidths = lines.map((line) => font.widthOfTextAtSize(line, fontSize));
  const textWidth = Math.max(...lineWidths, 10);
  const textHeight = fontSize * lines.length * 1.15;

  for (let i = 0; i < targetIndices.length; i += 1) {
    assertNotAborted(abortToken);
    const page = pages[targetIndices[i]];
    const { width, height } = page.getSize();

    if (position === 'tiled') {
      const stepX = textWidth + tileGap;
      const stepY = textHeight + tileGap;
      for (let y = -height * 0.2; y < height * 1.2; y += stepY) {
        for (let x = -width * 0.2; x < width * 1.2; x += stepX) {
          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color,
            opacity,
            rotate: degrees(rotation),
            lineHeight: fontSize * 1.15
          });
        }
      }
    } else if (position === 'center') {
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const centerX = width / 2;
      const centerY = height / 2;
      const halfW = textWidth / 2;
      const halfH = textHeight / 3;
      page.drawText(text, {
        x: centerX - (halfW * cos - halfH * sin),
        y: centerY - (halfW * sin + halfH * cos),
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(rotation),
        lineHeight: fontSize * 1.15
      });
    } else {
      const { x, y } = computeAnchorPosition(width, height, textWidth, textHeight, position, 36);
      page.drawText(text, {
        x,
        y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(rotation),
        lineHeight: fontSize * 1.15
      });
    }

    if ((i + 1) % 10 === 0) {
      onProgress?.(65 + Math.round(((i + 1) / targetIndices.length) * 20), 'Embedding watermarks...');
      await yieldToLoop();
    }
  }

  return pdfDoc;
}

/**
 * Convenience standalone function that loads a PDF buffer, applies watermark, and saves bytes.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {TextWatermarkConfig|ImageWatermarkConfig} config
 * @returns {Promise<Uint8Array>}
 */
export async function watermarkPdfBuffer(pdfBytes, config) {
  const doc = await loadPdfSafe(pdfBytes);
  await applyWatermarkToDocument(doc, config);
  return doc.save({ useObjectStreams: true });
}
