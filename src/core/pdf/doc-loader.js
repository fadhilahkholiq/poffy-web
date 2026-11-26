import { PDFDocument } from 'pdf-lib';
import { AbortedJobError, EncryptedPdfError, isEncryptedPdfError } from '../utils/errors.js';

/**
 * Standard PDF page sizes in PostScript points (72 pt = 1 inch).
 * @type {Record<'a4'|'letter'|'legal', [number, number]>}
 */
export const PAGE_SIZES = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008]
};

/**
 * Safely loads a PDFDocument, translating encryption failures into EncryptedPdfError.
 * @param {ArrayBuffer|Uint8Array} bytes - Raw PDF bytes
 * @param {string} [fileName=''] - Optional filename for error reporting
 * @param {{ updateMetadata?: boolean }} [options={}] - Load options
 * @returns {Promise<PDFDocument>}
 */
export async function loadPdfSafe(bytes, fileName = '', options = {}) {
  try {
    const doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: options.updateMetadata ?? false
    });
    if (doc.isEncrypted) {
      throw new EncryptedPdfError(fileName);
    }
    return doc;
  } catch (err) {
    if (isEncryptedPdfError(err)) {
      throw new EncryptedPdfError(fileName);
    }
    throw err;
  }
}

/**
 * Checks whether an AbortSignal or boolean flag has cancelled the current job.
 * @param {{ aborted?: boolean }} [abortToken] - Cancellation token
 */
export function assertNotAborted(abortToken) {
  if (abortToken?.aborted) {
    throw new AbortedJobError();
  }
}

/**
 * Yields to the worker/event loop between heavy page batches so ABORT_JOB messages can be processed.
 * @returns {Promise<void>}
 */
export function yieldToLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
