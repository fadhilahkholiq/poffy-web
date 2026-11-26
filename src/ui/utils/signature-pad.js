/**
 * Local-only HTML5 Canvas Signature Creator & Local Tray storage utilities (FEAT-02).
 *
 * Local Font Asset Note:
 * Only `/fonts/Inter-Regular.ttf` is currently bundled in `public/fonts/`.
 * Zero external fonts (no Google Fonts / CDNs) are ever fetched.
 * Optional additional local cursive `.ttf` files can be placed in `public/fonts/`
 * and referenced locally; styled typed signatures below render offline onto an
 * offscreen HTML5 Canvas using local/system fonts and export as transparent PNGs.
 */

const SAVED_SIGNATURES_STORAGE_KEY = 'poffy_saved_signatures_v1';
const MAX_SAVED_SIGNATURES = 6;

/**
 * Local offline typography presets for typed signatures.
 * @type {{ id: string, label: string, cssFont: string }[]}
 */
export const TYPED_SIGNATURE_STYLES = [
  {
    id: 'script',
    label: 'Calligraphic Script',
    cssFont: 'italic 600 68px "Brush Script MT", "Segoe Script", "Apple Chancery", Georgia, serif'
  },
  {
    id: 'editorial',
    label: 'Editorial Italic',
    cssFont: 'italic 500 62px Georgia, "Times New Roman", serif'
  },
  {
    id: 'clean',
    label: 'Clean Sans (Inter)',
    cssFont: '600 56px "Inter", system-ui, -apple-system, sans-serif'
  }
];

/**
 * Trims transparent outer padding around drawn strokes on a canvas and exports PNG bytes + Data URL.
 * Returns `null` if the canvas has zero non-transparent pixels.
 * @param {HTMLCanvasElement} canvas
 * @param {number} [padding=8]
 * @returns {Promise<{ bytes: Uint8Array, dataUrl: string, width: number, height: number }|null>}
 */
export async function trimCanvasToTransparentPng(canvas, padding = 8) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || w <= 0 || h <= 0) return null;

  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const x0 = Math.max(0, minX - padding);
  const y0 = Math.max(0, minY - padding);
  const outW = Math.min(w - x0, maxX - minX + 1 + padding * 2);
  const outH = Math.min(h - y0, maxY - minY + 1 + padding * 2);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;
  outCtx.drawImage(canvas, x0, y0, outW, outH, 0, 0, outW, outH);

  const blob = await new Promise((resolve) => outCanvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataUrl = outCanvas.toDataURL('image/png');

  outCanvas.width = 0;
  outCanvas.height = 0;
  return { bytes, dataUrl, width: outW, height: outH };
}

/**
 * Renders a typed signature string locally onto a transparent canvas and trims to tight PNG bounds.
 * @param {string} name
 * @param {string} [styleId='script']
 * @param {string} [color='#0a0a0a']
 * @returns {Promise<{ bytes: Uint8Array, dataUrl: string, width: number, height: number }|null>}
 */
export async function renderTypedSignaturePng(name, styleId = 'script', color = '#0a0a0a') {
  const clean = String(name || '').trim();
  if (!clean) return null;

  const style = TYPED_SIGNATURE_STYLES.find((s) => s.id === styleId) || TYPED_SIGNATURE_STYLES[0];
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = style.cssFont;
  ctx.fillStyle = color || '#0a0a0a';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(clean, canvas.width / 2, canvas.height / 2, canvas.width - 48);

  const result = await trimCanvasToTransparentPng(canvas, 10);
  canvas.width = 0;
  canvas.height = 0;
  return result;
}

/**
 * Decodes an uploaded PNG, WebP, or JPG signature File into transparent PNG bytes + Data URL.
 * @param {File} file
 * @returns {Promise<{ bytes: Uint8Array, dataUrl: string, width: number, height: number }>}
 */
export async function normalizeSignatureImageFile(file) {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, bmp.width);
  canvas.height = Math.max(1, bmp.height);
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize signature canvas.');
    ctx.drawImage(bmp, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to encode signature image as PNG.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dataUrl = canvas.toDataURL('image/png');
    return { bytes, dataUrl, width: canvas.width, height: canvas.height };
  } finally {
    bmp.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Converts a PNG Data URL stored locally back into `Uint8Array` bytes without network requests.
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
export function pngDataUrlToBytes(dataUrl) {
  const commaIdx = String(dataUrl || '').indexOf(',');
  if (commaIdx < 0) return new Uint8Array(0);
  const b64 = dataUrl.slice(commaIdx + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * Loads saved local signature data URLs from localStorage safely.
 * @returns {{ id: string, dataUrl: string, width: number, height: number, label: string }[]}
 */
export function loadSavedSignatures() {
  try {
    const raw = localStorage.getItem(SAVED_SIGNATURES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => typeof item?.dataUrl === 'string' && item.dataUrl.startsWith('data:image/png;base64,')
    );
  } catch {
    return [];
  }
}

/**
 * Saves a transparent PNG signature locally into the user's browser tray.
 * @param {{ id: string, dataUrl: string, width: number, height: number, label: string }} entry
 */
export function saveSignatureLocally(entry) {
  try {
    const current = loadSavedSignatures().filter((s) => s.dataUrl !== entry.dataUrl);
    const next = [entry, ...current].slice(0, MAX_SAVED_SIGNATURES);
    localStorage.setItem(SAVED_SIGNATURES_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/**
 * Clears all locally saved signatures from localStorage.
 */
export function clearSavedSignaturesLocally() {
  try {
    localStorage.removeItem(SAVED_SIGNATURES_STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted browsing modes
  }
}
