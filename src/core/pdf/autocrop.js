import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { assertNotAborted, yieldToLoop } from './doc-loader.js';
import { mapVisualInsetsToUnrotatedPdf } from './geometry.js';

export { mapVisualInsetsToUnrotatedPdf };

/**
 * @typedef {Object} AutoCropOptions
 * @property {number} [paddingPt=12] - Padding to preserve around detected content in PostScript points
 * @property {number} [threshold=245] - Luminance threshold (0-255); pixels darker than this count as content
 * @property {'uniform'|'per-page'} [mode='uniform'] - Uniform union box or per-page tight crop
 * @property {number} [scanScale=0.75] - Rasterization scale used for margin scanning
 * @property {(percent: number, stage: string, current?: number, total?: number) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Scans RGBA ImageData from all 4 outer edges inward to detect non-whitespace content bounds.
 * Returns pixel insets `{ top, right, bottom, left }` or `null` if the entire page is blank.
 * @param {ImageData} imageData
 * @param {number} threshold
 * @returns {{ top: number, right: number, bottom: number, left: number }|null}
 */
export function detectWhitespaceInsetsFromImageData(imageData, threshold = 245) {
  const { width, height, data } = imageData;
  if (width <= 0 || height <= 0) return null;

  const isInk = (offset) => {
    const a = data[offset + 3];
    if (a < 16) return false;
    const lum = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
    return lum < threshold;
  };

  let minY = height;
  let maxY = -1;
  let minX = width;
  let maxX = -1;

  // Scan top-down for first ink row
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (isInk(rowStart + x * 4)) {
        minY = y;
        break;
      }
    }
    if (minY < height) break;
  }

  // Blank page (no ink found)
  if (minY >= height) return null;

  // Scan bottom-up for last ink row
  for (let y = height - 1; y >= minY; y -= 1) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (isInk(rowStart + x * 4)) {
        maxY = y;
        break;
      }
    }
    if (maxY >= 0) break;
  }

  // Scan left-to-right within [minY..maxY]
  for (let x = 0; x < width; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (isInk((y * width + x) * 4)) {
        minX = x;
        break;
      }
    }
    if (minX < width) break;
  }

  // Scan right-to-left within [minY..maxY]
  for (let x = width - 1; x >= minX; x -= 1) {
    for (let y = minY; y <= maxY; y += 1) {
      if (isInk((y * width + x) * 4)) {
        maxX = x;
        break;
      }
    }
    if (maxX >= 0) break;
  }

  return {
    top: minY,
    right: Math.max(0, width - 1 - maxX),
    bottom: Math.max(0, height - 1 - maxY),
    left: minX
  };
}

/**
 * Computes auto-crop margin insets (in unrotated PDF points) for target virtual pages
 * using OffscreenCanvas pixel luminance scanning.
 * @param {import('./pages.js').VirtualPageSpec[]} targetPages
 * @param {Map<string, import('./pages.js').SourceAssetInput>|Record<string, import('./pages.js').SourceAssetInput>} sourceMap
 * @param {AutoCropOptions} [options={}]
 * @returns {Promise<{ marginsByPageId: Record<string, import('./pages.js').CropMargins|null>, uniformMargins: import('./pages.js').CropMargins|null, scannedCount: number }>}
 */
