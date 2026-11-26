import { PDFDocument } from 'pdf-lib';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { assertNotAborted, yieldToLoop } from './doc-loader.js';

/**
 * @typedef {'grayscale'|'invert'|'cleanup'} ColorFilterPreset
 */

/**
 * @typedef {Object} ColorFilterConfig
 * @property {ColorFilterPreset} [preset='grayscale']
 * @property {'pure'|'slate'|'sepia'} [invertVariant='slate']
 * @property {number} [contrast=1.2] - Contrast multiplier (0.5 - 2.5)
 * @property {number} [threshold=185] - Manual binarization / white-clip threshold (80 - 250)
 * @property {boolean} [autoOtsu=true] - Use Otsu automatic threshold when binarizing
 * @property {boolean} [binarize=false] - Enable B&W thresholding in Scan Cleanup mode
 * @property {number} [dpi=150] - Output DPI (150, 200, 300)
 * @property {number} [jpegQuality=0.84] - JPEG quality for non-binarized output
 * @property {(percent: number, stage: string, current?: number, total?: number) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Computes Otsu's optimal global luminance threshold (`0..255`) from an RGBA pixel array.
 * @param {Uint8ClampedArray} data
 * @returns {number}
 */
export function computeOtsuThreshold(data) {
  const hist = new Uint32Array(256);
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) return 128;

  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    hist[Math.max(0, Math.min(255, lum))] += 1;
  }

  let sum = 0;
  for (let t = 0; t < 256; t += 1) {
    sum += t * hist[t];
  }

  let sumB = 0;
  let wB = 0;
  let maxBetweenVar = -1;
  let thresholdSum = 0;
  let thresholdCount = 0;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = pixelCount - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxBetweenVar + 1e-6) {
      maxBetweenVar = betweenVar;
      thresholdSum = t;
      thresholdCount = 1;
    } else if (Math.abs(betweenVar - maxBetweenVar) <= 1e-6) {
      thresholdSum += t;
      thresholdCount += 1;
    }
  }

  return thresholdCount > 0 ? Math.round(thresholdSum / thresholdCount) : 128;
}

/**
 * Clamps a numeric channel value cleanly to `[0, 255]`.
 * @param {number} val
 * @returns {number}
 */
function clampByte(val) {
  return val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
}

/**
 * Processes an RGBA pixel array in place using Grayscale, Invert/Dark Mode, or Scan Cleanup.
 * Pure typed-array operation shared between single-page previews, batch worker exports, and unit tests.
 * @param {Uint8ClampedArray} data
 * @param {ColorFilterConfig} [config={}]
 * @returns {{ otsuThreshold: number|null, outputMime: 'image/png'|'image/jpeg' }}
 */
