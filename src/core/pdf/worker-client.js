import { AbortedJobError, EncryptedPdfError } from '../utils/errors.js';

/**
 * Main-thread IPC client for pdf-ops.worker.js.
 * Supports cooperative ABORT_JOB with hard worker.terminate() fallback + clean respawn.
 */
class PdfOpsClient {
  constructor() {
    /** @type {Worker|null} */
    this.worker = null;
    /** @type {Map<string, { resolve: Function, reject: Function, onProgress?: Function }>} */
    this.pending = new Map();
    /** @type {Set<string>} */
    this.registeredSourceIds = new Set();
    /** @type {(() => import('../../state/workspace.js').SourceFileEntry[])|null} */
    this.sourceProvider = null;
    this.counter = 0;
  }

  /**
   * Registers a callback returning current active source entries so a respawned worker can resync.
   * @param {() => import('../../state/workspace.js').SourceFileEntry[]} provider
   */
  setSourceProvider(provider) {
    this.sourceProvider = provider;
  }

  /**
   * Lazily initializes pdf-ops.worker.js using Vite's native module worker syntax.
   * @returns {Worker}
   */
  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('../../workers/pdf-ops.worker.js', import.meta.url), {
      type: 'module'
    });
    this.worker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg?.requestId) return;
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;

      if (msg.status === 'PROGRESS') {
        entry.onProgress?.(msg.percent, msg.stage, msg.current, msg.total);
        return;
      }

      this.pending.delete(msg.requestId);
      if (msg.status === 'ERROR') {
        if (msg.code === 'ENCRYPTED_PDF') {
          entry.reject(new EncryptedPdfError(msg.fileName, msg.message));
        } else if (msg.code === 'ABORTED_JOB') {
          entry.reject(new AbortedJobError(msg.requestId));
        } else {
          const err = new Error(msg.message || 'PDF operation failed.');
          err.code = msg.code;
          entry.reject(err);
        }
        return;
      }

      entry.resolve(msg);
    });
    this.worker.addEventListener('error', (err) => {
      this.terminateWorker(new Error(err.message || 'PDF worker crashed.'));
    });
    return this.worker;
  }

  /**
   * Hard-terminates the worker immediately and rejects any in-flight promises cleanly.
   * @param {Error} [reason]
   */
  terminateWorker(reason = new AbortedJobError()) {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.registeredSourceIds.clear();
    for (const entry of this.pending.values()) {
      entry.reject(reason);
    }
    this.pending.clear();
  }

  /**
   * Ensures all current workspace sources are registered in the active worker after a respawn.
   * @returns {Promise<void>}
   */
  async syncMissingSources() {
    if (!this.sourceProvider) return;
    const sources = this.sourceProvider();
    for (const entry of sources) {
      if (!this.registeredSourceIds.has(entry.id) && entry.buffer?.byteLength > 0) {
        await this.registerSource(entry);
      }
    }
  }

  /**
   * Dispatches a request to pdf-ops.worker.js.
   * @param {string} type
   * @param {Object} payload
   * @param {{ transfer?: Transferable[], onProgress?: (percent: number, stage: string) => void, onRequestId?: (id: string) => void }} [options={}]
   * @returns {Promise<import('../../workers/pdf-ops.worker.js').WorkerSuccess>}
   */
  async run(type, payload, options = {}) {
    if (
      type !== 'REGISTER_SOURCE' &&
      type !== 'EVICT_SOURCE' &&
      type !== 'CLEAR_SOURCES' &&
      type !== 'ABORT_JOB'
    ) {
      await this.syncMissingSources();
    }

    const worker = this.ensureWorker();
    const requestId = `job_${++this.counter}_${Date.now()}`;
    options.onRequestId?.(requestId);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        onProgress: options.onProgress
      });
      worker.postMessage({ requestId, type, payload }, options.transfer || []);
    });
  }

  /**
   * Registers a source file in pdf-ops.worker.js once (transferring a copy).
   * @param {import('../../state/workspace.js').SourceFileEntry} entry
   */
  async registerSource(entry) {
    const bufferCopy = entry.buffer.slice(0);
    await this.run(
      'REGISTER_SOURCE',
      {
        id: entry.id,
        name: entry.name,
        type: entry.type,
        mimeType: entry.mimeType,
        buffer: bufferCopy
      },
      { transfer: [bufferCopy] }
    );
    this.registeredSourceIds.add(entry.id);
  }

  /**
   * Evicts a removed source file from worker memory.
   * @param {string} sourceFileId
   */
  evictSource(sourceFileId) {
    this.registeredSourceIds.delete(sourceFileId);
    if (!this.worker) return;
    this.run('EVICT_SOURCE', { sourceFileId }).catch(() => {});
  }

  /**
   * Clears all source files cached in worker memory.
   */
  clearAll() {
    this.registeredSourceIds.clear();
    if (!this.worker) return;
    this.run('CLEAR_SOURCES', {}).catch(() => {});
  }

  /**
   * Signals cooperative abort first, then hard-terminates the worker after 300ms if blocked.
   * @param {string} targetRequestId
   */
  abortJob(targetRequestId) {
    if (!this.worker || !targetRequestId) return;
    const worker = this.worker;
    const requestId = `abort_${++this.counter}_${Date.now()}`;
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
}

export const pdfOpsClient = new PdfOpsClient();
