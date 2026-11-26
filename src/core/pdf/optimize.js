import { unzlibSync } from 'fflate';
import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { applyMetadataToDocument, deepScrubPdf } from './metadata.js';

/**
 * @typedef {'lossless'|'balanced'|'maximum'} OptimizePreset
 */

/**
 * @typedef {Object} OptimizeConfig
 * @property {OptimizePreset} [preset='lossless'] - Optimization mode
 * @property {boolean} [useObjectStreams=true] - Compress cross-reference and object streams
 * @property {boolean} [rebuildCleanCopy=true] - Copy pages into fresh document to drop orphan objects
 * @property {boolean} [stripMetadata=false] - Also scrub Info/XMP metadata
 * @property {number} [targetDpi=150] - Target DPI for balanced downsampling or maximum rasterization
 * @property {number} [jpegQuality=0.75] - JPEG quality (0.5 - 0.85)
 * @property {(percent: number, stage: string, current?: number, total?: number) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Resolves a PDF dictionary value through context lookup if it is an indirect reference.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} value
 * @returns {any}
 */
function lookupVal(context, value) {
  return value ? context.lookup(value) : undefined;
}

/**
 * Reads numeric value from a PDFNumber or indirect ref.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} val
 * @returns {number|null}
 */
function readPdfNum(context, val) {
  const resolved = lookupVal(context, val);
  return resolved instanceof PDFNumber ? resolved.asNumber() : null;
}

/**
 * Normalizes /Filter into a single filter name string if simple, or null if unsupported multi-filter.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} filterObj
 * @returns {string|null}
 */
function resolveSingleFilterName(context, filterObj) {
  const resolved = lookupVal(context, filterObj);
  if (!resolved) return 'RAW';
  if (resolved instanceof PDFName) return resolved.decodeText();
  if (resolved instanceof PDFArray && resolved.size() === 1) {
    const first = lookupVal(context, resolved.get(0));
    if (first instanceof PDFName) return first.decodeText();
  }
  return null;
}

/**
 * Attempts to decode an RGB/Grayscale image stream (DCTDecode or FlateDecode) into an ImageBitmap.
 * Returns null if decoding is unsafe or unsupported.
 * @param {PDFRawStream} stream
 * @param {string} filterName
 * @param {string} colorSpaceName
 * @param {number} width
 * @param {number} height
 * @param {number} bitsPerComponent
 * @returns {Promise<ImageBitmap|null>}
 */
async function decodeImageStreamToBitmap(
  stream,
  filterName,
  colorSpaceName,
  width,
  height,
  bitsPerComponent
) {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return null;
  }

  if (filterName === 'DCTDecode') {
    const blob = new Blob([stream.contents], { type: 'image/jpeg' });
    return createImageBitmap(blob);
  }

  if (filterName === 'FlateDecode' || filterName === 'RAW') {
    if (bitsPerComponent !== 8) return null;
    const rawPixels =
      filterName === 'FlateDecode' ? unzlibSync(stream.contents) : stream.contents;
    const channels = colorSpaceName === 'DeviceGray' ? 1 : 3;
    const expectedLength = width * height * channels;
    if (rawPixels.length !== expectedLength) {
      // Skip streams using PNG predictors or mismatching layout safely
      return null;
    }

    const rgba = new Uint8ClampedArray(width * height * 4);
    if (channels === 1) {
      for (let i = 0, p = 0; i < rawPixels.length; i += 1, p += 4) {
        const g = rawPixels[i];
        rgba[p] = g;
        rgba[p + 1] = g;
        rgba[p + 2] = g;
        rgba[p + 3] = 255;
      }
    } else {
      for (let i = 0, p = 0; i < rawPixels.length; i += 3, p += 4) {
        rgba[p] = rawPixels[i];
        rgba[p + 1] = rawPixels[i + 1];
        rgba[p + 2] = rawPixels[i + 2];
        rgba[p + 3] = 255;
      }
    }

    const tmp = new OffscreenCanvas(width, height);
    const ctx = tmp.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    const bmp = await createImageBitmap(tmp);
    tmp.width = 0;
    tmp.height = 0;
    return bmp;
  }

  return null;
}

/**
 * Smart XObject Recompression (Vector-Safe): traverses image streams, skips complex masks/CMYK/Indexed,
 * downsamples oversized images via OffscreenCanvas, and replaces with DCTDecode JPEG if smaller.
 * @param {PDFDocument} pdfDoc
 * @param {{ targetDpi: number, jpegQuality: number, onProgress?: Function, abortToken?: { aborted?: boolean } }} opts
 * @returns {Promise<{ recompressedImages: number, skippedImages: number }>}
 */
