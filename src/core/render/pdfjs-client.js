import { AbortedJobError, EncryptedPdfError } from '../utils/errors.js';
import { ObjectUrlTracker } from '../utils/file-io.js';

const MAX_THUMBNAIL_CACHE_ENTRIES = 180;

/**
 * Main-thread client for render.worker.js with IntersectionObserver lazy loading,
 * LRU thumbnail cache, and hard worker termination on unresponsive cancel.
 */
class PdfRenderClient {
  constructor() {
    /** @type {Worker|null} */
    this.worker = null;
    /** @type {Map<string, { resolve: Function, reject: Function, onProgress?: Function }>} */
    this.pending = new Map();
    /** @type {Map<string, { url: string, width: number, height: number }>} */
    this.thumbnailCache = new Map();
    /** @type {Map<string, Promise<{ url: string, width: number, height: number }>>} */
    this.inFlightThumbnails = new Map();
    /** @type {Set<string>} */
    this.loadedDocIds = new Set();
    /** @type {(() => import('../../state/workspace.js').SourceFileEntry[])|null} */
    this.sourceProvider = null;
    this.urlTracker = new ObjectUrlTracker();
    this.counter = 0;

    /** @type {IntersectionObserver|null} */
    this.observer = null;
    /** @type {WeakMap<Element, () => void>} */
    this.elementCallbacks = new WeakMap();
  }

  /**
   * Registers a callback returning active source entries so a respawned worker can reload PDFs.
   * @param {() => import('../../state/workspace.js').SourceFileEntry[]} provider
   */
  setSourceProvider(provider) {
    this.sourceProvider = provider;
  }