export function applyColorFilterToPixels(data, config = {}) {
  const preset = config.preset || 'grayscale';
  const invertVariant = config.invertVariant || 'slate';
  const contrast = Math.max(0.5, Math.min(2.5, Number(config.contrast ?? 1.2)));
  const manualThreshold = Math.max(60, Math.min(250, Number(config.threshold ?? 185)));
  const binarize = Boolean(config.binarize);
  const autoOtsu = config.autoOtsu !== false;

  if (preset === 'grayscale') {
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const boosted = clampByte((y - 128) * contrast + 128);
      data[i] = boosted;
      data[i + 1] = boosted;
      data[i + 2] = boosted;
    }
    return { otsuThreshold: null, outputMime: 'image/jpeg' };
  }

  if (preset === 'invert') {
    if (invertVariant === 'pure') {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clampByte((255 - data[i] - 128) * contrast + 128);
        data[i + 1] = clampByte((255 - data[i + 1] - 128) * contrast + 128);
        data[i + 2] = clampByte((255 - data[i + 2] - 128) * contrast + 128);
      }
    } else {
      // Soft eye-friendly dark palette: white paper -> dark slate/sepia bg, dark ink -> soft light fg
      const bg = invertVariant === 'sepia' ? [28, 25, 23] : [22, 27, 34];
      const fg = invertVariant === 'sepia' ? [242, 232, 213] : [230, 237, 243];
      for (let i = 0; i < data.length; i += 4) {
        const invR = clampByte((255 - data[i] - 128) * contrast + 128) / 255;
        const invG = clampByte((255 - data[i + 1] - 128) * contrast + 128) / 255;
        const invB = clampByte((255 - data[i + 2] - 128) * contrast + 128) / 255;
        data[i] = clampByte(bg[0] + invR * (fg[0] - bg[0]));
        data[i + 1] = clampByte(bg[1] + invG * (fg[1] - bg[1]));
        data[i + 2] = clampByte(bg[2] + invB * (fg[2] - bg[2]));
      }
    }
    return { otsuThreshold: null, outputMime: 'image/jpeg' };
  }

  // Scan Cleanup: background whitening, contrast boost, optional Otsu/manual binarization
  const otsuT = binarize && autoOtsu ? computeOtsuThreshold(data) : null;
  const activeThreshold = binarize ? (otsuT ?? manualThreshold) : manualThreshold;

  if (binarize) {
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = y < activeThreshold ? 0 : 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
    return { otsuThreshold: activeThreshold, outputMime: 'image/png' };
  }

  // Soft background whitening: lift paper grays >= activeThreshold cleanly toward pure white
  // while boosting dark ink readability below activeThreshold.
  const whiteClip = Math.max(120, Math.min(252, activeThreshold));
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (y >= whiteClip) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    } else {
      // Stretch [0..whiteClip] -> [0..255] with contrast gamma
      const norm = y / whiteClip;
      const lifted = Math.pow(norm, Math.max(0.4, contrast * 0.85)) * 255;
      const boostFactor = norm > 0.001 ? lifted / Math.max(1, y) : 1;
      data[i] = clampByte(data[i] * boostFactor);
      data[i + 1] = clampByte(data[i + 1] * boostFactor);
      data[i + 2] = clampByte(data[i + 2] * boostFactor);
    }
  }

  return { otsuThreshold: null, outputMime: 'image/jpeg' };
}

/** @type {{ key: string, width: number, height: number, pixels: Uint8ClampedArray, originalBytes: ArrayBuffer }|null} */
let previewRasterCache = null;

/**
 * Releases cached single-page raster preview pixels in the worker.
 */
export function clearColorFilterPreviewCache() {
  previewRasterCache = null;
}

/**
 * Renders (or reuses cached pixels for) a single page and applies the color filter preview fast (<300ms).
 * Returns transferable ArrayBuffers for both original and filtered preview images.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {{ cacheKey: string, pageIndex: number, rotation?: number, filterConfig?: ColorFilterConfig, fileName?: string }} params
 * @returns {Promise<{ originalBuffer: ArrayBuffer, filteredBuffer: ArrayBuffer, mimeType: string, width: number, height: number, otsuThreshold: number|null }>}
 */
export async function generateColorFilterPreview(pdfBytes, params) {
  const { cacheKey, pageIndex = 0, rotation = 0, filterConfig = {}, fileName = '' } = params;

  if (!previewRasterCache || previewRasterCache.key !== cacheKey) {
    const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);
    try {
      const page = await pdfjsDoc.getPage(pageIndex + 1);
      const baseVp = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      // Cap preview at ~720px on longest side for sub-300ms pixel filtering updates
      const previewScale = Math.max(0.35, Math.min(1.4, 720 / Math.max(1, baseVp.width, baseVp.height)));
      const rendered = await renderPdfJsPageToCanvas(pdfjsDoc, pageIndex, previewScale, rotation);
      try {
        const imageData = rendered.ctx.getImageData(0, 0, rendered.width, rendered.height);
        const origBlob = await rendered.canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
        const origBuf = await origBlob.arrayBuffer();
        previewRasterCache = {
          key: cacheKey,
          width: rendered.width,
          height: rendered.height,
          pixels: new Uint8ClampedArray(imageData.data),
          originalBytes: origBuf
        };
      } finally {
        rendered.cleanup();
      }
    } finally {
      await destroyPdfJsDoc(pdfjsDoc);
    }
  }

  const { width, height, pixels, originalBytes } = previewRasterCache;
  const filteredPixels = new Uint8ClampedArray(pixels);
  const { otsuThreshold, outputMime } = applyColorFilterToPixels(filteredPixels, filterConfig);

  const outCanvas = new OffscreenCanvas(width, height);
  try {
    const outCtx = outCanvas.getContext('2d', { alpha: false });
    if (!outCtx) {
      throw new Error('Failed to create OffscreenCanvas context for filter preview.');
    }
    const imgData = new ImageData(filteredPixels, width, height);
    outCtx.putImageData(imgData, 0, 0);
    const outBlob = await outCanvas.convertToBlob({
      type: outputMime,
      quality: outputMime === 'image/png' ? undefined : 0.84
    });
    const filteredBuffer = await outBlob.arrayBuffer();
    return {
      originalBuffer: originalBytes.slice(0),
      filteredBuffer,
      mimeType: outputMime,
      width,
      height,
      otsuThreshold
    };
  } finally {
    outCanvas.width = 0;
    outCanvas.height = 0;
  }
}

