/**
 * Custom domain error classes for Poffy PDF operations.
 * Strictly DOM-free so they can be used in Web Workers and core modules.
 */

/**
 * Error thrown when attempting to parse or process an encrypted/password-protected PDF.
 */
export class EncryptedPdfError extends Error {
  /**
   * @param {string} [fileName] - Optional filename of the encrypted PDF
   * @param {string} [message] - Optional custom message
   */
  constructor(fileName = '', message = '') {
    const label = fileName ? `"${fileName}"` : 'This PDF';
    super(
      message ||
        `${label} is password-protected or encrypted. Remove encryption before loading it into Poffy.`
    );
    this.name = 'EncryptedPdfError';
    this.fileName = fileName;
    this.code = 'ENCRYPTED_PDF';
  }
}

/**
 * Error thrown when a background worker job is cancelled via ABORT_JOB.
 */
export class AbortedJobError extends Error {
  /**
   * @param {string} [requestId] - Cancelled request UUID
   */
  constructor(requestId = '') {
    super('Operation cancelled by user.');
    this.name = 'AbortedJobError';
    this.requestId = requestId;
    this.code = 'ABORTED_JOB';
  }
}

/**
 * Error thrown when a user-supplied page range expression is invalid.
 */
export class InvalidRangeError extends Error {
  /**
   * @param {string} message - Human-readable validation explanation
   */
  constructor(message) {
    super(message);
    this.name = 'InvalidRangeError';
    this.code = 'INVALID_RANGE';
  }
}

/**
 * Checks whether an unknown error originated from an encrypted/password-protected PDF.
 * @param {unknown} err - Caught error value
 * @returns {boolean}
 */
export function isEncryptedPdfError(err) {
  if (!err) return false;
  if (err instanceof EncryptedPdfError) return true;
  const name = typeof err === 'object' && 'name' in err ? String(err.name) : '';
  const msg = typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  return (
    name === 'EncryptedPDFError' ||
    name === 'PasswordException' ||
    /encrypted|password/i.test(msg)
  );
}
