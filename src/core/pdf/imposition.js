import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import {
  computeDrawPageTransform,
  computePlacementRect,
  getEffectivePageGeometry,
  normalizeRightAngle
} from './geometry.js';
import { computeImpositionPlan } from './imposition-plan.js';

/**
 * @typedef {Object} ImpositionConfig
 * @property {'nup'|'booklet'} [mode='nup']
 * @property {2|4|6|9} [nUp=2]
 * @property {'ltr'|'rtl'|'ttb'} [nUpOrder='ltr']
 * @property {string} [sheetPreset='a4']
 * @property {'portrait'|'landscape'} [sheetOrientation]
 * @property {number} [outerMarginPt=18]
 * @property {number} [gutterPt=10]
 * @property {boolean} [drawBorders=false]
 * @property {'left'|'right'} [bindingEdge='left']
 * @property {boolean} [flipBackSide=false]
 * @property {(percent: number, stage: string, current?: number, total?: number) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Imposes a PDFDocument into N-Up sheets or Saddle-Stitch Booklet spreads via vector `embedPage()`.
 * @param {PDFDocument} srcDoc
 * @param {ImpositionConfig} [config={}]
 * @returns {Promise<{ doc: PDFDocument, sheetCount: number, paddedPageCount: number, sheets: import('./imposition-plan.js').ImposedSheet[] }>}
 */
export async function imposePdfDocument(srcDoc, config = {}) {
  const {
    outerMarginPt = 18,
    gutterPt = 10,
    drawBorders = false,
    onProgress,
    abortToken
  } = config;

  const srcPages = srcDoc.getPages();
  const totalSrc = srcPages.length;
  if (totalSrc === 0) {
    throw new Error('Cannot impose an empty PDF document.');
  }

  const plan = computeImpositionPlan(totalSrc, config);
  const { sheets, cols, rows, sheetWidth, sheetHeight, paddedPageCount } = plan;

  const safeMargin = Math.max(0, Math.min(Number(outerMarginPt) || 0, Math.min(sheetWidth, sheetHeight) * 0.25));
  const safeGutter = Math.max(0, Math.min(Number(gutterPt) || 0, Math.min(sheetWidth, sheetHeight) * 0.15));

  const cellW = Math.max(10, (sheetWidth - safeMargin * 2 - safeGutter * Math.max(0, cols - 1)) / cols);
  const cellH = Math.max(10, (sheetHeight - safeMargin * 2 - safeGutter * Math.max(0, rows - 1)) / rows);

  const destDoc = await PDFDocument.create();
  /** @type {Map<number, { embedded: import('pdf-lib').PDFEmbeddedPage, angle: 0|90|180|270, visualWidth: number, visualHeight: number }>} */
  const embeddedCache = new Map();

  for (let s = 0; s < sheets.length; s += 1) {
    assertNotAborted(abortToken);
    const sheetSpec = sheets[s];
    const sheetPage = destDoc.addPage([sheetWidth, sheetHeight]);

    for (const slot of sheetSpec.slots) {
      const cellX = safeMargin + slot.col * (cellW + safeGutter);
      const cellY = sheetHeight - safeMargin - slot.row * (cellH + safeGutter) - cellH;

      if (drawBorders) {
        sheetPage.drawRectangle({
          x: cellX,
          y: cellY,
          width: cellW,
          height: cellH,
          borderColor: rgb(0.75, 0.75, 0.75),
          borderWidth: 0.75
        });
      }

      if (slot.pageNumber === null) continue;
      const srcIdx = slot.pageNumber - 1;
      let cached = embeddedCache.get(srcIdx);
      if (!cached) {
        const srcPage = srcPages[srcIdx];
        const geom = getEffectivePageGeometry(srcPage);
        const embedded = await destDoc.embedPage(srcPage, {
          left: geom.box.x,
          bottom: geom.box.y,
          right: geom.box.x + geom.box.width,
          top: geom.box.y + geom.box.height
        });
        cached = {
          embedded,
          angle: geom.angle,
          visualWidth: geom.visualWidth,
          visualHeight: geom.visualHeight
        };
        embeddedCache.set(srcIdx, cached);
      }

      const totalRot = normalizeRightAngle(cached.angle + (slot.extraRotation || 0));
      const rotSwap = totalRot === 90 || totalRot === 270;
      const unrotVisW = cached.embedded.width;
      const unrotVisH = cached.embedded.height;
      const visW = rotSwap ? unrotVisH : unrotVisW;
      const visH = rotSwap ? unrotVisW : unrotVisH;

      const placement = computePlacementRect({
        srcWidth: visW,
        srcHeight: visH,
        boxX: cellX,
        boxY: cellY,
        boxWidth: cellW,
        boxHeight: cellH,
        fitMode: 'fit',
        marginPt: 0
      });

      const drawSpec = computeDrawPageTransform(
        unrotVisW,
        unrotVisH,
        placement.vx,
        placement.vy,
        placement.scale,
        totalRot
      );

      sheetPage.drawPage(cached.embedded, {
        x: drawSpec.x,
        y: drawSpec.y,
        width: drawSpec.width,
        height: drawSpec.height,
        rotate: degrees(drawSpec.rotateDegrees)
      });
    }

    if ((s + 1) % 4 === 0 || s === sheets.length - 1) {
      onProgress?.(
        25 + Math.round(((s + 1) / Math.max(1, sheets.length)) * 68),
        `Imposing sheet ${s + 1} of ${sheets.length}...`,
        s + 1,
        sheets.length
      );
      await yieldToLoop();
    }
  }

  return {
    doc: destDoc,
    sheetCount: sheets.length,
    paddedPageCount,
    sheets
  };
}

/**
 * Convenience buffer wrapper for N-Up / Booklet imposition.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {ImpositionConfig} [config={}]
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function imposePdfBuffer(pdfBytes, config = {}, fileName = '') {
  const srcDoc = await loadPdfSafe(pdfBytes, fileName);
  const { doc } = await imposePdfDocument(srcDoc, config);
  config.onProgress?.(95, 'Serializing imposed PDF...');
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
