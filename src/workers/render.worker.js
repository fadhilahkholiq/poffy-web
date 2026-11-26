import { AbortedJobError } from '../core/utils/errors.js';
import { packageRasterizedImages } from '../core/pdf/convert.js';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../core/render/pdfjs-worker-runtime.js';

const MAX_RASTER_PAGES = 1000;

/** @type {Map<string, import('pdfjs-dist').PDFDocumentProxy>} */
const docCache = new Map();

/** @type {Map<string, { aborted: boolean }>} */
const activeAbortTokens = new Map();

/**
 * Loads or retrieves a cached PDFDocumentProxy for a sourceFileId.
 * @param {string} sourceFileId
 * @param {ArrayBuffer} [buffer]
 * @param {string} [fileName='']
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy>}
 */
async function getOrLoadDocument(sourceFileId, buffer, fileName = '') {
  const cached = docCache.get(sourceFileId);
  if (cached) return cached;

  if (!buffer) {
    throw new Error(`Document "${sourceFileId}" is not loaded in render worker.`);
  }

  const doc = await loadPdfJsInWorker(buffer, fileName);
  docCache.set(sourceFileId, doc);
  return doc;
}

/**
 * Renders a single PDF page onto an OffscreenCanvas and encodes to Blob bytes.
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {number} pageIndex - 0-based page index
 * @param {number} scale
 * @param {string} mimeType
 * @param {number} quality
 * @param {number} [extraRotation=0]
 * @returns {Promise<{ buffer: ArrayBuffer, width: number, height: number }>}
 */
async function renderPageToImageBuffer(
  doc,
  pageIndex,
  scale,
  mimeType,
  quality,
  extraRotation = 0
) {
  const rendered = await renderPdfJsPageToCanvas(doc, pageIndex, scale, extraRotation);
  try {
    const blob = await rendered.canvas.convertToBlob({ type: mimeType, quality });
    const buffer = await blob.arrayBuffer();
    return { buffer, width: rendered.width, height: rendered.height };
  } finally {
    rendered.cleanup();
  }
}

self.addEventListener('message', async (event) => {
  const msg = event.data;
  if (!msg || !msg.requestId) return;
  const { requestId, type, payload } = msg;

  if (type === 'ABORT_JOB') {
    const token = activeAbortTokens.get(payload?.targetRequestId);
    if (token) token.aborted = true;
    self.postMessage({ requestId, status: 'SUCCESS', result: { aborted: true } });
    return;
  }

  const abortToken = { aborted: false };
  activeAbortTokens.set(requestId, abortToken);

  try {
    if (type === 'LOAD_DOC') {
      const doc = await getOrLoadDocument(payload.sourceFileId, payload.buffer, payload.fileName);
      self.postMessage({
        requestId,
        status: 'SUCCESS',
        result: { pageCount: doc.numPages }
      });
      return;
    }

    if (type === 'EVICT_DOC') {
      const doc = docCache.get(payload.sourceFileId);
      if (doc) {
        await destroyPdfJsDoc(doc);
        docCache.delete(payload.sourceFileId);
      }
      self.postMessage({ requestId, status: 'SUCCESS', result: { evicted: true } });
      return;
    }

    if (type === 'CLEAR_DOCS') {
      for (const doc of docCache.values()) {
        await destroyPdfJsDoc(doc);
      }
      docCache.clear();
      self.postMessage({ requestId, status: 'SUCCESS', result: { cleared: true } });
      return;
    }

    if (type === 'RENDER_THUMBNAIL' || type === 'RENDER_PREVIEW') {
      const doc = await getOrLoadDocument(payload.sourceFileId, payload.buffer, payload.fileName);
      const scale = type === 'RENDER_PREVIEW' ? (payload.scale ?? 1.5) : (payload.scale ?? 0.4);
      const quality = type === 'RENDER_PREVIEW' ? 0.9 : 0.8;
      const { buffer, width, height } = await renderPageToImageBuffer(
        doc,
        payload.pageIndex,
        scale,
        'image/webp',
        quality,
        payload.rotation || 0
      );

      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer: buffer,
          width,
          height,
          mimeType: 'image/webp'
        },
        [buffer]
      );
      return;
    }

    if (type === 'RASTERIZE_PAGES') {
      const { pages = [], format = 'png', quality = 0.9, scale = 2, baseName = 'document' } = payload;
      if (!Array.isArray(pages) || pages.length === 0) {
        throw new Error('No pages selected for rasterization.');
      }
      if (pages.length > MAX_RASTER_PAGES) {
        throw new Error(`Batch image export is limited to ${MAX_RASTER_PAGES} pages per archive.`);
      }
      const safeScale = Math.max(0.25, Math.min(4, Number(scale) || 2));
      const mimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        webp: 'image/webp'
      };
      const mimeType = mimeMap[format] || 'image/png';
      const rendered = [];

      for (let i = 0; i < pages.length; i += 1) {
        if (abortToken.aborted) {
          throw new AbortedJobError(requestId);
        }
        const item = pages[i];
        let buffer;

        if (item.kind === 'blank') {
          const canvas = new OffscreenCanvas(Math.round(595 * safeScale), Math.round(842 * safeScale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const blob = await canvas.convertToBlob({ type: mimeType, quality });
          canvas.width = 0;
          canvas.height = 0;
          buffer = await blob.arrayBuffer();
        } else if (item.kind === 'image') {
          const srcBlob = new Blob([item.imageBuffer], { type: item.imageMimeType || 'image/png' });
          const bmp = await createImageBitmap(srcBlob);
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          const outBlob = await canvas.convertToBlob({ type: mimeType, quality });
          canvas.width = 0;
          canvas.height = 0;
          buffer = await outBlob.arrayBuffer();
        } else {
          const doc = await getOrLoadDocument(item.sourceFileId, item.buffer, item.fileName);
          const out = await renderPageToImageBuffer(
            doc,
            item.sourcePageIndex,
            safeScale,
            mimeType,
            quality,
            item.rotation || 0
          );
          buffer = out.buffer;
        }

        rendered.push({
          pageNumber: i + 1,
          bytes: new Uint8Array(buffer),
          ext: format,
          mimeType
        });

        self.postMessage({
          requestId,
          status: 'PROGRESS',
          percent: Math.round(((i + 1) / pages.length) * 90),
          stage: `Rendering page ${i + 1} of ${pages.length} to ${format.toUpperCase()}...`
        });
      }

      if (abortToken.aborted) {
        throw new AbortedJobError(requestId);
      }

      self.postMessage({
        requestId,
        status: 'PROGRESS',
        percent: 95,
        stage: rendered.length > 1 ? 'Packaging images into ZIP...' : 'Finalizing image...'
      });

      const packaged = packageRasterizedImages(rendered, baseName);
      const outBuffer = packaged.buffer.buffer.slice(
        packaged.buffer.byteOffset,
        packaged.buffer.byteOffset + packaged.buffer.byteLength
      );

      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer: outBuffer,
          fileName: packaged.fileName,
          mimeType: packaged.mimeType
        },
        [outBuffer]
      );
      return;
    }

    throw new Error(`Unknown render worker request type: ${type}`);
  } catch (err) {
    self.postMessage({
      requestId,
      status: 'ERROR',
      code: err?.code || 'RENDER_ERROR',
      message: err?.message || String(err),
      fileName: err?.fileName || ''
    });
  } finally {
    activeAbortTokens.delete(requestId);
  }
});
