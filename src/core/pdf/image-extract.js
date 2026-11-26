import { unzlibSync, zlibSync } from 'fflate';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { createZipArchive } from '../utils/zip.js';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';

/**
 * Computes fast FNV-1a 32-bit hash over a Uint8Array for stream deduplication.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${bytes.length}_${(h >>> 0).toString(16)}`;
}

/**
 * Resolves a numeric value from a PDF dictionary field.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} val
 * @returns {number|null}
 */
function readNum(context, val) {
  const resolved = val ? context.lookup(val) : undefined;
  return resolved instanceof PDFNumber ? resolved.asNumber() : null;
}

/**
 * Resolves PDF `/Filter` to a single filter name string.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} filterVal
 * @returns {string|null}
 */
function resolveFilter(context, filterVal) {
  const f = filterVal ? context.lookup(filterVal) : undefined;
  if (!f) return 'RAW';
  if (f instanceof PDFName) return f.decodeText();
  if (f instanceof PDFArray && f.size() === 1) {
    const first = context.lookup(f.get(0));
    if (first instanceof PDFName) return first.decodeText();
  }
  return null;
}

/**
 * Resolves `/ColorSpace` into `'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK' | null`.
 * Handles `/ICCBased` arrays by checking stream `/N` channel count.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} csVal
 * @returns {'DeviceRGB'|'DeviceGray'|'DeviceCMYK'|null}
 */
function resolveColorSpace(context, csVal) {
  const cs = csVal ? context.lookup(csVal) : undefined;
  if (cs instanceof PDFName) {
    const name = cs.decodeText();
    if (name === 'DeviceRGB' || name === 'DeviceGray' || name === 'DeviceCMYK') {
      return name;
    }
  }
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const tag = context.lookup(cs.get(0));
    if (tag instanceof PDFName && tag.decodeText() === 'ICCBased') {
      const profileStream = context.lookup(cs.get(1));
      if (profileStream instanceof PDFRawStream) {
        const n = readNum(context, profileStream.dict.get(PDFName.of('N')));
        if (n === 1) return 'DeviceGray';
        if (n === 3) return 'DeviceRGB';
        if (n === 4) return 'DeviceCMYK';
      }
    }
  }
  return null;
}

/**
 * Undoes PNG row prediction filters (Predictor >= 10) used inside PDF `/FlateDecode` image streams.
 * @param {Uint8Array} raw
 * @param {number} width
 * @param {number} height
 * @param {number} bppBytes - Bytes per pixel (max(1, floor((channels * bpc + 7) / 8)))
 * @param {number} rowBytes
 * @returns {Uint8Array}
 */
function unfilterPngRows(raw, width, height, bppBytes, rowBytes) {
  const stride = rowBytes + 1;
  if (raw.length < stride * height) return raw;
  const out = new Uint8Array(rowBytes * height);

  for (let y = 0; y < height; y += 1) {
    const inOff = y * stride;
    const outOff = y * rowBytes;
    const filterType = raw[inOff];

    for (let x = 0; x < rowBytes; x += 1) {
      const val = raw[inOff + 1 + x];
      const left = x >= bppBytes ? out[outOff + x - bppBytes] : 0;
      const up = y > 0 ? out[outOff - rowBytes + x] : 0;
      const upLeft = y > 0 && x >= bppBytes ? out[outOff - rowBytes + x - bppBytes] : 0;

      let recon = val;
      if (filterType === 1) recon = (val + left) & 0xff;
      else if (filterType === 2) recon = (val + up) & 0xff;
      else if (filterType === 3) recon = (val + ((left + up) >> 1)) & 0xff;
      else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        recon = (val + pr) & 0xff;
      }
      out[outOff + x] = recon;
    }
  }
  return out;
}

/**
 * Decompresses and decodes raw Flate/uncompressed sample bytes, handling optional PNG Predictor.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRawStream} stream
 * @param {string} filterName
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @param {number} bpc
 * @returns {Uint8Array}
 */
function decodeFlateSampleBytes(context, stream, filterName, width, height, channels, bpc) {
  const inflated =
    filterName === 'FlateDecode' ? unzlibSync(stream.contents) : stream.contents;
  const dp = context.lookup(stream.dict.get(PDFName.of('DecodeParms')));
  const rowBytes = Math.ceil((width * channels * bpc) / 8);

  if (dp instanceof PDFDict) {
    const predictor = readNum(context, dp.get(PDFName.of('Predictor'))) || 1;
    if (predictor >= 10) {
      const bppBytes = Math.max(1, Math.floor((channels * bpc + 7) / 8));
      return unfilterPngRows(inflated, width, height, bppBytes, rowBytes);
    }
  }
  return inflated;
}

/**
 * Decodes Flate RGB/Gray/CMYK pixels + optional `/SMask` stream into an RGBA `Uint8ClampedArray`.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRawStream} stream
 * @param {string} filterName
 * @param {number} width
 * @param {number} height
 * @param {'DeviceRGB'|'DeviceGray'|'DeviceCMYK'} colorSpace
 * @param {number} bpc
 * @returns {Uint8ClampedArray|null}
 */
