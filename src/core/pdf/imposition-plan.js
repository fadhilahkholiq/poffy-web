/**
 * Pure, dependency-free N-Up grid and Saddle-Stitch Booklet imposition planner.
 * Shared between Web Workers (imposition.js) and main-thread live sheet diagram previews.
 */

import { resolveTargetPageSize } from './geometry.js';

/**
 * Resolves grid rows and columns for a given N-Up count and target sheet dimensions.
 * @param {2|4|6|9} nUp
 * @param {number} sheetW
 * @param {number} sheetH
 * @returns {{ cols: number, rows: number }}
 */
export function getNupGrid(nUp, sheetW, sheetH) {
  const isLandscape = sheetW >= sheetH;
  switch (Number(nUp)) {
    case 2:
      return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
    case 4:
      return { cols: 2, rows: 2 };
    case 6:
      return isLandscape ? { cols: 3, rows: 2 } : { cols: 2, rows: 3 };
    case 9:
      return { cols: 3, rows: 3 };
    default:
      return isLandscape ? { cols: 2, rows: 1 } : { cols: 1, rows: 2 };
  }
}

/**
 * Generates ordered slot coordinates `(col, row)` for a grid based on reading order.
 * Row `0` is the top row visually; Col `0` is the leftmost column visually.
 * @param {number} cols
 * @param {number} rows
 * @param {'ltr'|'rtl'|'ttb'} order
 * @returns {{ col: number, row: number }[]}
 */
function buildSlotOrder(cols, rows, order) {
  /** @type {{ col: number, row: number }[]} */
  const slots = [];
  if (order === 'rtl') {
    for (let r = 0; r < rows; r += 1) {
      for (let c = cols - 1; c >= 0; c -= 1) {
        slots.push({ col: c, row: r });
      }
    }
  } else if (order === 'ttb') {
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        slots.push({ col: c, row: r });
      }
    }
  } else {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        slots.push({ col: c, row: r });
      }
    }
  }
  return slots;
}

/**
 * @typedef {Object} ImposedSlot
 * @property {number|null} pageNumber - 1-based source page index, or null for blank padding
 * @property {number} col - 0-based visual column (0 = left)
 * @property {number} row - 0-based visual row (0 = top)
 * @property {number} extraRotation - Additional clockwise degrees (e.g. 180 for back-side flip)
 */

/**
 * @typedef {Object} ImposedSheet
 * @property {number} sheetIndex - 1-based output sheet number
 * @property {'front'|'back'|'sheet'} side
 * @property {boolean} flipped180
 * @property {ImposedSlot[]} slots
 */

/**
 * Computes deterministic sheet-by-sheet placement for N-Up or Saddle-Stitch Booklet mode.
 * @param {number} totalSourcePages
 * @param {Object} [config={}]
 * @param {'nup'|'booklet'} [config.mode='nup']
 * @param {2|4|6|9} [config.nUp=2]
 * @param {'ltr'|'rtl'|'ttb'} [config.nUpOrder='ltr']
 * @param {string} [config.sheetPreset='a4']
 * @param {'portrait'|'landscape'} [config.sheetOrientation]
 * @param {'left'|'right'} [config.bindingEdge='left']
 * @param {boolean} [config.flipBackSide=false]
 * @returns {{ sheets: ImposedSheet[], cols: number, rows: number, sheetWidth: number, sheetHeight: number, paddedPageCount: number }}
 */
