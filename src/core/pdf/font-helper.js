import { StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { isWinAnsiCompatible } from '../utils/winansi.js';

export { isWinAnsiCompatible };

/** @type {Uint8Array|null} */
let cachedFallbackFontBytes = null;

/**
 * Parses a CSS hex color string (e.g. "#0a0a0a" or "#ff4d8b") into a pdf-lib RGB color.
 * @param {string} hex - Hex color string
 * @returns {ReturnType<typeof rgb>}
 */
export function parseHexColor(hex) {
  const clean = String(hex || '#0a0a0a').replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);

  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) {
    return rgb(0.04, 0.04, 0.04);
  }
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return rgb(r, g, b);
}

/**
 * Loads the bundled local Unicode fallback font (/fonts/Inter-Regular.ttf) once and caches it.
 * Strictly same-origin ('self'); never touches external networks.
 * @param {Uint8Array|ArrayBuffer|null} [providedBytes] - Optional preloaded font bytes
 * @returns {Promise<Uint8Array>}
 */
export async function getUnicodeFallbackFontBytes(providedBytes = null) {
  if (providedBytes) {
    return providedBytes instanceof Uint8Array ? providedBytes : new Uint8Array(providedBytes);
  }
  if (cachedFallbackFontBytes) {
    return cachedFallbackFontBytes;
  }
  const origin = globalThis.location?.origin;
  if (!origin || origin === 'null') {
    throw new Error('Cannot resolve local /fonts/Inter-Regular.ttf without origin.');
  }
  const fontUrl = new URL('/fonts/Inter-Regular.ttf', origin).href;
  const response = await fetch(fontUrl);
  if (!response.ok) {
    throw new Error(`Failed to load bundled local font: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  cachedFallbackFontBytes = new Uint8Array(buffer);
  return cachedFallbackFontBytes;
}

/**
 * Maps a UI font choice to pdf-lib StandardFonts.
 * @param {string} family - 'Helvetica' | 'HelveticaBold' | 'TimesRoman' | 'Courier' | 'Inter'
 * @returns {string}
 */
function resolveStandardFontName(family) {
  switch (family) {
    case 'HelveticaBold':
      return StandardFonts.HelveticaBold;
    case 'TimesRoman':
      return StandardFonts.TimesRoman;
    case 'Courier':
      return StandardFonts.Courier;
    case 'Helvetica':
    default:
      return StandardFonts.Helvetica;
  }
}

/**
 * Resolves and embeds an appropriate PDFFont for the given text.
 * Automatically falls back to @pdf-lib/fontkit + bundled Inter-Regular.ttf if non-WinAnsi characters are present.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target PDF document
 * @param {string} text - Text to render
 * @param {string} [fontFamily='Helvetica'] - Requested font family
 * @param {Uint8Array|ArrayBuffer|null} [fallbackFontBytes=null] - Optional custom TTF bytes
 * @returns {Promise<{ font: import('pdf-lib').PDFFont, usedUnicodeFallback: boolean }>}
 */
export async function embedFontForText(
  pdfDoc,
  text,
  fontFamily = 'Helvetica',
  fallbackFontBytes = null
) {
  const needsUnicode = fontFamily === 'Inter' || !isWinAnsiCompatible(text);
  if (needsUnicode) {
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = await getUnicodeFallbackFontBytes(fallbackFontBytes);
    const font = await pdfDoc.embedFont(fontBytes, { subset: true });
    return { font, usedUnicodeFallback: true };
  }

  const font = await pdfDoc.embedFont(resolveStandardFontName(fontFamily));
  return { font, usedUnicodeFallback: false };
}
