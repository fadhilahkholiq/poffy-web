import { PDFDocument, degrees } from 'pdf-lib';
import { PAGE_SIZES, assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';

/**
 * @typedef {Object} CropMargins
 * @property {number} top - Top margin crop in points
 * @property {number} right - Right margin crop in points
 * @property {number} bottom - Bottom margin crop in points
 * @property {number} left - Left margin crop in points
 */

/**
 * @typedef {Object} VirtualPageSpec
 * @property {string} id - Unique virtual page UUID
 * @property {string} sourceFileId - SourceFileEntry ID or '__blank__'
 * @property {number} sourcePageIndex - 0-based index in source PDF (0 for images/blanks)
 * @property {0|90|180|270} rotation - Cumulative clockwise rotation in degrees
 * @property {CropMargins|null} [cropMargins] - Optional margin crop insets in points
 * @property {{ width?: number, height?: number, preset?: 'a4'|'letter'|'legal' }} [blankSpec]
 */

/**
 * @typedef {Object} SourceAssetInput
 * @property {string} id - SourceFileEntry ID
 * @property {string} name - Original filename
 * @property {'pdf'|'image'} type - Asset type
 * @property {string} [mimeType] - Image MIME type when type === 'image'
 * @property {ArrayBuffer|Uint8Array} buffer - Raw asset bytes (or PNG-normalized bytes for WebP images)
 */

/**
 * Applies margin cropping safely to both MediaBox and CropBox of a PDFPage.
 * @param {import('pdf-lib').PDFPage} page - Target PDF page
 * @param {CropMargins} margins - Crop insets in points
 */
export function applyCropMarginsToPage(page, margins) {
  if (!margins) return;
  const top = Math.max(0, Number(margins.top) || 0);
  const right = Math.max(0, Number(margins.right) || 0);
  const bottom = Math.max(0, Number(margins.bottom) || 0);
  const left = Math.max(0, Number(margins.left) || 0);

  if (top === 0 && right === 0 && bottom === 0 && left === 0) return;

  const box = page.getMediaBox();
  const minSize = 24;
  const newWidth = Math.max(minSize, box.width - left - right);
  const newHeight = Math.max(minSize, box.height - top - bottom);
  const newX = box.x + Math.min(left, Math.max(0, box.width - minSize));
  const newY = box.y + Math.min(bottom, Math.max(0, box.height - minSize));

  page.setMediaBox(newX, newY, newWidth, newHeight);
  page.setCropBox(newX, newY, newWidth, newHeight);
}

/**
 * Normalizes any degree angle to 0, 90, 180, or 270.
 * @param {number} angle - Angle in degrees
 * @returns {number}
 */
export function normalizeRotation(angle) {
  return ((Math.round(angle) % 360) + 360) % 360;
}

/**
 * Embeds an image source as a single fitted PDFPage inside outDoc.
 * Expects PNG or JPEG bytes (WebP should be normalized to PNG before calling).
 * @param {PDFDocument} outDoc - Output PDF document
 * @param {SourceAssetInput} asset - Image asset
 * @returns {Promise<import('pdf-lib').PDFPage>}
 */
async function appendImageAsPage(outDoc, asset) {
  const bytes = asset.buffer instanceof Uint8Array ? asset.buffer : new Uint8Array(asset.buffer);
  const isPng =
    asset.mimeType === 'image/png' ||
    asset.name.toLowerCase().endsWith('.png') ||
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47);

  const embedded = isPng ? await outDoc.embedPng(bytes) : await outDoc.embedJpg(bytes);
  const dims = embedded.scale(1);
  const page = outDoc.addPage([dims.width, dims.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: dims.width,
    height: dims.height
  });
  return page;
}