async function recompressImageXObjects(pdfDoc, opts) {
  const { targetDpi, jpegQuality, onProgress, abortToken } = opts;
  const maxEdgePx = Math.max(480, Math.round((targetDpi / 72) * 850));

  /** @type {[import('pdf-lib').PDFRef, PDFRawStream][]} */
  const imageObjects = [];
  for (const [ref, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const subtype = lookupVal(pdfDoc.context, obj.dict.get(PDFName.of('Subtype')));
      if (subtype === PDFName.of('Image')) {
        imageObjects.push([ref, obj]);
      }
    }
  }

  let recompressedImages = 0;
  let skippedImages = 0;

  for (let i = 0; i < imageObjects.length; i += 1) {
    assertNotAborted(abortToken);
    const [ref, stream] = imageObjects[i];
    const dict = stream.dict;

    try {
      // Skip alpha masks, stencil masks, or decode-remapped images
      if (
        dict.has(PDFName.of('SMask')) ||
        dict.has(PDFName.of('Mask')) ||
        dict.has(PDFName.of('ImageMask')) ||
        dict.has(PDFName.of('DecodeParms'))
      ) {
        skippedImages += 1;
        continue;
      }

      const cs = lookupVal(pdfDoc.context, dict.get(PDFName.of('ColorSpace')));
      const csName = cs instanceof PDFName ? cs.decodeText() : null;
      if (csName !== 'DeviceRGB' && csName !== 'DeviceGray') {
        skippedImages += 1;
        continue;
      }

      const filterName = resolveSingleFilterName(pdfDoc.context, dict.get(PDFName.of('Filter')));
      if (!filterName || (filterName !== 'DCTDecode' && filterName !== 'FlateDecode' && filterName !== 'RAW')) {
        skippedImages += 1;
        continue;
      }

      const width = readPdfNum(pdfDoc.context, dict.get(PDFName.of('Width')));
      const height = readPdfNum(pdfDoc.context, dict.get(PDFName.of('Height')));
      const bpc = readPdfNum(pdfDoc.context, dict.get(PDFName.of('BitsPerComponent'))) ?? 8;

      if (!width || !height || width < 64 || height < 64 || width > 12000 || height > 12000) {
        skippedImages += 1;
        continue;
      }

      const bitmap = await decodeImageStreamToBitmap(
        stream,
        filterName,
        csName,
        width,
        height,
        bpc
      );
      if (!bitmap) {
        skippedImages += 1;
        continue;
      }

      let outW = bitmap.width;
      let outH = bitmap.height;
      const maxDim = Math.max(outW, outH);
      if (maxDim > maxEdgePx) {
        const ratio = maxEdgePx / maxDim;
        outW = Math.max(1, Math.round(outW * ratio));
        outH = Math.max(1, Math.round(outH * ratio));
      }

      const canvas = new OffscreenCanvas(outW, outH);
      try {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          skippedImages += 1;
          continue;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(bitmap, 0, 0, outW, outH);

        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: jpegQuality });
        const jpegBytes = new Uint8Array(await blob.arrayBuffer());

        // Keep original stream if re-encoded JPEG is not meaningfully smaller
        if (jpegBytes.byteLength >= stream.contents.byteLength * 0.95) {
          skippedImages += 1;
          continue;
        }

        const newDict = pdfDoc.context.obj({
          Type: 'XObject',
          Subtype: 'Image',
          Width: outW,
          Height: outH,
          ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8,
          Filter: 'DCTDecode',
          Length: jpegBytes.byteLength
        });
        pdfDoc.context.assign(ref, PDFRawStream.of(newDict, jpegBytes));
        recompressedImages += 1;
      } finally {
        bitmap.close();
        canvas.width = 0;
        canvas.height = 0;
      }
    } catch {
      // Corrupted or unsupported XObject stream: skip gracefully
      skippedImages += 1;
    }

    if ((i + 1) % 4 === 0 || i === imageObjects.length - 1) {
      const pct = 50 + Math.round(((i + 1) / Math.max(1, imageObjects.length)) * 38);
      onProgress?.(
        pct,
        `Recompressing embedded image ${i + 1} of ${imageObjects.length}...`,
        i + 1,
        imageObjects.length
      );
      await yieldToLoop();
    }
  }

  return { recompressedImages, skippedImages };
}

/**
 * Maximum (Raster Optimization / Scan Mode): rasterizes every page via pdfjs-dist at targetDpi
 * and rebuilds a JPEG-backed PDF via pdf-lib. Removes text searchability.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {{ targetDpi: number, jpegQuality: number, useObjectStreams: boolean, stripMetadata: boolean, fileName: string, onProgress?: Function, abortToken?: { aborted?: boolean } }} opts
 * @returns {Promise<Uint8Array>}
 */
