/**
 * Shared Coordinate & Overlay Mapping Engine for Poffy.
 * Converts deterministically between:
 *  - DOM / Canvas top-left pixel space `(px, py, pw, ph)` in a scaled viewport `(viewW, viewH)`
 *  - Normalized visual coordinates `(nx, ny, nw, nh)` in `[0..1]` (top-left origin)
 *  - PDF bottom-left user-space coordinates `(x, y, width, height)` accounting for
 *    page `CropBox` offsets `(cx, cy)` and cumulative `/Rotate` (`0`, `90`, `180`, `270`).
 */

import { mapVisualInsetsToUnrotatedPdf, normalizeRightAngle } from './geometry.js';

/**
 * @typedef {Object} NormalizedRect
 * @property {number} nx - Normalized X from visual left [0..1]
 * @property {number} ny - Normalized Y from visual top [0..1]
 * @property {number} nw - Normalized width [0..1]
 * @property {number} nh - Normalized height [0..1]
 */

/**
 * @typedef {Object} PdfRect
 * @property {number} x - PDF bottom-left X in points
 * @property {number} y - PDF bottom-left Y in points
 * @property {number} width - Width in unrotated PDF points
 * @property {number} height - Height in unrotated PDF points
 */

/**
 * Computes visual width/height in PDF points from an unrotated CropBox and clockwise rotation angle.
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} rotationDegrees
 * @returns {{ visW: number, visH: number, rot: 0|90|180|270 }}
 */
export function getVisualBoxSize(cropBox, rotationDegrees = 0) {
  const rot = normalizeRightAngle(rotationDegrees);
  const swap = rot === 90 || rot === 270;
  return {
    visW: Math.max(1, swap ? cropBox.height : cropBox.width),
    visH: Math.max(1, swap ? cropBox.width : cropBox.height),
    rot
  };
}

/**
 * Converts a DOM/Canvas top-left pixel rectangle to normalized visual `[0..1]` coordinates.
 * @param {{ x: number, y: number, width: number, height: number }} pxRect
 * @param {number} viewWidth
 * @param {number} viewHeight
 * @returns {NormalizedRect}
 */
export function domRectToNormalized(pxRect, viewWidth, viewHeight) {
  const vw = Math.max(1, Number(viewWidth) || 1);
  const vh = Math.max(1, Number(viewHeight) || 1);
  const x1 = Math.max(0, Math.min(vw, Number(pxRect.x) || 0));
  const y1 = Math.max(0, Math.min(vh, Number(pxRect.y) || 0));
  const x2 = Math.max(x1, Math.min(vw, x1 + Math.max(0, Number(pxRect.width) || 0)));
  const y2 = Math.max(y1, Math.min(vh, y1 + Math.max(0, Number(pxRect.height) || 0)));

  return {
    nx: x1 / vw,
    ny: y1 / vh,
    nw: (x2 - x1) / vw,
    nh: (y2 - y1) / vh
  };
}

/**
 * Converts a normalized visual `[0..1]` rectangle to DOM/Canvas top-left pixel coordinates.
 * @param {NormalizedRect} norm
 * @param {number} viewWidth
 * @param {number} viewHeight
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function normalizedToDomRect(norm, viewWidth, viewHeight) {
  const vw = Math.max(1, Number(viewWidth) || 1);
  const vh = Math.max(1, Number(viewHeight) || 1);
  return {
    x: norm.nx * vw,
    y: norm.ny * vh,
    width: norm.nw * vw,
    height: norm.nh * vh
  };
}

/**
 * Converts a normalized visual `[0..1]` rectangle (top-left origin) to unrotated PDF points,
 * accounting for `CropBox` offsets `(cropBox.x, cropBox.y)` and `/Rotate` (`0`, `90`, `180`, `270`).
 * @param {NormalizedRect} norm
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} rotationDegrees
 * @returns {PdfRect}
 */
