/**
 * Client-side File I/O, Blob download trigger, and ObjectURL memory lifecycle manager.
 */

/**
 * Tracks active ObjectURLs so memory can be aggressively reclaimed when files or views clear.
 */
export class ObjectUrlTracker {
  constructor() {
    /** @type {Set<string>} */
    this.urls = new Set();
  }

  /**
   * Creates and registers an ObjectURL for a Blob or MediaSource.
   * @param {Blob} blob - Binary blob
   * @returns {string} ObjectURL string
   */
  create(blob) {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }

  /**
   * Revokes a single tracked ObjectURL.
   * @param {string|null|undefined} url - ObjectURL to revoke
   */
  revoke(url) {
    if (!url) return;
    if (this.urls.has(url)) {
      this.urls.delete(url);
    }
    URL.revokeObjectURL(url);
  }

  /**
   * Revokes all tracked ObjectURLs immediately.
   */
  revokeAll() {
    for (const url of this.urls) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
}

/** @type {ObjectUrlTracker} */
export const globalUrlTracker = new ObjectUrlTracker();

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    globalUrlTracker.revokeAll();
  });
}

/**
 * Sanitizes a suggested download filename to strip control chars and path separators.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeDownloadName(name) {
  return String(name || 'poffy_export.pdf')
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '_')
    .trim() || 'poffy_export.pdf';
}

/**
 * Reads a File or Blob into an ArrayBuffer.
 * @param {File|Blob} file - Browser File/Blob
 * @returns {Promise<ArrayBuffer>} Raw bytes
 */
export async function readFileAsArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer.'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed.'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Triggers a local browser download from an ArrayBuffer/Uint8Array and revokes the Blob URL.
 * @param {ArrayBuffer|Uint8Array} data - File bytes
 * @param {string} fileName - Suggested download filename
 * @param {string} mimeType - MIME type (e.g. 'application/pdf', 'application/zip')
 */
export function triggerDownload(data, fileName, mimeType) {
  const blob = new Blob([data], { type: mimeType });
  const url = globalUrlTracker.create(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sanitizeDownloadName(fileName);
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Delay revocation slightly so Chromium/Firefox finish initiating the stream
  setTimeout(() => {
    globalUrlTracker.revoke(url);
  }, 4000);
}

/**
 * Formats byte count into a human-readable string (e.g. "12.4 MB").
 * @param {number} bytes - Byte count
 * @returns {string} Formatted size string
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`;
}