export async function computeAutoCropMargins(targetPages, sourceMap, options = {}) {
  const {
    paddingPt = 12,
    threshold = 245,
    mode = 'uniform',
    scanScale = 0.75,
    onProgress,
    abortToken
  } = options;

  const safePadding = Math.max(0, Math.min(120, Number(paddingPt ?? 12)));
  const safeThreshold = Math.max(120, Math.min(254, Number(threshold ?? 245)));
  const safeScale = Math.max(0.35, Math.min(1.5, Number(scanScale) || 0.75));
  const getSource = (id) => (sourceMap instanceof Map ? sourceMap.get(id) : sourceMap[id]);

  /** @type {Map<string, import('pdfjs-dist').PDFDocumentProxy>} */
  const pdfjsDocs = new Map();
  /** @type {Record<string, import('./pages.js').CropMargins|null>} */
  const marginsByPageId = {};
  /** @type {import('./pages.js').CropMargins[]} */
  const detectedList = [];

  try {
    for (let i = 0; i < targetPages.length; i += 1) {
      assertNotAborted(abortToken);
      const vPage = targetPages[i];

      if (vPage.sourceFileId === '__blank__') {
        marginsByPageId[vPage.id] = null;
        continue;
      }

      const source = getSource(vPage.sourceFileId);
      if (!source) {
        marginsByPageId[vPage.id] = null;
        continue;
      }

      if (source.type === 'image') {
        const blob = new Blob([source.buffer], { type: source.mimeType || 'image/png' });
        const bmp = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        try {
          const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
          if (!ctx) {
            marginsByPageId[vPage.id] = null;
            continue;
          }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, bmp.width, bmp.height);
          ctx.drawImage(bmp, 0, 0);
          const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
          const pxInsets = detectWhitespaceInsetsFromImageData(imageData, safeThreshold);
          if (!pxInsets) {
            marginsByPageId[vPage.id] = null;
            continue;
          }
          const pdfInsets = {
            top: Math.max(0, Math.round(pxInsets.top - safePadding)),
            right: Math.max(0, Math.round(pxInsets.right - safePadding)),
            bottom: Math.max(0, Math.round(pxInsets.bottom - safePadding)),
            left: Math.max(0, Math.round(pxInsets.left - safePadding))
          };
          marginsByPageId[vPage.id] = pdfInsets;
          detectedList.push(pdfInsets);
        } finally {
          bmp.close();
          canvas.width = 0;
          canvas.height = 0;
        }
      } else {
        let doc = pdfjsDocs.get(source.id);
        if (!doc) {
          doc = await loadPdfJsInWorker(source.buffer, source.name);
          pdfjsDocs.set(source.id, doc);
        }

        const rendered = await renderPdfJsPageToCanvas(
          doc,
          vPage.sourcePageIndex,
          safeScale,
          vPage.rotation || 0
        );
        try {
          const imageData = rendered.ctx.getImageData(0, 0, rendered.width, rendered.height);
          const pxInsets = detectWhitespaceInsetsFromImageData(imageData, safeThreshold);
          if (!pxInsets) {
            marginsByPageId[vPage.id] = null;
            continue;
          }

          const baseVp = rendered.page.getViewport({ scale: 1, rotation: 0 });
          const maxCropW = Math.max(0, baseVp.width - 36);
          const maxCropH = Math.max(0, baseVp.height - 36);

          const visPt = {
            top: Math.max(0, pxInsets.top / rendered.scaleUsed - safePadding),
            right: Math.max(0, pxInsets.right / rendered.scaleUsed - safePadding),
            bottom: Math.max(0, pxInsets.bottom / rendered.scaleUsed - safePadding),
            left: Math.max(0, pxInsets.left / rendered.scaleUsed - safePadding)
          };

          const totalRot = (rendered.page.rotate || 0) + (vPage.rotation || 0);
          const rawUnrot = mapVisualInsetsToUnrotatedPdf(visPt, totalRot);

          // Ensure horizontal/vertical crop never collapses below 36pt
          const horizSum = rawUnrot.left + rawUnrot.right;
          const vertSum = rawUnrot.top + rawUnrot.bottom;
          const horizScale = horizSum > maxCropW && horizSum > 0 ? maxCropW / horizSum : 1;
          const vertScale = vertSum > maxCropH && vertSum > 0 ? maxCropH / vertSum : 1;

          const unrot = {
            top: Math.round(rawUnrot.top * vertScale),
            right: Math.round(rawUnrot.right * horizScale),
            bottom: Math.round(rawUnrot.bottom * vertScale),
            left: Math.round(rawUnrot.left * horizScale)
          };

          marginsByPageId[vPage.id] = unrot;
          detectedList.push(unrot);
        } finally {
          rendered.cleanup();
        }
      }

      onProgress?.(
        Math.round(((i + 1) / Math.max(1, targetPages.length)) * 95),
        `Scanning page ${i + 1} of ${targetPages.length} for margins...`,
        i + 1,
        targetPages.length
      );
      await yieldToLoop();
    }

    let uniformMargins = null;
    if (detectedList.length > 0) {
      uniformMargins = {
        top: Math.min(...detectedList.map((m) => m.top)),
        right: Math.min(...detectedList.map((m) => m.right)),
        bottom: Math.min(...detectedList.map((m) => m.bottom)),
        left: Math.min(...detectedList.map((m) => m.left))
      };
      if (mode === 'uniform') {
        for (const vPage of targetPages) {
          if (vPage.sourceFileId !== '__blank__' && marginsByPageId[vPage.id] !== undefined) {
            marginsByPageId[vPage.id] = { ...uniformMargins };
          }
        }
      }
    }

    onProgress?.(100, 'Auto-crop analysis complete.', targetPages.length, targetPages.length);
    return {
      marginsByPageId,
      uniformMargins,
      scannedCount: detectedList.length
    };
  } finally {
    for (const doc of pdfjsDocs.values()) {
      await destroyPdfJsDoc(doc);
    }
    pdfjsDocs.clear();
  }
}