export function normalizedToPdfRect(norm, cropBox, rotationDegrees = 0) {
  const { visW, visH, rot } = getVisualBoxSize(cropBox, rotationDegrees);
  const visTop = norm.ny * visH;
  const visLeft = norm.nx * visW;
  const visWidth = norm.nw * visW;
  const visHeight = norm.nh * visH;
  const visRight = visW - (visLeft + visWidth);
  const visBottom = visH - (visTop + visHeight);

  const unrot = mapVisualInsetsToUnrotatedPdf(
    { top: visTop, right: visRight, bottom: visBottom, left: visLeft },
    rot
  );

  return {
    x: cropBox.x + unrot.left,
    y: cropBox.y + unrot.bottom,
    width: Math.max(0, cropBox.width - unrot.left - unrot.right),
    height: Math.max(0, cropBox.height - unrot.top - unrot.bottom)
  };
}

/**
 * Maps a single unrotated PDF point `(pdfX, pdfY)` into visual top-left point space `(vx, vy)`
 * relative to the visible CropBox.
 * @param {number} pdfX
 * @param {number} pdfY
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} rotationDegrees
 * @returns {{ x: number, y: number }}
 */
export function pdfPointToVisualPoint(pdfX, pdfY, cropBox, rotationDegrees = 0) {
  const rot = normalizeRightAngle(rotationDegrees);
  const dx = pdfX - cropBox.x;
  const dy = pdfY - cropBox.y;

  switch (rot) {
    case 90:
      return { x: dy, y: dx };
    case 180:
      return { x: cropBox.width - dx, y: dy };
    case 270:
      return { x: cropBox.height - dy, y: cropBox.width - dx };
    case 0:
    default:
      return { x: dx, y: cropBox.height - dy };
  }
}

/**
 * Converts an unrotated PDF rectangle `(x, y, width, height)` into normalized visual `[0..1]` coordinates
 * (top-left origin), accounting for `CropBox` offsets and `/Rotate`.
 * @param {PdfRect} pdfRect
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} rotationDegrees
 * @returns {NormalizedRect}
 */
export function pdfRectToNormalized(pdfRect, cropBox, rotationDegrees = 0) {
  const { visW, visH, rot } = getVisualBoxSize(cropBox, rotationDegrees);
  const p1 = pdfPointToVisualPoint(pdfRect.x, pdfRect.y, cropBox, rot);
  const p2 = pdfPointToVisualPoint(
    pdfRect.x + pdfRect.width,
    pdfRect.y + pdfRect.height,
    cropBox,
    rot
  );

  const minX = Math.max(0, Math.min(visW, Math.min(p1.x, p2.x)));
  const minY = Math.max(0, Math.min(visH, Math.min(p1.y, p2.y)));
  const maxX = Math.max(minX, Math.min(visW, Math.max(p1.x, p2.x)));
  const maxY = Math.max(minY, Math.min(visH, Math.max(p1.y, p2.y)));

  return {
    nx: minX / visW,
    ny: minY / visH,
    nw: (maxX - minX) / visW,
    nh: (maxY - minY) / visH
  };
}

/**
 * Converts a normalized visual point `(nx, ny)` in `[0..1]` (top-left origin) to unrotated PDF points.
 * @param {number} nx
 * @param {number} ny
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} rotationDegrees
 * @returns {{ x: number, y: number }}
 */
export function normalizedPointToPdfPoint(nx, ny, cropBox, rotationDegrees = 0) {
  const rect = normalizedToPdfRect({ nx, ny, nw: 0, nh: 0 }, cropBox, rotationDegrees);
  return { x: rect.x, y: rect.y };
}

/**
 * Computes exact `pdf-lib` draw origin `(x, y)`, unrotated `width`/`height`, and CCW `rotateDegrees`
 * to draw a visually upright (plus optional `overlayCwRotation`) image or box inside `norm`
 * on a PDF page with `CropBox` and `/Rotate`.
 * Rotates cleanly around the visual overlay center so arbitrary angles align with CSS `transform: rotate(...)`.
 * @param {NormalizedRect} norm
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} pageRotationDegrees
 * @param {number} [overlayCwRotation=0] - Additional clockwise rotation in visual space
 * @returns {{ x: number, y: number, width: number, height: number, rotateDegrees: number, centerX: number, centerY: number }}
 */
