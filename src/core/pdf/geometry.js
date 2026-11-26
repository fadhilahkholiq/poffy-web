/**
 * Pure, dependency-free PDF page geometry, unit conversion, and placement math.
 * Safe for both Web Workers (pdf-lib) and main-thread UI live previews.
 * All coordinates and dimensions in PDF space use PostScript points (72 pt = 1 inch).
 */

/**
 * Standard paper presets in portrait orientation `[widthPt, heightPt]`.
 * @type {Record<string, { id: string, label: string, width: number, height: number }>}
 */
export const PAPER_PRESETS = {
  a4: { id: 'a4', label: 'A4 (210 × 297 mm)', width: 595.28, height: 841.89 },
  a3: { id: 'a3', label: 'A3 (297 × 420 mm)', width: 841.89, height: 1190.55 },
  a5: { id: 'a5', label: 'A5 (148 × 210 mm)', width: 419.53, height: 595.28 },
  letter: { id: 'letter', label: 'Letter (8.5 × 11 in)', width: 612, height: 792 },
  legal: { id: 'legal', label: 'Legal (8.5 × 14 in)', width: 612, height: 1008 },
  f4_id: { id: 'f4_id', label: 'F4/Folio (210 × 330 mm)', width: 595.28, height: 935.43 },
  f4_us: { id: 'f4_us', label: 'F4/US Folio (8.5 × 13 in)', width: 612, height: 936 }
};

/** @type {Record<'pt'|'mm'|'cm'|'in', number>} */
const UNIT_TO_PT = {
  pt: 1,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72
};

/**
 * Converts a scalar measurement from `mm | cm | in | pt` to PostScript points.
 * @param {number} value
 * @param {'pt'|'mm'|'cm'|'in'} [unit='pt']
 * @returns {number}
 */
export function toPoints(value, unit = 'pt') {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num * (UNIT_TO_PT[unit] || 1);
}

/**
 * Converts PostScript points to `mm | cm | in | pt`.
 * @param {number} points
 * @param {'pt'|'mm'|'cm'|'in'} [unit='pt']
 * @returns {number}
 */
export function fromPoints(points, unit = 'pt') {
  const num = Number(points);
  if (!Number.isFinite(num)) return 0;
  return num / (UNIT_TO_PT[unit] || 1);
}

/**
 * Normalizes any rotation angle to `0 | 90 | 180 | 270`.
 * @param {number} angle
 * @returns {0|90|180|270}
 */
export function normalizeRightAngle(angle) {
  const norm = ((Math.round((Number(angle) || 0) / 90) * 90) % 360 + 360) % 360;
  return /** @type {0|90|180|270} */ (norm);
}

/**
 * Reads the effective CropBox (falling back to MediaBox) and cumulative visual size of a PDFPage.
 * @param {import('pdf-lib').PDFPage} page
 * @returns {{ box: { x: number, y: number, width: number, height: number }, angle: 0|90|180|270, visualWidth: number, visualHeight: number }}
 */
export function getEffectivePageGeometry(page) {
  const crop = page.getCropBox();
  const angle = normalizeRightAngle(page.getRotation()?.angle || 0);
  const swap = angle === 90 || angle === 270;
  return {
    box: {
      x: crop.x,
      y: crop.y,
      width: Math.max(1, crop.width),
      height: Math.max(1, crop.height)
    },
    angle,
    visualWidth: swap ? Math.max(1, crop.height) : Math.max(1, crop.width),
    visualHeight: swap ? Math.max(1, crop.width) : Math.max(1, crop.height)
  };
}

/**
 * Resolves target page dimensions `[width, height]` in points given preset/custom and orientation mode.
 * @param {{ preset?: string, customWidth?: number, customHeight?: number, customUnit?: 'pt'|'mm'|'cm'|'in', orientation?: 'auto'|'portrait'|'landscape' }} cfg
 * @param {number} [sourceVisualWidth=595.28]
 * @param {number} [sourceVisualHeight=841.89]
 * @returns {{ width: number, height: number }}
 */
export function resolveTargetPageSize(cfg, sourceVisualWidth = 595.28, sourceVisualHeight = 841.89) {
  const presetKey = cfg?.preset || 'a4';
  let baseW;
  let baseH;

  if (presetKey === 'custom') {
    const unit = cfg?.customUnit || 'mm';
    baseW = Math.max(36, toPoints(cfg?.customWidth ?? 210, unit));
    baseH = Math.max(36, toPoints(cfg?.customHeight ?? 297, unit));
  } else {
    const p = PAPER_PRESETS[presetKey] || PAPER_PRESETS.a4;
    baseW = p.width;
    baseH = p.height;
  }

  const shortSide = Math.min(baseW, baseH);
  const longSide = Math.max(baseW, baseH);
  const orientation = cfg?.orientation || 'auto';

  if (orientation === 'portrait') {
    return { width: shortSide, height: longSide };
  }
  if (orientation === 'landscape') {
    return { width: longSide, height: shortSide };
  }
  // 'auto': match source visual orientation when preset is standard, or keep custom aspect if swapped
  const srcLandscape = sourceVisualWidth > sourceVisualHeight;
  if (presetKey === 'custom') {
    const customLandscape = baseW > baseH;
    return srcLandscape === customLandscape
      ? { width: baseW, height: baseH }
      : { width: baseH, height: baseW };
  }
  return srcLandscape
    ? { width: longSide, height: shortSide }
    : { width: shortSide, height: longSide };
}