  /**
   * Lazily boots render.worker.js using Vite's native module worker syntax.
   * @returns {Worker}
   */
  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../../workers/render.worker.js', import.meta.url), {
      type: 'module'
    });
    this.worker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg?.requestId) return;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;

      if (msg.status === 'PROGRESS') {
        entry.onProgress?.(msg.percent, msg.stage);
        return;
      }

      this.pending.delete(msg.requestId);
      if (msg.status === 'ERROR') {
        if (msg.code === 'ENCRYPTED_PDF') {
          entry.reject(new EncryptedPdfError(msg.fileName, msg.message));
        } else if (msg.code === 'ABORTED_JOB') {
          entry.reject(new AbortedJobError(msg.requestId));
        } else {
          const err = new Error(msg.message || 'Render worker failed.');
          err.code = msg.code;
          entry.reject(err);
        }
        return;
      }

      entry.resolve(msg);
    });
    this.worker.addEventListener('error', (err) => {
      this.terminateWorker(new Error(err.message || 'Render worker crashed.'));
    });
    return this.worker;
  }

  /**
   * Hard-terminates render.worker.js and resets cached document proxies for clean respawn.
   * @param {Error} [reason]
   */
  terminateWorker(reason = new AbortedJobError()) {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.loadedDocIds.clear();
    for (const entry of this.pending.values()) {
      entry.reject(reason);
    }
    this.pending.clear();
  }

  /**
   * Ensures a PDF document is loaded inside render.worker.js (re-loading automatically after respawn).
   * @param {string} sourceFileId
   */
  async ensureDocumentLoaded(sourceFileId) {
    if (this.loadedDocIds.has(sourceFileId) || !this.sourceProvider) return;
    const src = this.sourceProvider().find((s) => s.id === sourceFileId && s.type === 'pdf');
    if (src && src.buffer?.byteLength > 0) {
      await this.loadPdfDocument(src.id, src.buffer, src.name);
    }
  }

  /**
   * Sends a typed request to render.worker.js.
   * @param {string} type
   * @param {Object} payload
   * @param {Transferable[]} [transfer=[]]
   * @param {(percent: number, stage: string) => void} [onProgress]
   * @param {(requestId: string) => void} [onRequestId]
   * @returns {Promise<any>}
   */
  request(type, payload, transfer = [], onProgress, onRequestId) {
    const worker = this.ensureWorker();
    const requestId = `rnd_${++this.counter}_${Date.now()}`;
    onRequestId?.(requestId);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress });
      worker.postMessage({ requestId, type, payload }, transfer);
    });
  }

  /**
   * Registers a PDF document in render.worker.js once and returns its page count.
   * @param {string} sourceFileId
   * @param {ArrayBuffer} buffer
   * @param {string} fileName
   * @returns {Promise<number>}
   */
  async loadPdfDocument(sourceFileId, buffer, fileName) {
    const copy = buffer.slice(0);
    const res = await this.request(
      'LOAD_DOC',
      { sourceFileId, buffer: copy, fileName },
      [copy]
    );
    this.loadedDocIds.add(sourceFileId);
    return res.result.pageCount;
  }

  /**
   * Stores an entry in the bounded LRU thumbnail cache, revoking evicted ObjectURLs.
   * @param {string} key
   * @param {{ url: string, width: number, height: number }} value
   */
  setLru(key, value) {
    if (this.thumbnailCache.has(key)) {
      this.thumbnailCache.delete(key);
    }
    this.thumbnailCache.set(key, value);
    if (this.thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
      const oldestKey = this.thumbnailCache.keys().next().value;
      const oldestVal = this.thumbnailCache.get(oldestKey);
      this.thumbnailCache.delete(oldestKey);
      if (oldestVal?.url) {
        this.urlTracker.revoke(oldestVal.url);
      }
    }
  }

  /**
   * Retrieves or renders a WebP thumbnail ObjectURL for a PDF or image source page.
   * @param {import('../../state/workspace.js').SourceFileEntry} sourceEntry
   * @param {number} pageIndex
   * @returns {Promise<{ url: string, width: number, height: number }>}
   */
  async getThumbnail(sourceEntry, pageIndex) {
    const cacheKey = `${sourceEntry.id}:${pageIndex}`;
    const hit = this.thumbnailCache.get(cacheKey);
    if (hit) {
      this.thumbnailCache.delete(cacheKey);
      this.thumbnailCache.set(cacheKey, hit);
      return hit;
    }

    if (this.inFlightThumbnails.has(cacheKey)) {
      return this.inFlightThumbnails.get(cacheKey);
    }

    const task = (async () => {
      if (sourceEntry.type === 'image') {
        const blob = new Blob([sourceEntry.buffer], {
          type: sourceEntry.mimeType || 'image/png'
        });
        const url = this.urlTracker.create(blob);
        const value = { url, width: 240, height: 320 };
        this.setLru(cacheKey, value);
        return value;
      }

      await this.ensureDocumentLoaded(sourceEntry.id);
      const res = await this.request('RENDER_THUMBNAIL', {
        sourceFileId: sourceEntry.id,
        pageIndex,
        scale: 0.4
      });
      const blob = new Blob([res.resultBuffer], { type: res.mimeType || 'image/webp' });
      const url = this.urlTracker.create(blob);
      const value = { url, width: res.width, height: res.height };
      this.setLru(cacheKey, value);
      return value;
    })();

    this.inFlightThumbnails.set(cacheKey, task);
    try {
      return await task;
    } finally {
      this.inFlightThumbnails.delete(cacheKey);
    }
  }

  /**
   * Renders a high-resolution preview image ObjectURL for the inspection modal.
   * @param {import('../../state/workspace.js').SourceFileEntry} sourceEntry
   * @param {number} pageIndex
   * @param {number} [rotation=0]
   * @returns {Promise<string>}
   */
  async renderHighResPreview(sourceEntry, pageIndex, rotation = 0) {
    if (sourceEntry.type === 'image') {
      const blob = new Blob([sourceEntry.buffer], {
        type: sourceEntry.mimeType || 'image/png'
      });
      return this.urlTracker.create(blob);
    }
    await this.ensureDocumentLoaded(sourceEntry.id);
    const res = await this.request('RENDER_PREVIEW', {
      sourceFileId: sourceEntry.id,
      pageIndex,
      scale: 1.6,
      rotation
    });
    const blob = new Blob([res.resultBuffer], { type: res.mimeType || 'image/webp' });
    return this.urlTracker.create(blob);
  }

  /**
   * Rasterizes workspace pages to PNG, JPG, or WebP (single file or ZIP).
   * @param {Object} payload
   * @param {(percent: number, stage: string) => void} [onProgress]
   * @param {(requestId: string) => void} [onRequestId]
   * @returns {Promise<{ resultBuffer: ArrayBuffer, fileName: string, mimeType: string }>}
   */
  async rasterizePages(payload, onProgress, onRequestId) {
    const pdfIds = new Set(
      (payload.pages || []).filter((p) => p.kind === 'pdf').map((p) => p.sourceFileId)
    );
    for (const id of pdfIds) {
      await this.ensureDocumentLoaded(id);
    }
    return this.request('RASTERIZE_PAGES', payload, [], onProgress, onRequestId);
  }

  /**
   * Signals cooperative abort and hard-terminates render.worker.js after 300ms if blocked in WASM.
   * @param {string} targetRequestId
   */
  abortJob(targetRequestId) {
    if (!this.worker || !targetRequestId) return;
    const worker = this.worker;
    const requestId = `rnd_abort_${++this.counter}_${Date.now()}`;
    worker.postMessage({
      requestId,
      type: 'ABORT_JOB',
      payload: { targetRequestId }
    });
    setTimeout(() => {
      if (this.pending.has(targetRequestId)) {
        this.terminateWorker(new AbortedJobError(targetRequestId));
      }
    }, 300);
  }

  /**
   * Lazily observes a thumbnail card via IntersectionObserver (rootMargin: '300px').
   * @param {Element} element
   * @param {() => void} onVisible
   */
  observeElement(element, onVisible) {
    if (!this.observer && typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const cb = this.elementCallbacks.get(entry.target);
              this.observer?.unobserve(entry.target);
              this.elementCallbacks.delete(entry.target);
              cb?.();
            }
          }
        },
        { rootMargin: '300px' }
      );
    }

    if (!this.observer) {
      onVisible();
      return;
    }
    this.elementCallbacks.set(element, onVisible);
    this.observer.observe(element);
  }

  /**
   * Evicts cached PDF proxy and thumbnail ObjectURLs for a removed source file.
   * @param {string} sourceFileId
   */
  evictSource(sourceFileId) {
    this.loadedDocIds.delete(sourceFileId);
    for (const [key, val] of this.thumbnailCache.entries()) {
      if (key.startsWith(`${sourceFileId}:`)) {
        this.urlTracker.revoke(val.url);
        this.thumbnailCache.delete(key);
      }
    }
    if (this.worker) {
      this.request('EVICT_DOC', { sourceFileId }).catch(() => {});
    }
  }

  /**
   * Clears all cached thumbnails and worker document proxies.
   */
  clearAll() {
    this.loadedDocIds.clear();
    this.thumbnailCache.clear();
    this.inFlightThumbnails.clear();
    this.urlTracker.revokeAll();
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.worker) {
      this.request('CLEAR_DOCS', {}).catch(() => {});
    }
  }
}

export const pdfRenderClient = new PdfRenderClient();
