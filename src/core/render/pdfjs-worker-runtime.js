import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { EncryptedPdfError, isEncryptedPdfError } from '../utils/errors.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MAX_CANVAS_DIM = 4096;
export const MAX_CANVAS_AREA = 4096 * 4096;

/**
 * OffscreenCanvas factory matching pdfjs-dist >=6.x BaseCanvasFactory inside a Web Worker.
 */
export class OffscreenCanvasFactory {
  /**
   * @param {number} width
   * @param {number} height
   * @returns {OffscreenCanvas}
   */
  _createCanvas(width, height) {
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    if (w <= 0 || h <= 0 || w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM || w * h > MAX_CANVAS_AREA) {
      throw new Error(`Canvas dimensions (${w}x${h}) exceed safe WebAssembly memory bounds.`);
    }
    return new OffscreenCanvas(w, h);
  }

  /**
   * @param {number} width
   * @param {number} height
   * @returns {{ canvas: OffscreenCanvas, context: OffscreenCanvasRenderingContext2D }}
   */
  create(width, height) {
    const canvas = this._createCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Failed to acquire 2D context on OffscreenCanvas.');
    }
    return { canvas, context };
  }

  /**
   * @param {{ canvas: OffscreenCanvas }} canvasAndContext
   * @param {number} width
   * @param {number} height
   */
  reset(canvasAndContext, width, height) {
    if (!canvasAndContext?.canvas) return;
    const w = Math.ceil(width);
    const h = Math.ceil(height);
    if (w <= 0 || h <= 0 || w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM || w * h > MAX_CANVAS_AREA) {
      throw new Error(`Canvas dimensions (${w}x${h}) exceed safe WebAssembly memory bounds.`);
    }
    canvasAndContext.canvas.width = w;
    canvasAndContext.canvas.height = h;
  }

  /**
   * @param {{ canvas: OffscreenCanvas|null, context: OffscreenCanvasRenderingContext2D|null }} canvasAndContext
   */
  destroy(canvasAndContext) {
    if (!canvasAndContext?.canvas) return;
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }

  /**
   * Required by pdfjs-dist >=6.x BaseCanvasFactory contract.
   * @param {OffscreenCanvas} canvas
   * @returns {OffscreenCanvasRenderingContext2D|null}
   */
  getNoAlphaContext(canvas) {
    return canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true
    });
  }
}

/**
 * Minimal FilterFactory matching pdfjs-dist >=6.x BaseFilterFactory inside a Web Worker.
 */
export class WorkerFilterFactory {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addKnockoutFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  addSelectionHCMFilter() {
    return 'none';
  }
  addSelectionFilter() {
    return 'none';
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

/**
 * Resolves local bundled pdfjs-dist asset URLs on the current origin ('self').
 * @returns {{ cMapUrl: string, standardFontDataUrl: string, wasmUrl: string }}
 */
export function getLocalPdfJsAssetUrls() {
  const origin = self.location.origin;
  return {
    cMapUrl: new URL('/pdfjs/cmaps/', origin).href,
    standardFontDataUrl: new URL('/pdfjs/standard_fonts/', origin).href,
    wasmUrl: new URL('/pdfjs/wasm/', origin).href
  };
}

/**
 * Loads a PDFDocumentProxy inside a Web Worker with strict eval sandboxing and local assets.
 * Always clones the input bytes so pdfjs-dist transferring `data.buffer` never detaches caller/registry buffers.
 * Caller is responsible for calling `destroyPdfJsDoc(doc)` when done if not caching.
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {string} [fileName='']
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
export async function loadPdfJsInWorker(bytes, fileName = '') {
  const assets = getLocalPdfJsAssetUrls();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  try {
    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: assets.cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: assets.standardFontDataUrl,
      wasmUrl: assets.wasmUrl,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      isOffscreenCanvasSupported: true,
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: WorkerFilterFactory
    });
    return await loadingTask.promise;
  } catch (err) {
    if (isEncryptedPdfError(err)) {
      throw new EncryptedPdfError(fileName);
    }
    throw err;
  }
}

/**
 * Safely destroys a PDFDocumentProxy via its loadingTask (pdfjs-dist >=6.x removed PDFDocumentProxy.destroy).
 * @param {import('pdfjs-dist').PDFDocumentProxy|null|undefined} doc
 * @returns {Promise<void>}
 */
export async function destroyPdfJsDoc(doc) {
  if (!doc) return;
  try {
    if (typeof doc.destroy === 'function') {
      await doc.destroy();
    } else if (typeof doc.loadingTask?.destroy === 'function') {
      await doc.loadingTask.destroy();
    } else if (typeof doc.cleanup === 'function') {
      await doc.cleanup();
    }
  } catch {
    // Ignore cleanup errors on already-terminated loading tasks
  }
}

/**
 * Renders a PDF page onto a freshly allocated OffscreenCanvas with memory-safe dimension clamping.
 * Caller MUST reset `canvas.width = canvas.height = 0` and call `page.cleanup()` when finished,
 * or use the returned `cleanup()` helper.
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {number} pageIndex - 0-based index
 * @param {number} scale
 * @param {number} [extraRotation=0]
 * @returns {Promise<{ canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D, page: any, width: number, height: number, scaleUsed: number, cleanup: () => void }>}
 */
export async function renderPdfJsPageToCanvas(doc, pageIndex, scale, extraRotation = 0) {
  const page = await doc.getPage(pageIndex + 1);
  const rotation = ((page.rotate + extraRotation) % 360 + 360) % 360;
  const baseViewport = page.getViewport({ scale: 1, rotation });
  const requestedScale = Math.max(0.1, Math.min(4, Number(scale) || 1));

  const maxDimScale = Math.min(
    MAX_CANVAS_DIM / Math.max(1, baseViewport.width),
    MAX_CANVAS_DIM / Math.max(1, baseViewport.height)
  );
  const scaleUsed = Math.max(0.05, Math.min(requestedScale, maxDimScale));
  const viewport = page.getViewport({ scale: scaleUsed, rotation });

  const width = Math.max(1, Math.min(MAX_CANVAS_DIM, Math.ceil(viewport.width)));
  const height = Math.max(1, Math.min(MAX_CANVAS_DIM, Math.ceil(viewport.height)));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) {
    page.cleanup();
    throw new Error('Could not create OffscreenCanvas 2D context.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    canvas,
    ctx,
    page,
    width,
    height,
    scaleUsed,
    cleanup: () => {
      try {
        page.cleanup();
      } catch {
        // Ignore cleanup errors on already-destroyed docs
      }
      canvas.width = 0;
      canvas.height = 0;
    }
  };
}
