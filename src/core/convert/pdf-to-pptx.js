import { assertNotAborted, yieldToLoop } from '../pdf/doc-loader.js';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { parsePageRange } from '../utils/page-range.js';
import { extractPdfLayout } from './layout-extractor.js';

/**
 * Encodes an ArrayBuffer cleanly to a base64 string without DOM FileReader dependencies.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Normalizes PDF page point dimensions into clean PowerPoint slide inches while preserving aspect ratio.
 * @param {number} widthPt
 * @param {number} heightPt
 * @returns {{ widthIn: number, heightIn: number }}
 */
function toSlideInches(widthPt, heightPt) {
  const safeW = Math.max(72, widthPt || 960);
  const safeH = Math.max(72, heightPt || 540);
  const targetWidthIn = 10;
  const aspect = safeH / safeW;
  const heightIn = Math.max(3.5, Math.min(18, Number((targetWidthIn * aspect).toFixed(3))));
  return { widthIn: targetWidthIn, heightIn };
}

/**
 * Converts a PDF buffer into a PowerPoint `.pptx` deck inside a Web Worker using lazy `import('pptxgenjs')`.
 * Supports both `'visual'` (full-bleed OffscreenCanvas raster slides) and `'editable'` (text & tables).
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [config={}]
 * @param {'visual'|'editable'} [config.mode='visual']
 * @param {'jpeg'|'png'} [config.imageFormat='jpeg']
 * @param {number} [config.scale=2]
 * @param {string} [config.rangeExpression='all']
 * @param {string} [fileName='document.pdf']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: string, warnings: string[], slideCount: number, isLikelyScanned: boolean, mode: string }>}
 */
