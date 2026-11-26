import { unzipSync, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { assertNotAborted, yieldToLoop } from './doc-loader.js';
import { detectImageFormat } from './convert.js';

const VALID_CBZ_IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const MAX_CBZ_ENTRIES = 2500;

/**
 * Checks whether a ZIP entry path inside a `.cbz` archive is a valid visible comic image page.
 * Excludes directories, `__MACOSX/`, and hidden dotfiles (`.*`).
 * @param {string} entryPath
 * @returns {boolean}
 */
export function isValidCbzImagePath(entryPath) {
  const norm = String(entryPath || '').replace(/\\/g, '/');
  if (!norm || norm.endsWith('/')) return false;
  const segments = norm.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.some((seg) => seg.toUpperCase() === '__MACOSX' || seg.startsWith('.'))) {
    return false;
  }
  return VALID_CBZ_IMAGE_RE.test(segments[segments.length - 1]);
}

/**
 * Unpacks and returns sorted image filenames from a `.cbz` archive using natural numeric collation.
 * @param {ArrayBuffer|Uint8Array} cbzBytes
 * @returns {{ entries: { path: string, data: Uint8Array }[], fileNames: string[] }}
 */
export function unpackSortedCbzEntries(cbzBytes) {
  const raw = cbzBytes instanceof Uint8Array ? cbzBytes : new Uint8Array(cbzBytes);
  const filesMap = unzipSync(raw);
  const paths = Object.keys(filesMap)
    .filter((p) => isValidCbzImagePath(p) && filesMap[p]?.byteLength > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  if (paths.length === 0) {
    throw new Error('No supported comic image pages (.jpg, .png, .webp, .gif) found inside CBZ.');
  }
  if (paths.length > MAX_CBZ_ENTRIES) {
    throw new Error(`CBZ archive exceeds maximum supported page count (${MAX_CBZ_ENTRIES}).`);
  }

  return {
    entries: paths.map((path) => ({ path, data: filesMap[path] })),
    fileNames: paths
  };
}

/**
 * Decodes GIF/WebP (or non-PDF-native) raster bytes into PNG via OffscreenCanvas with strict cleanup.
 * @param {Uint8Array} bytes
 * @param {string} pathName
 * @returns {Promise<{ bytes: Uint8Array, format: 'png'|'jpg' }>}
 */
async function normalizeCbzImageBytes(bytes, pathName) {
  const lower = pathName.toLowerCase();
  const isGif = lower.endsWith('.gif') || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46);
  const detected = isGif ? 'gif' : detectImageFormat(bytes, '', pathName);
  if (detected === 'png' || detected === 'jpg') {
    return { bytes, format: detected };
  }

  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error(`OffscreenCanvas is required to decode ${pathName}.`);
  }

  const mime = isGif ? 'image/gif' : 'image/webp';
  const blob = new Blob([bytes], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(Math.max(1, bitmap.width), Math.max(1, bitmap.height));
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to acquire 2D context on OffscreenCanvas.');
    ctx.drawImage(bitmap, 0, 0);
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), format: 'png' };
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Converts a `.cbz` comic archive into a PDF document inside a Web Worker.
 * @param {ArrayBuffer|Uint8Array} cbzBytes
 * @param {{ uniformWidth?: boolean, targetWidthPt?: number }} [config={}]
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, fileNames: string[] }>}
 */
export async function cbzToPdf(cbzBytes, config = {}, options = {}) {
  const { uniformWidth = false, targetWidthPt = 595.28 } = config;
  const { onProgress, abortToken } = options;

  onProgress?.(5, 'Unpacking CBZ archive...');
  const { entries, fileNames } = unpackSortedCbzEntries(cbzBytes);
  const doc = await PDFDocument.create();
  const safeTargetW = Math.max(180, Math.min(2400, Number(targetWidthPt) || 595.28));

  for (let i = 0; i < entries.length; i += 1) {
    assertNotAborted(abortToken);
    const entry = entries[i];
    const norm = await normalizeCbzImageBytes(entry.data, entry.path);
    const embedded =
      norm.format === 'png' ? await doc.embedPng(norm.bytes) : await doc.embedJpg(norm.bytes);
    const dims = embedded.scale(1);

    const outW = uniformWidth ? safeTargetW : dims.width;
    const outH = uniformWidth ? dims.height * (safeTargetW / Math.max(1, dims.width)) : dims.height;

    const page = doc.addPage([outW, outH]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: outW,
      height: outH
    });

    if ((i + 1) % 4 === 0 || i === entries.length - 1) {
      onProgress?.(
        10 + Math.round(((i + 1) / entries.length) * 80),
        `Packing page ${i + 1} of ${entries.length} (${entry.path})...`,
        i + 1,
        entries.length
      );
      await yieldToLoop();
    }
  }

  assertNotAborted(abortToken);
  onProgress?.(94, 'Serializing PDF from CBZ...');
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  onProgress?.(100, 'CBZ to PDF complete.');

  return {
    bytes,
    pageCount: entries.length,
    fileNames
  };
}

/**
 * Converts a PDF buffer into a `.cbz` comic archive using `pdfjs-dist` + `OffscreenCanvas`
 * and zero-compression store-mode `fflate.zipSync(..., { level: 0 })`.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {{ scale?: number, format?: 'webp'|'jpeg'|'png', quality?: number }} [config={}]
 * @param {string} [fileName='']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, entryNames: string[] }>}
 */
export async function pdfToCbz(pdfBytes, config = {}, fileName = '', options = {}) {
  const { scale = 2.0, format = 'webp', quality = 0.88 } = config;
  const { onProgress, abortToken } = options;

  const safeScale = Math.max(1.0, Math.min(3.0, Number(scale) || 2.0));
  const safeQuality = Math.max(0.5, Math.min(0.98, Number(quality) || 0.88));
  const mime =
    format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
  const ext = format === 'png' ? 'png' : format === 'jpeg' ? 'jpg' : 'webp';

  onProgress?.(5, 'Loading PDF for CBZ rasterization...');
  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);

  try {
    const total = pdfjsDoc.numPages;
    if (total > MAX_CBZ_ENTRIES) {
      throw new Error(`PDF exceeds maximum CBZ page limit (${MAX_CBZ_ENTRIES}).`);
    }
    /** @type {Record<string, Uint8Array>} */
    const archiveMap = {};
    const entryNames = [];

    for (let i = 0; i < total; i += 1) {
      assertNotAborted(abortToken);
      const rendered = await renderPdfJsPageToCanvas(pdfjsDoc, i, safeScale, 0);
      let imgBytes;
      try {
        const blob = await rendered.canvas.convertToBlob({
          type: mime,
          quality: format === 'png' ? undefined : safeQuality
        });
        imgBytes = new Uint8Array(await blob.arrayBuffer());
      } finally {
        rendered.cleanup();
      }

      const entryName = `${String(i + 1).padStart(4, '0')}.${ext}`;
      archiveMap[entryName] = imgBytes;
      entryNames.push(entryName);

      onProgress?.(
        10 + Math.round(((i + 1) / Math.max(1, total)) * 82),
        `Rendering CBZ page ${i + 1} of ${total}...`,
        i + 1,
        total
      );
      await yieldToLoop();
    }

    assertNotAborted(abortToken);
    onProgress?.(95, 'Packing CBZ archive (store mode)...', total, total);
    const bytes = zipSync(archiveMap, { level: 0 });
    onProgress?.(100, 'PDF to CBZ complete.', total, total);

    return {
      bytes,
      pageCount: total,
      entryNames
    };
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}