/**
 * Compiles a PDFDocument from an ordered array of VirtualPage descriptors and SourceAssetInput map.
 * Caches parsed source PDFDocuments for the duration of the job.
 * @param {VirtualPageSpec[]} virtualPages - Ordered workspace pages
 * @param {Map<string, SourceAssetInput>|Record<string, SourceAssetInput>} sourceMap - Source registry
 * @param {Object} [options={}]
 * @param {(percent: number, stage: string) => void} [options.onProgress]
 * @param {{ aborted?: boolean }} [options.abortToken]
 * @returns {Promise<PDFDocument>} Compiled PDFDocument ready for overlays/serialization
 */
export async function compileVirtualPagesToDocument(virtualPages, sourceMap, options = {}) {
  if (!Array.isArray(virtualPages) || virtualPages.length === 0) {
    throw new Error('Workspace has no pages to compile.');
  }

  const { onProgress, abortToken } = options;
  const getSource = (id) =>
    sourceMap instanceof Map ? sourceMap.get(id) : sourceMap[id];

  const outputDoc = await PDFDocument.create();
  /** @type {Map<string, PDFDocument>} */
  const parsedPdfCache = new Map();

  const BATCH_SIZE = 12;
  for (let i = 0; i < virtualPages.length; i += 1) {
    assertNotAborted(abortToken);
    const vPage = virtualPages[i];
    let createdPage;

    if (vPage.sourceFileId === '__blank__') {
      const preset = vPage.blankSpec?.preset || 'a4';
      const [defaultW, defaultH] = PAGE_SIZES[preset] || PAGE_SIZES.a4;
      const width = Number(vPage.blankSpec?.width) || defaultW;
      const height = Number(vPage.blankSpec?.height) || defaultH;
      createdPage = outputDoc.addPage([width, height]);
    } else {
      const source = getSource(vPage.sourceFileId);
      if (!source) {
        throw new Error(`Missing source asset "${vPage.sourceFileId}" for page ${i + 1}.`);
      }

      if (source.type === 'image') {
        createdPage = await appendImageAsPage(outputDoc, source);
      } else {
        let srcDoc = parsedPdfCache.get(source.id);
        if (!srcDoc) {
          srcDoc = await loadPdfSafe(source.buffer, source.name);
          parsedPdfCache.set(source.id, srcDoc);
        }
        const [copied] = await outputDoc.copyPages(srcDoc, [vPage.sourcePageIndex]);
        createdPage = outputDoc.addPage(copied);
      }
    }

    if (vPage.rotation) {
      const existing = createdPage.getRotation().angle || 0;
      createdPage.setRotation(degrees(normalizeRotation(existing + vPage.rotation)));
    }

    if (vPage.cropMargins) {
      applyCropMarginsToPage(createdPage, vPage.cropMargins);
    }

    if ((i + 1) % BATCH_SIZE === 0 || i === virtualPages.length - 1) {
      const pct = Math.round(((i + 1) / virtualPages.length) * 60);
      onProgress?.(pct, `Assembling page ${i + 1} of ${virtualPages.length}...`);
      await yieldToLoop();
    }
  }

  return outputDoc;
}

/**
 * Inserts a blank page into a standalone PDF buffer at the requested index.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Input PDF
 * @param {number} insertAtIndex - 0-based insertion position
 * @param {'a4'|'letter'|'legal'|'match'} [sizePreset='a4'] - Blank page dimensions
 * @returns {Promise<Uint8Array>}
 */
export async function insertBlankPage(pdfBytes, insertAtIndex, sizePreset = 'a4') {
  const doc = await loadPdfSafe(pdfBytes);
  const count = doc.getPageCount();
  const safeIndex = Math.max(0, Math.min(insertAtIndex, count));

  let dims = PAGE_SIZES.a4;
  if (sizePreset === 'match' && count > 0) {
    const refPage = doc.getPage(Math.min(safeIndex, count - 1));
    const { width, height } = refPage.getSize();
    dims = [width, height];
  } else if (sizePreset !== 'match' && PAGE_SIZES[sizePreset]) {
    dims = PAGE_SIZES[sizePreset];
  }

  doc.insertPage(safeIndex, dims);
  return doc.save({ useObjectStreams: true });
}