export async function convertPdfToPptx(pdfBytes, config = {}, fileName = 'document.pdf', options = {}) {
  const {
    mode = 'visual',
    imageFormat = 'jpeg',
    scale = 2,
    rangeExpression = 'all'
  } = config;
  const { onProgress, abortToken } = options;

  onProgress?.(5, 'Loading PowerPoint builder...');
  const pptxMod = await import('pptxgenjs');
  const PptxGenJS = pptxMod.default || pptxMod;
  assertNotAborted(abortToken);

  const pptx = new PptxGenJS();
  pptx.author = 'Poffy Offline PDF Studio';
  pptx.title = (fileName || 'Presentation').replace(/\.pdf$/i, '') || 'Presentation';

  /** @type {string[]} */
  const warnings = [];
  let isLikelyScanned = false;
  let slideCount = 0;

  if (mode === 'visual') {
    const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);
    try {
      const indices = parsePageRange(rangeExpression || 'all', pdfjsDoc.numPages);
      let layoutDefined = false;
      let slideW = 10;
      let slideH = 5.625;

      for (let i = 0; i < indices.length; i += 1) {
        assertNotAborted(abortToken);
        const pageIndex = indices[i];
        const rendered = await renderPdfJsPageToCanvas(pdfjsDoc, pageIndex, scale);
        try {
          if (!layoutDefined) {
            const page = rendered.page;
            const vp = page.getViewport({ scale: 1 });
            const dims = toSlideInches(vp.width, vp.height);
            slideW = dims.widthIn;
            slideH = dims.heightIn;
            pptx.defineLayout({ name: 'POFFY_PDF', width: slideW, height: slideH });
            pptx.layout = 'POFFY_PDF';
            layoutDefined = true;
          }

          const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
          const blob = await rendered.canvas.convertToBlob({
            type: mime,
            quality: imageFormat === 'png' ? undefined : 0.88
          });
          const imgBuf = await blob.arrayBuffer();
          const b64 = arrayBufferToBase64(imgBuf);

          const slide = pptx.addSlide();
          slide.addImage({
            data: `${mime};base64,${b64}`,
            x: 0,
            y: 0,
            w: slideW,
            h: slideH
          });
          slideCount += 1;
        } finally {
          rendered.cleanup();
        }

        onProgress?.(
          Math.round(10 + ((i + 1) / Math.max(1, indices.length)) * 78),
          `Rendering slide ${i + 1} of ${indices.length}...`,
          i + 1,
          indices.length
        );
        await yieldToLoop();
      }
    } finally {
      await destroyPdfJsDoc(pdfjsDoc);
    }
  } else {
    const layout = await extractPdfLayout(
      pdfBytes,
      { rangeExpression, detectTables: true },
      fileName,
      { onProgress, abortToken }
    );
    assertNotAborted(abortToken);
    isLikelyScanned = layout.isLikelyScanned;
    if (isLikelyScanned) {
      warnings.push(
        'Scanned/image-only PDF detected. Switch to High-Fidelity Visual Slides for best results.'
      );
    }

    const first = layout.pages[0];
    const dims = toSlideInches(first?.widthPt || 960, first?.heightPt || 540);
    pptx.defineLayout({ name: 'POFFY_PDF', width: dims.widthIn, height: dims.heightIn });
    pptx.layout = 'POFFY_PDF';

    onProgress?.(78, 'Placing editable slide text & tables...');
    for (const page of layout.pages) {
      assertNotAborted(abortToken);
      const slide = pptx.addSlide();
      const scaleX = dims.widthIn / Math.max(72, page.widthPt);
      const scaleY = dims.heightIn / Math.max(72, page.heightPt);
      let cursorY = 0.45;

      for (const block of page.blocks) {
        if (cursorY > dims.heightIn - 0.5) break;
        if (block.type === 'heading') {
          const x = Math.max(0.4, Math.min(dims.widthIn - 2.5, block.x * scaleX));
          const y = Math.max(0.35, Math.min(dims.heightIn - 0.7, block.y * scaleY * 0.9 || cursorY));
          const fontSize = Math.max(14, Math.min(34, Math.round(block.fontSize * scaleY * 68)));
          const boxH = Math.max(0.45, Math.min(1.5, Math.ceil(block.text.length / 45) * 0.42));
          slide.addText(block.text, {
            x,
            y: Math.max(cursorY, y),
            w: Math.max(3, dims.widthIn - x - 0.4),
            h: boxH,
            fontSize,
            bold: true,
            color: '1D1D1F',
            valign: 'top'
          });
          cursorY = Math.max(cursorY, y) + boxH + 0.08;
        } else if (block.type === 'paragraph') {
          const x = Math.max(0.4, Math.min(dims.widthIn - 2.5, block.x * scaleX));
          const y = Math.max(cursorY, Math.min(dims.heightIn - 0.6, block.y * scaleY));
          const fontSize = Math.max(10, Math.min(20, Math.round(block.fontSize * scaleY * 68)));
          const approxLines = Math.max(1, Math.ceil(block.text.length / 75));
          const boxH = Math.min(dims.heightIn - y - 0.25, approxLines * 0.28 + 0.14);
          const runs = (block.runs.length > 0 ? block.runs : [{ text: block.text, isBold: false, isItalic: false }]).map(
            (r) => ({
              text: r.text,
              options: { bold: Boolean(r.isBold), italic: Boolean(r.isItalic) }
            })
          );
          slide.addText(runs, {
            x,
            y,
            w: Math.max(3, dims.widthIn - x - 0.4),
            h: Math.max(0.32, boxH),
            fontSize,
            color: '3A3A3C',
            valign: 'top'
          });
          cursorY = y + boxH + 0.1;
        } else if (block.type === 'list') {
          const firstItem = block.items[0];
          const x = Math.max(0.4, Math.min(dims.widthIn - 2.5, (firstItem?.x || 40) * scaleX));
          const y = Math.max(cursorY, Math.min(dims.heightIn - 0.8, (firstItem?.y || 80) * scaleY));
          const boxH = Math.min(dims.heightIn - y - 0.25, block.items.length * 0.3 + 0.15);
          slide.addText(
            block.items.map((it) => ({
              text: it.text,
              options: {
                bullet: block.ordered ? { type: 'number' } : true
              }
            })),
            {
              x,
              y,
              w: Math.max(3, dims.widthIn - x - 0.4),
              h: Math.max(0.4, boxH),
              fontSize: 12,
              color: '3A3A3C',
              valign: 'top'
            }
          );
          cursorY = y + boxH + 0.1;
        } else if (block.type === 'table') {
          const y = Math.max(cursorY, Math.min(dims.heightIn - 1, block.y * scaleY));
          const rows = block.rows.map((r, rIdx) =>
            r.map((cell) => ({
              text: cell || '',
              options: {
                bold: rIdx === 0,
                fill: rIdx === 0 ? { color: 'F2F2F7' } : undefined
              }
            }))
          );
          slide.addTable(rows, {
            x: 0.45,
            y,
            w: dims.widthIn - 0.9,
            fontSize: 10,
            color: '1D1D1F',
            border: { pt: 0.5, color: 'D1D1D6' }
          });
          cursorY = y + Math.min(3.5, block.rows.length * 0.34) + 0.15;
        }
      }
      slideCount += 1;
    }
  }

  onProgress?.(92, 'Packaging PPTX presentation...');
  const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' });
  const stem = (fileName || 'document').replace(/\.pdf$/i, '') || 'document';
  onProgress?.(100, 'PowerPoint conversion complete.', slideCount, slideCount);

  return {
    buffer: arrayBuffer,
    fileName: `${stem}.pptx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    warnings,
    slideCount,
    isLikelyScanned,
    mode
  };
}