export function computeOverlayPdfPlacement(
  norm,
  cropBox,
  pageRotationDegrees = 0,
  overlayCwRotation = 0
) {
  const { visW, visH, rot } = getVisualBoxSize(cropBox, pageRotationDegrees);
  const vw = norm.nw * visW;
  const vh = norm.nh * visH;
  const centerNormX = norm.nx + norm.nw / 2;
  const centerNormY = norm.ny + norm.nh / 2;
  const centerPdf = normalizedPointToPdfPoint(centerNormX, centerNormY, cropBox, rot);

  // Because the PDF viewer applies page clockwise `/Rotate = rot` (`-rot` CCW) when displaying the page,
  // drawing visually upright requires pre-rotating by `+rot` CCW to cancel `/Rotate`, then subtracting
  // `overlayCwRotation` (`-overlayCwRotation` CCW).
  const ccwDegrees = rot - (Number(overlayCwRotation) || 0);
  const rad = (ccwDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Offset from bottom-left (0, 0) to center (vw/2, vh/2) after CCW rotation by `rad`:
  const halfW = vw / 2;
  const halfH = vh / 2;
  const rotCenterOffsetX = halfW * cos - halfH * sin;
  const rotCenterOffsetY = halfW * sin + halfH * cos;

  return {
    x: centerPdf.x - rotCenterOffsetX,
    y: centerPdf.y - rotCenterOffsetY,
    width: vw,
    height: vh,
    rotateDegrees: ccwDegrees,
    centerX: centerPdf.x,
    centerY: centerPdf.y
  };
}

/**
 * Converts a `pdfjs-dist` text item (`transform` + `width` + `height`) with optional character slice
 * `[startChar, endChar]` into a normalized visual rectangle `[0..1]` using exact viewport or geometry bounds.
 * @param {any} textItem - Item from `page.getTextContent()`
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} pageRotationDegrees
 * @param {number} [startChar=0]
 * @param {number} [endChar]
 * @returns {NormalizedRect}
 */
export function pdfjsTextItemToNormalizedRect(
  textItem,
  cropBox,
  pageRotationDegrees = 0,
  startChar = 0,
  endChar
) {
  const tr = textItem.transform || [1, 0, 0, 1, 0, 0];
  const fullStr = String(textItem.str || '');
  const len = Math.max(1, fullStr.length);
  const safeStart = Math.max(0, Math.min(len, startChar));
  const safeEnd = endChar === undefined ? len : Math.max(safeStart + 1, Math.min(len, endChar));

  const tx = Number(tr[4]) || 0;
  const ty = Number(tr[5]) || 0;
  const fontH = Math.max(4, Number(textItem.height) || Math.hypot(tr[2] || 0, tr[3] || 0) || 10);
  const totalW = Math.max(1, Number(textItem.width) || 4);

  // Estimate rotated/horizontal baseline direction from transform [a, b, ...]
  const dirLen = Math.hypot(tr[0] || 1, tr[1] || 0) || 1;
  const ux = (tr[0] ?? 1) / dirLen;
  const uy = (tr[1] ?? 0) / dirLen;

  const startOffset = (safeStart / len) * totalW;
  const spanW = Math.max(2, ((safeEnd - safeStart) / len) * totalW);

  // Bounding box in unrotated PDF space spanning baseline start..end and baseline..baseline+fontH
  const bx1 = tx + ux * startOffset;
  const by1 = ty + uy * startOffset;
  const bx2 = bx1 + ux * spanW;
  const by2 = by1 + uy * spanW;

  // Baseline perpendicular upward vector (-uy, ux) for glyph ascent, with slight descender pad (-0.2 * fontH)
  const desc = -0.2 * fontH;
  const asc = 0.95 * fontH;
  const corners = [
    { x: bx1 + -uy * desc, y: by1 + ux * desc },
    { x: bx2 + -uy * desc, y: by2 + ux * desc },
    { x: bx1 + -uy * asc, y: by1 + ux * asc },
    { x: bx2 + -uy * asc, y: by2 + ux * asc }
  ];

  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));

  return pdfRectToNormalized(
    { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
    cropBox,
    pageRotationDegrees
  );
}
