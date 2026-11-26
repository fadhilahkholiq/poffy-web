import { PDFDocument, degrees } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { embedFontForText, parseHexColor } from './font-helper.js';
import { getEffectivePageGeometry, normalizeRightAngle } from './geometry.js';
import { computeOverlayPdfPlacement } from './overlay-coords.js';

/**
 * @typedef {'signature'|'text'|'highlight'|'rect'|'ellipse'|'line'|'arrow'|'check'} AnnotationKind
 */

/**
 * @typedef {Object} OverlayAnnotation
 * @property {string} id
 * @property {number} pageIndex - 0-based page index
 * @property {AnnotationKind} kind
 * @property {number} nx - Normalized visual top-left X [0..1]
 * @property {number} ny - Normalized visual top-left Y [0..1]
 * @property {number} nw - Normalized visual width [0..1]
 * @property {number} nh - Normalized visual height [0..1]
 * @property {number} [rotation=0] - Clockwise visual rotation in degrees
 * @property {string} [color='#0a0a0a'] - Hex stroke/text/fill color
 * @property {number} [opacity=1] - Opacity (0..1)
 * @property {number} [strokeWidth=2] - Stroke thickness in points
 * @property {string} [text=''] - Text callout string when kind === 'text'
 * @property {number} [fontSize=14] - Font size in points when kind === 'text'
 * @property {string} [fontFamily='Helvetica'] - Font family when kind === 'text'
 * @property {ArrayBuffer|Uint8Array} [imageBytes] - PNG/JPG signature bytes when kind === 'signature'
 * @property {'png'|'jpg'} [imageFormat='png']
 */

/**
 * Transforms a point `(lx, ly)` in visual overlay local space (origin at overlay center, +lx right, +ly up)
 * into unrotated PDF user space `(pdfX, pdfY)` rotated by `ccwDegrees`.
 * @param {number} lx
 * @param {number} ly
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} ccwDegrees
 * @returns {{ x: number, y: number }}
 */
function localCenterOffsetToPdf(lx, ly, centerX, centerY, ccwDegrees) {
  const rad = (ccwDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: centerX + lx * cos - ly * sin,
    y: centerY + lx * sin + ly * cos
  };
}

/**
 * Burns e-Signatures and native vector annotations onto a PDFDocument in place
 * using the shared Coordinate & Overlay Mapping Engine (`CropBox` + `/Rotate` accurate).
 * @param {PDFDocument} pdfDoc
 * @param {OverlayAnnotation[]} overlays
 * @param {{ fallbackFontBytes?: Uint8Array|ArrayBuffer|null, onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<PDFDocument>}
 */
