import { PDFDocument } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { getEffectivePageGeometry, mapVisualInsetsToUnrotatedPdf } from './geometry.js';

/**
 * @typedef {Object} SplitSpreadsConfig
 * @property {'vertical'|'horizontal'} [axis='vertical'] - Split divider orientation
 * @property {number} [splitRatio=0.5] - Split line fraction (0.15 - 0.85) from Left (vertical) or Top (horizontal)
 * @property {'ltr'|'rtl'} [readingOrder='ltr'] - Reading order for split halves (RTL swaps left/right order)
 * @property {boolean} [skipFirstPage=false] - Keep first page whole (single cover page)
 * @property {boolean} [skipLastPage=false] - Keep last page whole (single back cover page)
 * @property {boolean} [landscapeOnly=false] - Only split pages where visualWidth > visualHeight
 * @property {(percent: number, stage: string, current?: number, total?: number) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Applies a visual inset crop rectangle cleanly onto both CropBox and MediaBox of a PDFPage.
 * @param {import('pdf-lib').PDFPage} page
 * @param {{ x: number, y: number, width: number, height: number }} baseBox
 * @param {number} angle
 * @param {{ top: number, right: number, bottom: number, left: number }} visualInsets
 */
function applyVisualBoxSlice(page, baseBox, angle, visualInsets) {
  const unrot = mapVisualInsetsToUnrotatedPdf(visualInsets, angle);
  const nx = baseBox.x + unrot.left;
  const ny = baseBox.y + unrot.bottom;
  const nw = Math.max(8, baseBox.width - unrot.left - unrot.right);
  const nh = Math.max(8, baseBox.height - unrot.top - unrot.bottom);

  page.setCropBox(nx, ny, nw, nh);
  page.setMediaBox(nx, ny, nw, nh);
}

/**
 * Splits 2-page spreads in a PDFDocument cleanly into single pages via `copyPages()`
 * and dual `CropBox` + `MediaBox` updates, handling page `/Rotate` and existing `CropBox` offsets.
 * @param {PDFDocument} srcDoc
 * @param {SplitSpreadsConfig} [config={}]
 * @returns {Promise<{ doc: PDFDocument, inputPages: number, outputPages: number, splitCount: number }>}
 */
export async function splitSpreadsDocument(srcDoc, config = {}) {
  const {
    axis = 'vertical',
    splitRatio = 0.5,
    readingOrder = 'ltr',
    skipFirstPage = false,
    skipLastPage = false,
    landscapeOnly = false,
    onProgress,
    abortToken
  } = config;

  const total = srcDoc.getPageCount();
  if (total === 0) {
    throw new Error('Cannot split spreads on an empty PDF document.');
  }

  const ratio = Math.max(0.15, Math.min(0.85, Number(splitRatio) || 0.5));
  const destDoc = await PDFDocument.create();
  let splitCount = 0;

  for (let i = 0; i < total; i += 1) {
    assertNotAborted(abortToken);
    const srcPage = srcDoc.getPage(i);
    const { box, angle, visualWidth, visualHeight } = getEffectivePageGeometry(srcPage);

    const isFirstSkipped = skipFirstPage && i === 0;
    const isLastSkipped = skipLastPage && i === total - 1 && total > 1;
    const isPortraitSkipped = landscapeOnly && visualWidth <= visualHeight;

    if (isFirstSkipped || isLastSkipped || isPortraitSkipped) {
      const [singleCopy] = await destDoc.copyPages(srcDoc, [i]);
      destDoc.addPage(singleCopy);
    } else {
      const [copyA, copyB] = await destDoc.copyPages(srcDoc, [i, i]);
      splitCount += 1;

      if (axis === 'horizontal') {
        const topInsets = {
          top: 0,
          right: 0,
          bottom: visualHeight * (1 - ratio),
          left: 0
        };
        const bottomInsets = {
          top: visualHeight * ratio,
          right: 0,
          bottom: 0,
          left: 0
        };
        const ordered = readingOrder === 'rtl' ? [bottomInsets, topInsets] : [topInsets, bottomInsets];
        applyVisualBoxSlice(copyA, box, angle, ordered[0]);
        applyVisualBoxSlice(copyB, box, angle, ordered[1]);
      } else {
        const leftInsets = {
          top: 0,
          right: visualWidth * (1 - ratio),
          bottom: 0,
          left: 0
        };
        const rightInsets = {
          top: 0,
          right: 0,
          bottom: 0,
          left: visualWidth * ratio
        };
        const ordered = readingOrder === 'rtl' ? [rightInsets, leftInsets] : [leftInsets, rightInsets];
        applyVisualBoxSlice(copyA, box, angle, ordered[0]);
        applyVisualBoxSlice(copyB, box, angle, ordered[1]);
      }

      destDoc.addPage(copyA);
      destDoc.addPage(copyB);
    }

    if ((i + 1) % 6 === 0 || i === total - 1) {
      onProgress?.(
        20 + Math.round(((i + 1) / total) * 72),
        `Splitting page ${i + 1} of ${total}...`,
        i + 1,
        total
      );
      await yieldToLoop();
    }
  }

  return {
    doc: destDoc,
    inputPages: total,
    outputPages: destDoc.getPageCount(),
    splitCount
  };
}

/**
 * Convenience buffer wrapper for Split Book Spreads.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {SplitSpreadsConfig} [config={}]
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function splitSpreadsBuffer(pdfBytes, config = {}, fileName = '') {
  const srcDoc = await loadPdfSafe(pdfBytes, fileName);
  const { doc } = await splitSpreadsDocument(srcDoc, config);
  config.onProgress?.(95, 'Serializing split pages...');
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