export function computeImpositionPlan(totalSourcePages, config = {}) {
  const safeTotal = Math.max(0, Math.floor(totalSourcePages));
  const mode = config.mode === 'booklet' ? 'booklet' : 'nup';
  const orientation =
    config.sheetOrientation || (mode === 'booklet' ? 'landscape' : 'portrait');

  const { width: sheetWidth, height: sheetHeight } = resolveTargetPageSize({
    preset: config.sheetPreset || 'a4',
    orientation
  });

  if (safeTotal === 0) {
    const grid = mode === 'booklet' ? { cols: 2, rows: 1 } : getNupGrid(config.nUp || 2, sheetWidth, sheetHeight);
    return {
      sheets: [],
      cols: grid.cols,
      rows: grid.rows,
      sheetWidth,
      sheetHeight,
      paddedPageCount: 0
    };
  }

  if (mode === 'booklet') {
    const padded = Math.max(4, Math.ceil(safeTotal / 4) * 4);
    const sheetPairs = padded / 4;
    const isRtlBinding = config.bindingEdge === 'right';
    const flipBackSide = Boolean(config.flipBackSide);
    /** @type {ImposedSheet[]} */
    const sheets = [];

    const toPageOrBlank = (oneBased) => (oneBased >= 1 && oneBased <= safeTotal ? oneBased : null);

    for (let k = 0; k < sheetPairs; k += 1) {
      // Front: LTR -> [N - 2k, 2k + 1], RTL -> [2k + 1, N - 2k]
      const fA = padded - 2 * k;
      const fB = 2 * k + 1;
      const frontLeft = isRtlBinding ? fB : fA;
      const frontRight = isRtlBinding ? fA : fB;

      sheets.push({
        sheetIndex: sheets.length + 1,
        side: 'front',
        flipped180: false,
        slots: [
          { pageNumber: toPageOrBlank(frontLeft), col: 0, row: 0, extraRotation: 0 },
          { pageNumber: toPageOrBlank(frontRight), col: 1, row: 0, extraRotation: 0 }
        ]
      });

      // Back: LTR -> [2k + 2, N - 2k - 1], RTL -> [N - 2k - 1, 2k + 2]
      const bA = 2 * k + 2;
      const bB = padded - 2 * k - 1;
      let backLeft = isRtlBinding ? bB : bA;
      let backRight = isRtlBinding ? bA : bB;
      let backRot = 0;

      if (flipBackSide) {
        [backLeft, backRight] = [backRight, backLeft];
        backRot = 180;
      }

      sheets.push({
        sheetIndex: sheets.length + 1,
        side: 'back',
        flipped180: flipBackSide,
        slots: [
          { pageNumber: toPageOrBlank(backLeft), col: 0, row: 0, extraRotation: backRot },
          { pageNumber: toPageOrBlank(backRight), col: 1, row: 0, extraRotation: backRot }
        ]
      });
    }

    return {
      sheets,
      cols: 2,
      rows: 1,
      sheetWidth,
      sheetHeight,
      paddedPageCount: padded
    };
  }

  // N-Up Grid mode
  const nUp = /** @type {2|4|6|9} */ ([2, 4, 6, 9].includes(Number(config.nUp)) ? Number(config.nUp) : 2);
  const { cols, rows } = getNupGrid(nUp, sheetWidth, sheetHeight);
  const perSheet = cols * rows;
  const order = config.nUpOrder || 'ltr';
  const slotCoords = buildSlotOrder(cols, rows, order);
  const totalSheets = Math.ceil(safeTotal / perSheet);
  /** @type {ImposedSheet[]} */
  const sheets = [];

  for (let s = 0; s < totalSheets; s += 1) {
    /** @type {ImposedSlot[]} */
    const slots = [];
    for (let slotIdx = 0; slotIdx < perSheet; slotIdx += 1) {
      const pageNum = s * perSheet + slotIdx + 1;
      const coord = slotCoords[slotIdx];
      slots.push({
        pageNumber: pageNum <= safeTotal ? pageNum : null,
        col: coord.col,
        row: coord.row,
        extraRotation: 0
      });
    }
    sheets.push({
      sheetIndex: s + 1,
      side: 'sheet',
      flipped180: false,
      slots
    });
  }

  return {
    sheets,
    cols,
    rows,
    sheetWidth,
    sheetHeight,
    paddedPageCount: safeTotal
  };
}
