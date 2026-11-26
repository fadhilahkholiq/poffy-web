const WIN_ANSI_REGEX = /^[\x20-\x7E\xA0-\xFF\n\r]*$/;

/**
 * Checks whether a string contains only characters supported by PDF WinAnsi encoding.
 * Kept dependency-free so UI modules can check text without bundling pdf-lib/fontkit on the main thread.
 * @param {string} text - Input text
 * @returns {boolean}
 */
export function isWinAnsiCompatible(text) {
  return WIN_ANSI_REGEX.test(String(text ?? ''));
}
