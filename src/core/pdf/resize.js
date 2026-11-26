import { PDFDocument, degrees } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import {
  computeDrawPageTransform,
  computePlacementRect,
  getEffectivePageGeometry,
  resolveTargetPageSize
} from './geometry.js';

/**
 * @typedef {Object} ResizePdfConfig
 * @property {string} [preset='a4'] - 'a4'|'a3'|'a5'|'letter'|'legal'|'f4_id'|'f4_us'|'custom'
 * @property {number} [customWidth=210] - Custom width in customUnit
 * @property {number} [customHeight=297] - Custom height in customUnit
 * @property {'pt'|'mm'|'cm'|'in'} [customUnit='mm'] - Unit for custom dimensions
 * @property {'auto'|'portrait'|'landscape'} [orientation='auto'] - Target orientation policy
 * @property {'fit'|'fill'|'original'} [fitMode='fit'] - Page scaling/centering mode
 * @property {number} [marginPt=0] - Optional inner padding in points (applied in Fit mode)
 * @property {(percent: number, stage: string, current?: number, total?: number) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Resizes and standardizes all pages of an existing PDFDocument using `embedPage()`
 * while respecting each page's `CropBox` offsets and `/Rotate` angle.
 * @param {PDFDocument} srcDoc
 * @param {ResizePdfConfig} [config={}]
 * @returns {Promise<{ doc: PDFDocument, pageCount: number, targetDimensions: { width: number, height: number }[] }>}
 */
export async function resizePdfDocument(srcDoc, config = {}) {
  const {
    preset = 'a4',
    customWidth = 210,
    customHeight = 297,
    customUnit = 'mm',
    orientation = 'auto',
    fitMode = 'fit',
    marginPt = 0,
    onProgress,
    abortToken
  } = config;

  const srcPages = srcDoc.getPages();
  const total = srcPages.length;
  if (total === 0) {
    throw new Error('Cannot resize an empty PDF document.');
  }

  const destDoc = await PDFDocument.create();
  /** @type {{ width: number, height: number }[]} */
  const targetDimensions = [];

  for (let i = 0; i < total; i += 1) {
    assertNotAborted(abortToken);
    const srcPage = srcPages[i];
    const { box, angle, visualWidth, visualHeight } = getEffectivePageGeometry(srcPage);
    const targetSize = resolveTargetPageSize(
      { preset, customWidth, customHeight, customUnit, orientation },
      visualWidth,
      visualHeight
    );

    const destPage = destDoc.addPage([targetSize.width, targetSize.height]);
    const embedded = await destDoc.embedPage(srcPage, {
      left: box.x,
      bottom: box.y,
      right: box.x + box.width,
      top: box.y + box.height
    });

    const placement = computePlacementRect({
      srcWidth: visualWidth,
      srcHeight: visualHeight,
      boxWidth: targetSize.width,
      boxHeight: targetSize.height,
      fitMode,
      marginPt
    });

    const drawSpec = computeDrawPageTransform(
      embedded.width,
      embedded.height,
      placement.vx,
      placement.vy,
      placement.scale,
      angle
    );

    destPage.drawPage(embedded, {
      x: drawSpec.x,
      y: drawSpec.y,
      width: drawSpec.width,
      height: drawSpec.height,
      rotate: degrees(drawSpec.rotateDegrees)
    });

    targetDimensions.push({
      width: Math.round(targetSize.width * 100) / 100,
      height: Math.round(targetSize.height * 100) / 100
    });

    if ((i + 1) % 6 === 0 || i === total - 1) {
      onProgress?.(
        20 + Math.round(((i + 1) / total) * 72),
        `Standardizing page ${i + 1} of ${total}...`,
        i + 1,
        total
      );
      await yieldToLoop();
    }
  }

  return {
    doc: destDoc,
    pageCount: total,
    targetDimensions
  };
}

/**
 * Convenience helper to resize raw PDF bytes directly in a worker or test.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {ResizePdfConfig} [config={}]
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function resizePdfBuffer(pdfBytes, config = {}, fileName = '') {
  const srcDoc = await loadPdfSafe(pdfBytes, fileName);
  const { doc } = await resizePdfDocument(srcDoc, config);
  config.onProgress?.(95, 'Serializing resized PDF...');
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