export function decodeImageStreamToRgba(
  context,
  stream,
  filterName,
  width,
  height,
  colorSpace,
  bpc = 8
) {
  const channels = colorSpace === 'DeviceCMYK' ? 4 : colorSpace === 'DeviceGray' ? 1 : 3;
  if (bpc !== 8 && !(bpc === 1 && colorSpace === 'DeviceGray')) return null;

  const samples = decodeFlateSampleBytes(context, stream, filterName, width, height, channels, bpc);
  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4);

  if (bpc === 1 && colorSpace === 'DeviceGray') {
    const rowBytes = Math.ceil(width / 8);
    if (samples.length < rowBytes * height) return null;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const byte = samples[y * rowBytes + (x >> 3)];
        const bit = (byte >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const idx = (y * width + x) * 4;
        rgba[idx] = v;
        rgba[idx + 1] = v;
        rgba[idx + 2] = v;
        rgba[idx + 3] = 255;
      }
    }
  } else {
    if (samples.length < pixelCount * channels) return null;
    for (let p = 0; p < pixelCount; p += 1) {
      const idx = p * 4;
      if (colorSpace === 'DeviceGray') {
        const g = samples[p];
        rgba[idx] = g;
        rgba[idx + 1] = g;
        rgba[idx + 2] = g;
      } else if (colorSpace === 'DeviceRGB') {
        rgba[idx] = samples[p * 3];
        rgba[idx + 1] = samples[p * 3 + 1];
        rgba[idx + 2] = samples[p * 3 + 2];
      } else {
        // PDF DeviceCMYK: 255 = full ink coverage
        const c = samples[p * 4] / 255;
        const m = samples[p * 4 + 1] / 255;
        const yk = samples[p * 4 + 2] / 255;
        const k = samples[p * 4 + 3] / 255;
        rgba[idx] = Math.round(255 * (1 - c) * (1 - k));
        rgba[idx + 1] = Math.round(255 * (1 - m) * (1 - k));
        rgba[idx + 2] = Math.round(255 * (1 - yk) * (1 - k));
      }
      rgba[idx + 3] = 255;
    }
  }

  // Composite optional /SMask grayscale alpha matte
  const smaskObj = context.lookup(stream.dict.get(PDFName.of('SMask')));
  if (smaskObj instanceof PDFRawStream) {
    const smW = readNum(context, smaskObj.dict.get(PDFName.of('Width')));
    const smH = readNum(context, smaskObj.dict.get(PDFName.of('Height')));
    const smBpc = readNum(context, smaskObj.dict.get(PDFName.of('BitsPerComponent'))) || 8;
    const smFilter = resolveFilter(context, smaskObj.dict.get(PDFName.of('Filter')));
    if (smW === width && smH === height && smBpc === 8 && (smFilter === 'FlateDecode' || smFilter === 'RAW')) {
      try {
        const alphaBytes = decodeFlateSampleBytes(context, smaskObj, smFilter, width, height, 1, 8);
        if (alphaBytes.length >= pixelCount) {
          for (let p = 0; p < pixelCount; p += 1) {
            rgba[p * 4 + 3] = alphaBytes[p];
          }
        }
      } catch {
        // Keep opaque fallback if SMask is corrupted
      }
    }
  }

  return rgba;
}

/**
 * Pure-JS fallback PNG encoder using `fflate.zlibSync` when OffscreenCanvas is unavailable (e.g. Node tests).
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
function encodeRgbaToPngFallback(rgba, width, height) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const stride = width * 4 + 1;
  const rawRows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    rawRows[y * stride] = 0;
    rawRows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }
  const idat = zlibSync(rawRows);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const c1 = makeChunk('IHDR', ihdr);
  const c2 = makeChunk('IDAT', idat);
  const c3 = makeChunk('IEND', new Uint8Array(0));
  const png = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let off = 0;
  for (const part of [sig, c1, c2, c3]) {
    png.set(part, off);
    off += part.length;
  }
  return png;
}

/**
 * Encodes an RGBA pixel buffer to PNG bytes via OffscreenCanvas (with pure-JS zlib PNG fallback).
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8Array>}
 */
