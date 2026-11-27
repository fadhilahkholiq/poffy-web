import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export const MAX_OOXML_ENTRIES = 1500;
export const MAX_OOXML_UNCOMPRESSED_BYTES = 150 * 1024 * 1024; // 150 MB

const standardXmlDecoder = new TextDecoder('utf-8');

/**
 * Safely decodes standard XML predefined character entities and numeric char references
 * WITHOUT expanding DTD <!ENTITY> definitions.
 * @param {string} str
 * @returns {string}
 */
export function decodeBasicXmlEntities(str) {
  if (!str || !str.includes('&')) return str;
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (match, ent) => {
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'amp') return '&';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = Number.parseInt(ent.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    if (ent.startsWith('#')) {
      const cp = Number.parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    return match;
  });
}

/**
 * Safely unpacks an OOXML zip container (`.docx` / `.pptx`) using `fflate.unzipSync`
 * with strict anti-ZIP-bomb limits (`<= 1,500` entries and `<= 150 MB` uncompressed).
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Record<string, Uint8Array>}
 */
export function safeUnzipOoxml(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength < 4) {
    throw new Error('Invalid or empty Office archive.');
  }

  let entryCount = 0;
  let declaredTotal = 0;

  const rawEntries = unzipSync(bytes, {
    filter(file) {
      entryCount += 1;
      if (entryCount > MAX_OOXML_ENTRIES) {
        throw new Error(
          `Archive exceeds security limit (${MAX_OOXML_ENTRIES} internal entries max).`
        );
      }
      declaredTotal += Number(file.originalSize || 0);
      if (declaredTotal > MAX_OOXML_UNCOMPRESSED_BYTES) {
        throw new Error('Archive exceeds 150 MB uncompressed safety limit.');
      }
      return true;
    }
  });

  let actualTotal = 0;
  /** @type {Record<string, Uint8Array>} */
  const normalized = {};
  for (const [key, val] of Object.entries(rawEntries)) {
    actualTotal += val.byteLength;
    if (actualTotal > MAX_OOXML_UNCOMPRESSED_BYTES) {
      throw new Error('Decompressed archive exceeds 150 MB safety limit.');
    }
    const cleanKey = key.replaceAll('\\', '/').replace(/^\/+/, '');
    normalized[cleanKey] = val;
  }

  return normalized;
}

/**
 * Parses an XML entry from unpacked OOXML files using `fast-xml-parser` with
 * entity expansion disabled (`processEntities: false`).
 * @param {Record<string, Uint8Array>} files
 * @param {string} entryPath
 * @param {{ preserveOrder?: boolean }} [opts={}]
 * @returns {any}
 */
export function readOoxmlXml(files, entryPath, opts = {}) {
  const bytes = files[entryPath];
  if (!bytes) return null;
  const xmlText = standardXmlDecoder.decode(bytes);
  const parser = new XMLParser({
    processEntities: false,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: Boolean(opts.preserveOrder),
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false
  });
  return parser.parse(xmlText);
}

/**
 * Resolves a relative OOXML relationship target against a base directory cleanly.
 * @param {string} baseDir - e.g. 'word' or 'ppt/slides'
 * @param {string} target - e.g. '../media/image1.png' or 'media/image1.png'
 * @returns {string}
 */
export function resolveOoxmlTargetPath(baseDir, target) {
  const cleanTarget = String(target || '').replaceAll('\\', '/');
  if (cleanTarget.startsWith('/')) {
    return cleanTarget.replace(/^\/+/, '');
  }
  const baseParts = baseDir ? baseDir.split('/').filter(Boolean) : [];
  const targetParts = cleanTarget.split('/').filter(Boolean);
  const resolved = [...baseParts];
  for (const part of targetParts) {
    if (part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

/**
 * Parses an OOXML `.rels` XML file into a map keyed by relationship `Id`.
 * @param {Record<string, Uint8Array>} files
 * @param {string} relsPath
 * @returns {Map<string, { id: string, type: string, target: string, targetMode: string }>}
 */
export function parseRelsMap(files, relsPath) {
  /** @type {Map<string, { id: string, type: string, target: string, targetMode: string }>} */
  const map = new Map();
  const parsed = readOoxmlXml(files, relsPath, { preserveOrder: false });
  if (!parsed?.Relationships?.Relationship) return map;
  const rels = Array.isArray(parsed.Relationships.Relationship)
    ? parsed.Relationships.Relationship
    : [parsed.Relationships.Relationship];

  for (const r of rels) {
    const id = String(r?.['@_Id'] || '');
    if (!id) continue;
    map.set(id, {
      id,
      type: String(r?.['@_Type'] || ''),
      target: String(r?.['@_Target'] || ''),
      targetMode: String(r?.['@_TargetMode'] || '')
    });
  }
  return map;
}
