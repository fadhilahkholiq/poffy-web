import { InvalidRangeError } from './errors.js';

const MAX_RANGE_INPUT_LENGTH = 2000;
const MAX_RANGE_SEGMENTS = 500;
const MAX_EXPANDED_PAGES = 10000;

/**
 * Resolves a single token ("1", "end", "last") to a 1-based page number.
 * @param {string} token - Trimmed token
 * @param {number} totalPages - Total available pages (>= 1)
 * @returns {number} 1-based page number
 */
function parseBound(token, totalPages) {
  const normalized = token.trim().toLowerCase();
  if (normalized === 'end' || normalized === 'last') {
    return totalPages;
  }
  if (!/^\d+$/.test(normalized)) {
    throw new InvalidRangeError(`Invalid page token "${token}". Use numbers or "end".`);
  }
  const num = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(num) || num < 1 || num > totalPages) {
    throw new InvalidRangeError(`Page ${num} is out of range (1–${totalPages}).`);
  }
  return num;
}

/**
 * Parses a page range expression (e.g. "1-3, 5, 8-end") into groups of 0-based page indices.
 * Enforces strict input length, segment, and total expanded page bounds to prevent memory exhaustion DoS.
 * @param {string} rangeInput - User range string
 * @param {number} totalPages - Total page count in the document
 * @returns {number[][]} Array of 0-based index arrays
 */
export function parsePageRangeGroups(rangeInput, totalPages) {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new InvalidRangeError('Document has no pages to select.');
  }
  if (totalPages > MAX_EXPANDED_PAGES) {
    throw new InvalidRangeError(`Document exceeds maximum supported page count (${MAX_EXPANDED_PAGES}).`);
  }

  const raw = String(rangeInput ?? '');
  if (raw.length > MAX_RANGE_INPUT_LENGTH) {
    throw new InvalidRangeError(`Page range expression is too long (max ${MAX_RANGE_INPUT_LENGTH} characters).`);
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return [Array.from({ length: totalPages }, (_, i) => i)];
  }

  const segments = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    throw new InvalidRangeError('Enter at least one page number or range (e.g. "1-3, 5").');
  }
  if (segments.length > MAX_RANGE_SEGMENTS) {
    throw new InvalidRangeError(`Too many range segments (max ${MAX_RANGE_SEGMENTS}).`);
  }

  /** @type {number[][]} */
  const groups = [];
  let expandedTotal = 0;

  for (const segment of segments) {
    if (segment.includes('-')) {
      const parts = segment.split('-');
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
        throw new InvalidRangeError(`Invalid range syntax "${segment}". Expected "start-end".`);
      }
      const start = parseBound(parts[0], totalPages);
      const end = parseBound(parts[1], totalPages);
      const count = Math.abs(end - start) + 1;
      expandedTotal += count;
      if (expandedTotal > MAX_EXPANDED_PAGES) {
        throw new InvalidRangeError(`Selected page expansion exceeds limit (${MAX_EXPANDED_PAGES} pages).`);
      }

      const step = start <= end ? 1 : -1;
      /** @type {number[]} */
      const group = [];
      for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
        group.push(page - 1);
      }
      groups.push(group);
    } else {
      expandedTotal += 1;
      if (expandedTotal > MAX_EXPANDED_PAGES) {
        throw new InvalidRangeError(`Selected page expansion exceeds limit (${MAX_EXPANDED_PAGES} pages).`);
      }
      const page = parseBound(segment, totalPages);
      groups.push([page - 1]);
    }
  }

  return groups;
}

/**
 * Parses a page range expression into a flat, deduplicated list of 0-based page indices
 * preserving first-seen order.
 * @param {string} rangeInput - User range string (e.g. "1-3, 5, 8-end")
 * @param {number} totalPages - Total page count
 * @returns {number[]} 0-based page indices
 */
export function parsePageRange(rangeInput, totalPages) {
  const groups = parsePageRangeGroups(rangeInput, totalPages);
  const seen = new Set();
  /** @type {number[]} */
  const indices = [];

  for (const group of groups) {
    for (const idx of group) {
      if (!seen.has(idx)) {
        seen.add(idx);
        indices.push(idx);
      }
    }
  }
  return indices;
}