/**
 * Applies Grayscale, Invert/Dark Mode, or Scan Cleanup pixel filters to every page of a PDF buffer
 * inside a Web Worker using pdfjs-dist + OffscreenCanvas and reassembles with pdf-lib.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {ColorFilterConfig} [config={}]
 * @param {string} [fileName='']
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, mimeType: string }>}
 */
export async function applyColorFiltersToPdf(pdfBytes, config = {}, fileName = '') {
  const {
    dpi = 150,
    jpegQuality = 0.84,
    onProgress,
    abortToken
  } = config;

  const safeDpi = Math.max(72, Math.min(300, Number(dpi) || 150));
  const scale = safeDpi / 72;
  const quality = Math.max(0.5, Math.min(0.95, Number(jpegQuality) || 0.84));

  assertNotAborted(abortToken);
  onProgress?.(8, 'Loading document for color filtering...');

  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);
  try {
    const total = pdfjsDoc.numPages;
    const outDoc = await PDFDocument.create();

    for (let i = 0; i < total; i += 1) {
      assertNotAborted(abortToken);
      const rendered = await renderPdfJsPageToCanvas(pdfjsDoc, i, scale, 0);
      let encodedBytes;
      let outputMime;
      let ptWidth;
      let ptHeight;

      try {
        const baseVp = rendered.page.getViewport({ scale: 1, rotation: rendered.page.rotate });
        ptWidth = baseVp.width;
        ptHeight = baseVp.height;

        const imgData = rendered.ctx.getImageData(0, 0, rendered.width, rendered.height);
        const res = applyColorFilterToPixels(imgData.data, config);
        outputMime = res.outputMime;
        rendered.ctx.putImageData(imgData, 0, 0);

        const blob = await rendered.canvas.convertToBlob({
          type: outputMime,
          quality: outputMime === 'image/png' ? undefined : quality
        });
        encodedBytes = new Uint8Array(await blob.arrayBuffer());
      } finally {
        rendered.cleanup();
      }

      const embedded =
        outputMime === 'image/png'
          ? await outDoc.embedPng(encodedBytes)
          : await outDoc.embedJpg(encodedBytes);

      const page = outDoc.addPage([ptWidth, ptHeight]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: ptWidth,
        height: ptHeight
      });

      const pct = 12 + Math.round(((i + 1) / Math.max(1, total)) * 80);
      onProgress?.(pct, `Filtering page ${i + 1} of ${total} (${safeDpi} DPI)...`, i + 1, total);
      await yieldToLoop();
    }

    assertNotAborted(abortToken);
    onProgress?.(95, 'Serializing filtered PDF...', total, total);
    const bytes = await outDoc.save({ useObjectStreams: true, addDefaultPage: false });
    onProgress?.(100, 'Filter processing complete.', total, total);

    return {
      bytes,
      pageCount: total,
      mimeType: 'application/pdf'
    };
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}
