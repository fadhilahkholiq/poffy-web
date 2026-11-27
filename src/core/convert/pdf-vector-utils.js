import { StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getUnicodeFallbackFontBytes, parseHexColor } from '../pdf/font-helper.js';
import { isWinAnsiCompatible } from '../utils/winansi.js';

export { parseHexColor };

/**
 * Manages cached WinAnsi StandardFonts and on-demand @pdf-lib/fontkit Inter Unicode fallback font
 * inside a PDFDocument so Unicode characters never throw encoding errors.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 */
export function createVectorFontManager(pdfDoc) {
  /** @type {Map<string, Promise<import('pdf-lib').PDFFont>>} */
  const cache = new Map();
  /** @type {Promise<import('pdf-lib').PDFFont>|null} */
  let unicodePromise = null;

  const getStandard = (styleKey) => {
    if (!cache.has(styleKey)) {
      let stdName = StandardFonts.Helvetica;
      if (styleKey === 'bold') stdName = StandardFonts.HelveticaBold;
      else if (styleKey === 'italic') stdName = StandardFonts.HelveticaOblique;
      else if (styleKey === 'bold-italic') stdName = StandardFonts.HelveticaBoldOblique;
      cache.set(styleKey, pdfDoc.embedFont(stdName));
    }
    return /** @type {Promise<import('pdf-lib').PDFFont>} */ (cache.get(styleKey));
  };

  const getUnicode = () => {
    if (!unicodePromise) {
      unicodePromise = (async () => {
        pdfDoc.registerFontkit(fontkit);
        const bytes = await getUnicodeFallbackFontBytes();
        return pdfDoc.embedFont(bytes, { subset: true });
      })();
    }
    return unicodePromise;
  };

  /**
   * Resolves a font matching bold/italic hints, falling back to local Inter TTF if text has non-WinAnsi glyphs.
   * @param {string} text
   * @param {{ bold?: boolean, italic?: boolean }} [style={}]
   * @returns {Promise<import('pdf-lib').PDFFont>}
   */
  const resolveFont = async (text, style = {}) => {
    if (text && !isWinAnsiCompatible(text)) {
      return getUnicode();
    }
    const key =
      style.bold && style.italic
        ? 'bold-italic'
        : style.bold
          ? 'bold'
          : style.italic
            ? 'italic'
            : 'regular';
    return getStandard(key);
  };

  return { resolveFont };
}

/**
 * Safely wraps a paragraph/cell string against `maxWidth` using actual font glyph measurement.
 * @param {string} text
 * @param {import('pdf-lib').PDFFont} font
 * @param {number} fontSize
 * @param {number} maxWidth
 * @returns {string[]}
 */
export function wrapTextToWidth(text, font, fontSize, maxWidth) {
  const safeMax = Math.max(18, maxWidth);
  const str = String(text ?? '').replace(/\r\n/g, '\n');
  if (!str) return [''];

  /** @type {string[]} */
  const out = [];
  const rawParagraphs = str.split('\n');

  for (const rawPara of rawParagraphs) {
    const words = rawPara.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push('');
      continue;
    }

    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= safeMax) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          out.push(currentLine);
          currentLine = '';
        }
        // Break overly long unspaced tokens by character
        if (font.widthOfTextAtSize(word, fontSize) <= safeMax) {
          currentLine = word;
        } else {
          let chunk = '';
          for (const ch of word) {
            if (chunk && font.widthOfTextAtSize(chunk + ch, fontSize) > safeMax) {
              out.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          currentLine = chunk;
        }
      }
    }
    if (currentLine) out.push(currentLine);
  }

  return out.length > 0 ? out : [''];
}

/**
 * Detects PNG or JPEG magic bytes and embeds an image safely into a PDFDocument.
 * Returns null without throwing if the binary is an unsupported vector/metafile format.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {Uint8Array|undefined|null} bytes
 * @returns {Promise<import('pdf-lib').PDFImage|null>}
 */
export async function embedRasterImageSafe(pdfDoc, bytes) {
  if (!bytes || bytes.byteLength < 8) return null;
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isPng && !isJpeg) return null;

  try {
    return isPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch {
    return null;
  }
}
