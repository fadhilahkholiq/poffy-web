import { PDFDocument } from 'pdf-lib';
import { createZipArchive } from '../utils/zip.js';
import { PAGE_SIZES, assertNotAborted, yieldToLoop } from './doc-loader.js';

/**
 * @typedef {Object} ImageToPdfItem
 * @property {string} name - Original filename
 * @property {string} [mimeType] - Image MIME type
 * @property {ArrayBuffer|Uint8Array} buffer - Raw image bytes
 */

/**
 * @typedef {Object} ImagesToPdfOptions
 * @property {'original'|'a4'|'letter'} [pageFit='a4'] - Page sizing mode
 * @property {number} [margin=24] - Margin in points when fitting to standard page size
 * @property {(percent: number, stage: string) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Detects image format from MIME type, filename, or magic bytes.
 * @param {Uint8Array} bytes
 * @param {string} [mimeType='']
 * @param {string} [fileName='']
 * @returns {'png'|'jpg'|'webp'}
 */
export function detectImageFormat(bytes, mimeType = '', fileName = '') {
  const mime = mimeType.toLowerCase();
  const name = fileName.toLowerCase();

  if (
    mime === 'image/png' ||
    name.endsWith('.png') ||
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
  ) {
    return 'png';
  }
  if (
    mime === 'image/webp' ||
    name.endsWith('.webp') ||
    (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
  ) {
    return 'webp';
  }
  return 'jpg';
}

/**
 * Normalizes WebP (or other browser-decodable raster bytes) to PNG bytes via OffscreenCanvas
 * so pdf-lib can embed it purely inside a Web Worker or main thread without DOM elements.
 * @param {ArrayBuffer|Uint8Array} rawBytes - Input image bytes
 * @param {string} [mimeType=''] - Original MIME type
 * @param {string} [fileName=''] - Original filename
 * @returns {Promise<{ bytes: Uint8Array, format: 'png'|'jpg' }>}
 */
export async function normalizeImageForPdf(rawBytes, mimeType = '', fileName = '') {
  const uint8 = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  const detected = detectImageFormat(uint8, mimeType, fileName);
  if (detected === 'png' || detected === 'jpg') {
    return { bytes: uint8, format: detected };
  }

  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    throw new Error('OffscreenCanvas is required to convert WebP images to PDF.');
  }

  const blob = new Blob([uint8], { type: mimeType || 'image/webp' });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to acquire 2D context on OffscreenCanvas.');
    }
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    const pngBuffer = await pngBlob.arrayBuffer();
    return { bytes: new Uint8Array(pngBuffer), format: 'png' };
  } finally {
    bitmap.close();
  }
}

/**
 * Batch converts JPG, PNG, and WebP images into a single PDF document.
 * @param {ImageToPdfItem[]} items - Ordered image inputs
 * @param {ImagesToPdfOptions} [options={}] - Conversion options
 * @returns {Promise<Uint8Array>} Serialized PDF bytes
 */
export async function imagesToPdf(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one image is required to create a PDF.');
  }

  const { pageFit = 'a4', margin = 24, onProgress, abortToken } = options;
  const pdfDoc = await PDFDocument.create();

  for (let i = 0; i < items.length; i += 1) {
    assertNotAborted(abortToken);
    const item = items[i];
    const { bytes, format } = await normalizeImageForPdf(item.buffer, item.mimeType, item.name);
    const embedded = format === 'png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
    const imgDims = embedded.scale(1);

    if (pageFit === 'original') {
      const page = pdfDoc.addPage([imgDims.width, imgDims.height]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: imgDims.width,
        height: imgDims.height
      });
    } else {
      const [pageW, pageH] = PAGE_SIZES[pageFit] || PAGE_SIZES.a4;
      const safeMargin = Math.max(0, Math.min(margin, Math.min(pageW, pageH) * 0.3));
      const availW = pageW - safeMargin * 2;
      const availH = pageH - safeMargin * 2;
      const scale = Math.min(availW / imgDims.width, availH / imgDims.height, 1);
      const drawW = imgDims.width * scale;
      const drawH = imgDims.height * scale;
      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(embedded, {
        x: (pageW - drawW) / 2,
        y: (pageH - drawH) / 2,
        width: drawW,
        height: drawH
      });
    }

    onProgress?.(Math.round(((i + 1) / items.length) * 85), `Embedding image ${i + 1} of ${items.length}...`);
    await yieldToLoop();
  }

  assertNotAborted(abortToken);
  onProgress?.(94, 'Saving PDF...');
  return pdfDoc.save({ useObjectStreams: true });
}

/**
 * Packages rasterized PDF page images into either a single image file or a ZIP archive.
 * @param {{ pageNumber: number, bytes: Uint8Array, ext: 'png'|'jpg'|'webp', mimeType: string }[]} images
 * @param {string} [baseName='document']
 * @returns {{ buffer: Uint8Array, fileName: string, mimeType: string }}
 */
export function packageRasterizedImages(images, baseName = 'document') {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('No rendered page images to package.');
  }
  const stem = String(baseName || 'document').replace(/\.pdf$/i, '') || 'document';

  if (images.length === 1) {
    const only = images[0];
    return {
      buffer: only.bytes,
      fileName: `${stem}_page_${only.pageNumber}.${only.ext}`,
      mimeType: only.mimeType
    };
  }

  const padWidth = String(Math.max(...images.map((im) => im.pageNumber))).length;
  const entries = images.map((im) => ({
    name: `${stem}_page_${String(im.pageNumber).padStart(padWidth, '0')}.${im.ext}`,
    data: im.bytes
  }));

  return {
    buffer: createZipArchive(entries, 0),
    fileName: `${stem}_images.zip`,
    mimeType: 'application/zip'
  };
}
