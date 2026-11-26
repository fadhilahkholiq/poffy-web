import { zipSync } from 'fflate';

const MAX_ZIP_ENTRIES = 2500;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;

/**
 * @typedef {Object} ZipEntry
 * @property {string} name - Filename inside the ZIP archive
 * @property {Uint8Array} data - File bytes
 */

/**
 * Sanitizes and deduplicates filenames inside a ZIP archive, stripping path traversal sequences.
 * @param {string} name - Desired entry filename
 * @param {Set<string>} used - Set of already assigned lowercase names
 * @returns {string} Safe unique filename
 */
function ensureUniqueName(name, used) {
  const cleaned = String(name || 'file.bin')
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('_');

  const sanitized = cleaned || 'file.bin';
  if (!used.has(sanitized.toLowerCase())) {
    used.add(sanitized.toLowerCase());
    return sanitized;
  }

  const dotIdx = sanitized.lastIndexOf('.');
  const base = dotIdx > 0 ? sanitized.slice(0, dotIdx) : sanitized;
  const ext = dotIdx > 0 ? sanitized.slice(dotIdx) : '';

  let counter = 2;
  while (used.has(`${base}_${counter}${ext}`.toLowerCase())) {
    counter += 1;
  }
  const unique = `${base}_${counter}${ext}`;
  used.add(unique.toLowerCase());
  return unique;
}

/**
 * Packages multiple files into a single ZIP archive in memory using fflate.
 * Enforces entry count and aggregate byte caps to prevent memory exhaustion.
 * @param {ZipEntry[]} entries - Files to bundle
 * @param {number} [level=1] - Deflate compression level (0-9)
 * @returns {Uint8Array} Serialized ZIP bytes
 */
export function createZipArchive(entries, level = 1) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Cannot create an empty ZIP archive.');
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`Archive exceeds maximum entry limit (${MAX_ZIP_ENTRIES} files).`);
  }

  /** @type {Record<string, Uint8Array>} */
  const archiveMap = {};
  const usedNames = new Set();
  let totalBytes = 0;

  for (const entry of entries) {
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    totalBytes += data.byteLength;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error('Archive payload exceeds safe in-memory ZIP limit (512 MB).');
    }
    const uniqueName = ensureUniqueName(entry.name, usedNames);
    archiveMap[uniqueName] = data;
  }

  return zipSync(archiveMap, { level });
}