/**
 * Computes destination visual bounding box `{ vx, vy, vw, vh, scale }` inside a target box
 * for Fit, Fill, or Original Center placement.
 * @param {{ srcWidth: number, srcHeight: number, boxX?: number, boxY?: number, boxWidth: number, boxHeight: number, fitMode?: 'fit'|'fill'|'original', marginPt?: number }} params
 * @returns {{ vx: number, vy: number, vw: number, vh: number, scale: number }}
 */
export function computePlacementRect(params) {
  const {
    srcWidth,
    srcHeight,
    boxX = 0,
    boxY = 0,
    boxWidth,
    boxHeight,
    fitMode = 'fit',
    marginPt = 0
  } = params;

  const safeSrcW = Math.max(1, srcWidth);
  const safeSrcH = Math.max(1, srcHeight);
  const safeMargin = fitMode === 'fit' ? Math.max(0, Math.min(marginPt, Math.min(boxWidth, boxHeight) * 0.4)) : 0;
  const availW = Math.max(1, boxWidth - safeMargin * 2);
  const availH = Math.max(1, boxHeight - safeMargin * 2);

  let scale = 1;
  if (fitMode === 'fit') {
    scale = Math.min(availW / safeSrcW, availH / safeSrcH);
  } else if (fitMode === 'fill') {
    scale = Math.max(boxWidth / safeSrcW, boxHeight / safeSrcH);
  } else {
    scale = 1;
  }

  const vw = safeSrcW * scale;
  const vh = safeSrcH * scale;
  const vx = boxX + (boxWidth - vw) / 2;
  const vy = boxY + (boxHeight - vh) / 2;

  return { vx, vy, vw, vh, scale };
}

/**
 * Computes exact `pdf-lib` `drawPage` parameters (`x, y, width, height, rotateDegrees`)
 * to place an unrotated embedded PDF page into visual box `[vx, vy, vw, vh]` rotated by `cwRotation`.
 * @param {number} unrotatedW - Embedded Form XObject width (before rotation)
 * @param {number} unrotatedH - Embedded Form XObject height (before rotation)
 * @param {number} vx - Target visual bottom-left X in points
 * @param {number} vy - Target visual bottom-left Y in points
 * @param {number} scale - Uniform scale factor
 * @param {number} cwRotation - Clockwise rotation in degrees (0, 90, 180, 270)
 * @returns {{ x: number, y: number, width: number, height: number, rotateDegrees: number }}
 */
export function computeDrawPageTransform(unrotatedW, unrotatedH, vx, vy, scale, cwRotation = 0) {
  const rot = normalizeRightAngle(cwRotation);
  const drawW = unrotatedW * scale;
  const drawH = unrotatedH * scale;

  switch (rot) {
    case 90:
      return {
        x: vx,
        y: vy + drawW,
        width: drawW,
        height: drawH,
        rotateDegrees: -90
      };
    case 180:
      return {
        x: vx + drawW,
        y: vy + drawH,
        width: drawW,
        height: drawH,
        rotateDegrees: -180
      };
    case 270:
      return {
        x: vx + drawH,
        y: vy,
        width: drawW,
        height: drawH,
        rotateDegrees: 90
      };
    case 0:
    default:
      return {
        x: vx,
        y: vy,
        width: drawW,
        height: drawH,
        rotateDegrees: 0
      };
  }
}

/**
 * Maps visual (rotated) insets `{ top, right, bottom, left }` back into unrotated PDF page space
 * accounting for cumulative page `/Rotate` (`0`, `90`, `180`, `270`).
 * @param {{ top: number, right: number, bottom: number, left: number }} vis
 * @param {number} totalRotationDegrees
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function mapVisualInsetsToUnrotatedPdf(vis, totalRotationDegrees) {
  const rot = normalizeRightAngle(totalRotationDegrees);
  switch (rot) {
    case 90:
      return {
        top: vis.right,
        right: vis.bottom,
        bottom: vis.left,
        left: vis.top
      };
    case 180:
      return {
        top: vis.bottom,
        right: vis.left,
        bottom: vis.top,
        left: vis.right
      };
    case 270:
      return {
        top: vis.left,
        right: vis.top,
        bottom: vis.right,
        left: vis.bottom
      };
    case 0:
    default:
      return { ...vis };
  }
}