async function rgbaToPngBytes(rgba, width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
        ctx.putImageData(imgData, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return new Uint8Array(await blob.arrayBuffer());
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return encodeRgbaToPngFallback(rgba, width, height);
}

/**
 * Extracts raw embedded images from a PDF buffer cleanly inside a Web Worker.
 * Losslessly extracts `/DCTDecode` (.jpg) & `/JPXDecode` (.jp2), and reconstructs `/FlateDecode`
 * images (including CMYK->RGB conversion and `/SMask` alpha compositing) to `.png`.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {{ minWidth?: number, minHeight?: number }} [config={}]
 * @param {string} [fileName='']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 */
export async function extractEmbeddedImagesFromPdf(pdfBytes, config = {}, fileName = '', options = {}) {
  const minWidth = Math.max(1, Number(config.minWidth ?? 32));
  const minHeight = Math.max(1, Number(config.minHeight ?? 32));
  const { onProgress, abortToken } = options;

  onProgress?.(10, 'Scanning PDF indirect image objects...');
  const pdfDoc = await loadPdfSafe(pdfBytes, fileName);
  const context = pdfDoc.context;
  const allObjects = context.enumerateIndirectObjects();

  // Track standalone SMask streams so alpha masks aren't duplicated as standalone outputs
  const smaskRefs = new Set();
  for (const [, obj] of allObjects) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      const smRef = obj.dict.get(PDFName.of('SMask'));
      if (smRef) smaskRefs.add(smRef);
    }
  }

  /** @type {{ id: string, fileName: string, format: 'jpg'|'jp2'|'png', mimeType: string, width: number, height: number, hasAlpha: boolean, bytes: Uint8Array }[]} */
  const extracted = [];
  const seenHashes = new Set();
  let skippedSmall = 0;
  let skippedUnsupported = 0;

  const baseStem = String(fileName || 'document').replace(/\.pdf$/i, '') || 'document';
  const imageEntries = allObjects.filter(
    ([ref, obj]) =>
      !smaskRefs.has(ref) &&
      obj instanceof PDFRawStream &&
      obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
  );

  for (let i = 0; i < imageEntries.length; i += 1) {
    assertNotAborted(abortToken);
    const [, stream] = imageEntries[i];
    const width = readNum(context, stream.dict.get(PDFName.of('Width'))) || 0;
    const height = readNum(context, stream.dict.get(PDFName.of('Height'))) || 0;

    if (width < minWidth || height < minHeight) {
      skippedSmall += 1;
      continue;
    }

    const filterName = resolveFilter(context, stream.dict.get(PDFName.of('Filter')));
    const smaskRef = stream.dict.get(PDFName.of('SMask'));
    const hash = `${hashBytes(stream.contents)}:${smaskRef ? 'sm' : 'no'}`;
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const idxLabel = String(extracted.length + 1).padStart(3, '0');

    if (filterName === 'DCTDecode') {
      extracted.push({
        id: `img_${idxLabel}`,
        fileName: `${baseStem}_img_${idxLabel}.jpg`,
        format: 'jpg',
        mimeType: 'image/jpeg',
        width,
        height,
        hasAlpha: false,
        bytes: new Uint8Array(stream.contents)
      });
    } else if (filterName === 'JPXDecode') {
      extracted.push({
        id: `img_${idxLabel}`,
        fileName: `${baseStem}_img_${idxLabel}.jp2`,
        format: 'jp2',
        mimeType: 'image/jp2',
        width,
        height,
        hasAlpha: false,
        bytes: new Uint8Array(stream.contents)
      });
    } else if (filterName === 'FlateDecode' || filterName === 'RAW') {
      const colorSpace = resolveColorSpace(context, stream.dict.get(PDFName.of('ColorSpace')));
      const bpc = readNum(context, stream.dict.get(PDFName.of('BitsPerComponent'))) || 8;
      if (!colorSpace) {
        skippedUnsupported += 1;
        continue;
      }
      try {
        const rgba = decodeImageStreamToRgba(context, stream, filterName, width, height, colorSpace, bpc);
        if (!rgba) {
          skippedUnsupported += 1;
          continue;
        }
        const pngBytes = await rgbaToPngBytes(rgba, width, height);
        extracted.push({
          id: `img_${idxLabel}`,
          fileName: `${baseStem}_img_${idxLabel}.png`,
          format: 'png',
          mimeType: 'image/png',
          width,
          height,
          hasAlpha: Boolean(smaskRef),
          bytes: pngBytes
        });
      } catch {
        skippedUnsupported += 1;
      }
    } else {
      skippedUnsupported += 1;
    }

    if ((i + 1) % 4 === 0 || i === imageEntries.length - 1) {
      onProgress?.(
        15 + Math.round(((i + 1) / Math.max(1, imageEntries.length)) * 80),
        `Extracting embedded image ${i + 1} of ${imageEntries.length}...`,
        i + 1,
        imageEntries.length
      );
      await yieldToLoop();
    }
  }

  onProgress?.(100, 'Image extraction complete.', imageEntries.length, imageEntries.length);
  return {
    images: extracted,
    skippedSmall,
    skippedUnsupported
  };
}

/**
 * Packages extracted image items into a single `.zip` via `fflate`.
 * @param {{ fileName: string, bytes: Uint8Array }[]} images
 * @param {string} [sourceName='document']
 */
export function packageExtractedImagesZip(images, sourceName = 'document') {
  const stem = String(sourceName || 'document').replace(/\.pdf$/i, '') || 'document';
  const zipBytes = createZipArchive(
    images.map((img) => ({ name: img.fileName, data: img.bytes })),
    1
  );
  return {
    buffer: zipBytes,
    fileName: `${stem}_embedded_images.zip`,
    mimeType: 'application/zip'
  };
}