export async function applyAnnotationsToDocument(pdfDoc, overlays = [], options = {}) {
  const { fallbackFontBytes = null, onProgress, abortToken } = options;
  const pages = pdfDoc.getPages();
  const totalOverlays = overlays.length;
  if (totalOverlays === 0) return pdfDoc;

  /** @type {Map<string, import('pdf-lib').PDFImage>} */
  const embeddedImgCache = new Map();

  for (let i = 0; i < totalOverlays; i += 1) {
    assertNotAborted(abortToken);
    const item = overlays[i];
    const pageIdx = Math.floor(Number(item.pageIndex));
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const { box, angle } = getEffectivePageGeometry(page);
    const place = computeOverlayPdfPlacement(
      { nx: item.nx, ny: item.ny, nw: item.nw, nh: item.nh },
      box,
      angle,
      item.rotation || 0
    );

    const color = parseHexColor(item.color || (item.kind === 'highlight' ? '#facc15' : '#0a0a0a'));
    const opacity = Math.max(
      0.05,
      Math.min(1, Number(item.opacity ?? (item.kind === 'highlight' ? 0.35 : 1)))
    );
    const strokeWidth = Math.max(0.5, Math.min(20, Number(item.strokeWidth ?? 2)));

    if (item.kind === 'signature' && item.imageBytes) {
      const raw =
        item.imageBytes instanceof Uint8Array ? item.imageBytes : new Uint8Array(item.imageBytes);
      const cacheKey = `${item.imageFormat || 'png'}:${raw.byteLength}:${raw[0] || 0}:${raw[raw.byteLength - 1] || 0}`;
      let embedded = embeddedImgCache.get(cacheKey);
      if (!embedded) {
        embedded =
          item.imageFormat === 'jpg'
            ? await pdfDoc.embedJpg(raw)
            : await pdfDoc.embedPng(raw);
        embeddedImgCache.set(cacheKey, embedded);
      }
      page.drawImage(embedded, {
        x: place.x,
        y: place.y,
        width: place.width,
        height: place.height,
        rotate: degrees(place.rotateDegrees),
        opacity
      });
    } else if (item.kind === 'highlight') {
      page.drawRectangle({
        x: place.x,
        y: place.y,
        width: place.width,
        height: place.height,
        rotate: degrees(place.rotateDegrees),
        color,
        opacity
      });
    } else if (item.kind === 'rect') {
      page.drawRectangle({
        x: place.x,
        y: place.y,
        width: place.width,
        height: place.height,
        rotate: degrees(place.rotateDegrees),
        borderColor: color,
        borderWidth: strokeWidth,
        borderOpacity: opacity
      });
    } else if (item.kind === 'ellipse') {
      const totalRot = normalizeRightAngle(angle + (item.rotation || 0));
      const swap = totalRot === 90 || totalRot === 270;
      page.drawEllipse({
        x: place.centerX,
        y: place.centerY,
        xScale: Math.max(1, (swap ? place.height : place.width) / 2),
        yScale: Math.max(1, (swap ? place.width : place.height) / 2),
        borderColor: color,
        borderWidth: strokeWidth,
        borderOpacity: opacity
      });
    } else if (item.kind === 'line' || item.kind === 'arrow') {
      const halfW = place.width / 2;
      const startPt = localCenterOffsetToPdf(
        -halfW,
        0,
        place.centerX,
        place.centerY,
        place.rotateDegrees
      );
      const endPt = localCenterOffsetToPdf(
        halfW,
        0,
        place.centerX,
        place.centerY,
        place.rotateDegrees
      );
      page.drawLine({
        start: startPt,
        end: endPt,
        thickness: strokeWidth,
        color,
        opacity
      });

      if (item.kind === 'arrow') {
        const headSize = Math.max(6, Math.min(place.width * 0.35, strokeWidth * 4 + 4));
        const wingA = localCenterOffsetToPdf(
          halfW - headSize,
          headSize * 0.55,
          place.centerX,
          place.centerY,
          place.rotateDegrees
        );
        const wingB = localCenterOffsetToPdf(
          halfW - headSize,
          -headSize * 0.55,
          place.centerX,
          place.centerY,
          place.rotateDegrees
        );
        page.drawLine({
          start: endPt,
          end: wingA,
          thickness: strokeWidth,
          color,
          opacity
        });
        page.drawLine({
          start: endPt,
          end: wingB,
          thickness: strokeWidth,
          color,
          opacity
        });
      }
    } else if (item.kind === 'check') {
      const w = place.width;
      const h = place.height;
      const p1 = localCenterOffsetToPdf(
        -w * 0.34,
        -h * 0.02,
        place.centerX,
        place.centerY,
        place.rotateDegrees
      );
      const p2 = localCenterOffsetToPdf(
        -w * 0.06,
        -h * 0.32,
        place.centerX,
        place.centerY,
        place.rotateDegrees
      );
      const p3 = localCenterOffsetToPdf(
        w * 0.36,
        h * 0.32,
        place.centerX,
        place.centerY,
        place.rotateDegrees
      );
      page.drawLine({ start: p1, end: p2, thickness: strokeWidth, color, opacity });
      page.drawLine({ start: p2, end: p3, thickness: strokeWidth, color, opacity });
    } else if (item.kind === 'text') {
      const content = String(item.text || '').trim();
      if (!content) continue;
      const fontSize = Math.max(6, Math.min(96, Number(item.fontSize) || 14));
      const { font } = await embedFontForText(
        pdfDoc,
        content,
        item.fontFamily || 'Helvetica',
        fallbackFontBytes
      );
      const lines = content.split(/\r?\n/);
      const lineHeight = fontSize * 1.2;
      const totalTextH = lines.length * lineHeight;

      for (let li = 0; li < lines.length; li += 1) {
        const lineStr = lines[li];
        if (!lineStr) continue;
        // Anchor lines inside visual box from top downward around box center
        const lyFromCenter = totalTextH / 2 - (li + 0.8) * lineHeight;
        const lxFromCenter = -place.width / 2 + 2;
        const origin = localCenterOffsetToPdf(
          lxFromCenter,
          lyFromCenter,
          place.centerX,
          place.centerY,
          place.rotateDegrees
        );
        page.drawText(lineStr, {
          x: origin.x,
          y: origin.y,
          size: fontSize,
          font,
          color,
          opacity,
          rotate: degrees(place.rotateDegrees)
        });
      }
    }

    if ((i + 1) % 8 === 0 || i === totalOverlays - 1) {
      onProgress?.(
        25 + Math.round(((i + 1) / totalOverlays) * 68),
        `Applying annotation ${i + 1} of ${totalOverlays}...`,
        i + 1,
        totalOverlays
      );
      await yieldToLoop();
    }
  }

  return pdfDoc;
}

/**
 * Loads raw PDF bytes, applies signatures/vector annotations, and serializes cleanly.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {OverlayAnnotation[]} overlays
 * @param {{ fallbackFontBytes?: Uint8Array|ArrayBuffer|null, onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function annotatePdfBuffer(pdfBytes, overlays = [], options = {}, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  await applyAnnotationsToDocument(doc, overlays, options);
  options.onProgress?.(95, 'Serializing signed PDF...');
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