async function rasterOptimizePdf(pdfBytes, opts) {
  const {
    targetDpi,
    jpegQuality,
    useObjectStreams,
    stripMetadata,
    fileName,
    onProgress,
    abortToken
  } = opts;

  const scale = Math.max(0.5, Math.min(3, targetDpi / 72));
  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);

  try {
    const total = pdfjsDoc.numPages;
    const outDoc = await PDFDocument.create();

    for (let i = 0; i < total; i += 1) {
      assertNotAborted(abortToken);
      const rendered = await renderPdfJsPageToCanvas(pdfjsDoc, i, scale, 0);
      let jpegBytes;
      let ptWidth;
      let ptHeight;
      try {
        const baseVp = rendered.page.getViewport({ scale: 1, rotation: rendered.page.rotate });
        ptWidth = baseVp.width;
        ptHeight = baseVp.height;
        const blob = await rendered.canvas.convertToBlob({
          type: 'image/jpeg',
          quality: jpegQuality
        });
        jpegBytes = new Uint8Array(await blob.arrayBuffer());
      } finally {
        rendered.cleanup();
      }

      const embedded = await outDoc.embedJpg(jpegBytes);
      const page = outDoc.addPage([ptWidth, ptHeight]);
      page.drawImage(embedded, {
        x: 0,
        y: 0,
        width: ptWidth,
        height: ptHeight
      });

      const pct = 15 + Math.round(((i + 1) / Math.max(1, total)) * 75);
      onProgress?.(pct, `Rasterizing page ${i + 1} of ${total} (${targetDpi} DPI)...`, i + 1, total);
      await yieldToLoop();
    }

    if (stripMetadata) {
      deepScrubPdf(outDoc, {
        scrubInfo: true,
        purgeXmp: true,
        removeThumbnails: true,
        stripScriptsAndActions: true
      });
    }

    assertNotAborted(abortToken);
    onProgress?.(94, 'Serializing rasterized PDF...', total, total);
    return outDoc.save({ useObjectStreams, addDefaultPage: false });
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}

/**
 * Re-saves or compresses a PDF buffer using Lossless Structure, Balanced Smart XObject Recompression,
 * or Maximum Raster Optimization.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Input PDF bytes
 * @param {OptimizeConfig} [config={}] - Optimization options
 * @param {string} [fileName=''] - Optional filename for error context
 * @returns {Promise<{ bytes: Uint8Array, originalSize: number, optimizedSize: number, recompressedImages: number, skippedImages: number, preset: OptimizePreset }>}
 */
export async function optimizePdfBuffer(pdfBytes, config = {}, fileName = '') {
  const {
    preset = 'lossless',
    useObjectStreams = true,
    rebuildCleanCopy = true,
    stripMetadata = false,
    targetDpi = preset === 'maximum' ? 110 : 150,
    jpegQuality = 0.75,
    onProgress,
    abortToken
  } = config;

  const originalSize = pdfBytes.byteLength;
  const safeDpi = Math.max(72, Math.min(240, Number(targetDpi) || 150));
  const safeQuality = Math.max(0.45, Math.min(0.92, Number(jpegQuality) || 0.75));

  assertNotAborted(abortToken);
  onProgress?.(10, 'Inspecting PDF structure...');

  if (preset === 'maximum') {
    const bytes = await rasterOptimizePdf(pdfBytes, {
      targetDpi: safeDpi,
      jpegQuality: safeQuality,
      useObjectStreams,
      stripMetadata,
      fileName,
      onProgress,
      abortToken
    });
    onProgress?.(100, 'Raster optimization complete.');
    return {
      bytes,
      originalSize,
      optimizedSize: bytes.byteLength,
      recompressedImages: 0,
      skippedImages: 0,
      preset
    };
  }

  const srcDoc = await loadPdfSafe(pdfBytes, fileName);
  let targetDoc = srcDoc;

  if (rebuildCleanCopy) {
    const cleanDoc = await PDFDocument.create();
    const total = srcDoc.getPageCount();
    const BATCH = 20;
    for (let i = 0; i < total; i += BATCH) {
      assertNotAborted(abortToken);
      const slice = Array.from({ length: Math.min(BATCH, total - i) }, (_, k) => i + k);
      const copied = await cleanDoc.copyPages(srcDoc, slice);
      for (const page of copied) {
        cleanDoc.addPage(page);
      }
      onProgress?.(
        15 + Math.round(((i + slice.length) / Math.max(1, total)) * 35),
        'Pruning unused objects...',
        i + slice.length,
        total
      );
      await yieldToLoop();
    }

    if (!stripMetadata) {
      const title = srcDoc.getTitle();
      const author = srcDoc.getAuthor();
      const subject = srcDoc.getSubject();
      if (title) cleanDoc.setTitle(title);
      if (author) cleanDoc.setAuthor(author);
      if (subject) cleanDoc.setSubject(subject);
    }

    targetDoc = cleanDoc;
  }

  let recompressedImages = 0;
  let skippedImages = 0;
  if (preset === 'balanced') {
    const stats = await recompressImageXObjects(targetDoc, {
      targetDpi: safeDpi,
      jpegQuality: safeQuality,
      onProgress,
      abortToken
    });
    recompressedImages = stats.recompressedImages;
    skippedImages = stats.skippedImages;
  }

  if (stripMetadata) {
    applyMetadataToDocument(targetDoc, { stripAll: true });
  }

  assertNotAborted(abortToken);
  onProgress?.(92, 'Compressing object streams...');
  const bytes = await targetDoc.save({
    useObjectStreams,
    addDefaultPage: false
  });

  onProgress?.(100, 'Optimization complete.');
  return {
    bytes,
    originalSize,
    optimizedSize: bytes.byteLength,
    recompressedImages,
    skippedImages,
    preset
  };
}
