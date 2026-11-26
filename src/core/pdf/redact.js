import { PDFDocument } from 'pdf-lib';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { deepScrubPdf } from './metadata.js';
import { normalizedToDomRect, pdfjsTextItemToNormalizedRect } from './overlay-coords.js';

/**
 * @typedef {Object} RedactionMark
 * @property {string} id
 * @property {number} pageIndex - 0-based target page index
 * @property {number} nx - Normalized X [0..1]
 * @property {number} ny - Normalized Y [0..1]
 * @property {number} nw - Normalized width [0..1]
 * @property {number} nh - Normalized height [0..1]
 * @property {string} [sourceLabel] - Optional matched snippet or 'Manual'
 */

/**
 * Built-in search-and-mark regex presets (pure client-side matching).
 * @type {Record<string, RegExp>}
 */
export const REDACTION_PRESETS = {
  email: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  phone: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,5}/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g
};

/**
 * Compiles a search RegExp safely from preset or custom text/pattern.
 * @param {{ mode?: 'keyword'|'regex'|'email'|'phone'|'ssn', query?: string, caseSensitive?: boolean }} cfg
 * @returns {RegExp}
 */
export function buildRedactionRegex(cfg = {}) {
  const mode = cfg.mode || 'keyword';
  if (mode === 'email' || mode === 'phone' || mode === 'ssn') {
    return new RegExp(REDACTION_PRESETS[mode].source, 'gi');
  }
  const raw = String(cfg.query || '').trim();
  if (!raw) {
    throw new Error('Enter a search term or regular expression to mark.');
  }
  const flags = cfg.caseSensitive ? 'g' : 'gi';
  if (mode === 'regex') {
    return new RegExp(raw, flags);
  }
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, flags);
}

/**
 * Groups `getTextContent()` items into baseline lines and maps regex/keyword matches across
 * both single spans and contiguous multi-span lines into normalized `[0..1]` visual boxes.
 * @param {any[]} items
 * @param {{ x: number, y: number, width: number, height: number }} cropBox
 * @param {number} pageRotate
 * @param {RegExp} regex
 * @param {number} pageIndex
 * @returns {{ pageIndex: number, nx: number, ny: number, nw: number, nh: number, matchedText: string }[]}
 */
export function findMatchesInTextItems(items, cropBox, pageRotate, regex, pageIndex = 0) {
  /** @type {{ item: any, str: string, start: number, end: number }[][]} */
  const lines = [];
  let currentLine = null;
  let lastY = null;

  for (const item of items) {
    const str = String(item?.str || '');
    if (!str) continue;
    const y = Number(item.transform?.[5] ?? 0);
    if (currentLine && currentLine.length > 0 && lastY !== null && Math.abs(y - lastY) > 3.5) {
      lines.push(currentLine);
      currentLine = [];
    } else if (!currentLine) {
      currentLine = [];
    }

    const prevSeg = currentLine.length > 0 ? currentLine[currentLine.length - 1] : null;
    const prevEnd = prevSeg ? prevSeg.end : 0;
    let needsSpace = false;
    if (prevSeg && !prevSeg.str.endsWith(' ') && !str.startsWith(' ')) {
      const prevEndX = Number(prevSeg.item.transform?.[4] ?? 0) + Number(prevSeg.item.width ?? 0);
      const curX = Number(item.transform?.[4] ?? 0);
      const fontSize = Math.max(
        6,
        Number(item.height) || Math.hypot(item.transform?.[0] || 0, item.transform?.[1] || 0) || 10
      );
      if (curX - prevEndX > Math.max(1.5, fontSize * 0.18)) {
        needsSpace = true;
      }
    }
    const prefixOffset = needsSpace ? prevEnd + 1 : prevEnd;
    currentLine.push({
      item,
      str,
      start: prefixOffset,
      end: prefixOffset + str.length
    });
    lastY = y;
    if (item.hasEOL) {
      lines.push(currentLine);
      currentLine = null;
      lastY = null;
    }
  }
  if (currentLine && currentLine.length > 0) {
    lines.push(currentLine);
  }

  /** @type {{ pageIndex: number, nx: number, ny: number, nw: number, nh: number, matchedText: string }[]} */
  const matches = [];

  for (const lineSegments of lines) {
    let lineText = '';
    for (let s = 0; s < lineSegments.length; s += 1) {
      const seg = lineSegments[s];
      while (lineText.length < seg.start) lineText += ' ';
      lineText += seg.str;
    }

    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(lineText)) !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;
      const matchedRects = [];

      for (const seg of lineSegments) {
        const overlapStart = Math.max(matchStart, seg.start);
        const overlapEnd = Math.min(matchEnd, seg.end);
        if (overlapEnd > overlapStart) {
          const localStart = overlapStart - seg.start;
          const localEnd = overlapEnd - seg.start;
          matchedRects.push(
            pdfjsTextItemToNormalizedRect(seg.item, cropBox, pageRotate, localStart, localEnd)
          );
        }
      }

      if (matchedRects.length > 0) {
        const nx1 = Math.min(...matchedRects.map((r) => r.nx));
        const ny1 = Math.min(...matchedRects.map((r) => r.ny));
        const nx2 = Math.max(...matchedRects.map((r) => r.nx + r.nw));
        const ny2 = Math.max(...matchedRects.map((r) => r.ny + r.nh));
        matches.push({
          pageIndex,
          nx: Math.max(0, nx1 - 0.002),
          ny: Math.max(0, ny1 - 0.002),
          nw: Math.min(1 - Math.max(0, nx1 - 0.002), nx2 - nx1 + 0.004),
          nh: Math.min(1 - Math.max(0, ny1 - 0.002), ny2 - ny1 + 0.004),
          matchedText: m[0]
        });
      }
    }
  }

  return matches;
}

/**
 * Searches all pages of a PDF buffer using `pdfjs-dist` `getTextContent()` and returns
 * normalized redaction rectangles for matching keywords/patterns.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {{ mode?: 'keyword'|'regex'|'email'|'phone'|'ssn', query?: string, caseSensitive?: boolean }} queryConfig
 * @param {{ fileName?: string, onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 */
export async function findRedactionMatchesInPdf(pdfBytes, queryConfig, options = {}) {
  const { fileName = '', onProgress, abortToken } = options;
  const regex = buildRedactionRegex(queryConfig);
  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);

  try {
    const total = pdfjsDoc.numPages;
    /** @type {{ pageIndex: number, nx: number, ny: number, nw: number, nh: number, matchedText: string }[]} */
    const allMatches = [];

    for (let i = 0; i < total; i += 1) {
      assertNotAborted(abortToken);
      const page = await pdfjsDoc.getPage(i + 1);
      try {
        const view = page.view || [0, 0, 595.28, 841.89];
        const cropBox = {
          x: view[0],
          y: view[1],
          width: view[2] - view[0],
          height: view[3] - view[1]
        };
        const textContent = await page.getTextContent();
        const pageMatches = findMatchesInTextItems(
          textContent.items || [],
          cropBox,
          page.rotate || 0,
          regex,
          i
        );
        allMatches.push(...pageMatches);
      } finally {
        page.cleanup();
      }

      onProgress?.(
        Math.round(((i + 1) / Math.max(1, total)) * 100),
        `Scanning page ${i + 1} of ${total} for text matches...`,
        i + 1,
        total
      );
      await yieldToLoop();
    }

    return allMatches;
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}

/**
 * Permanently applies True Redactions using Selective Raster-Burn (or full Paranoid Mode).
 * Untouched pages are copied losslessly via `copyPages()`; marked pages (or all pages in Paranoid Mode)
 * are rendered to OffscreenCanvas, painted with solid opaque boxes directly on pixels, and rebuilt via pdf-lib.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {RedactionMark[]} marks
 * @param {Object} [config={}]
 * @param {number} [config.dpi=220] - Raster burn DPI (200 - 300)
 * @param {string} [config.fillColor='#000000'] - Opaque redaction fill color
 * @param {boolean} [config.paranoidMode=false] - Raster-burn ALL pages + deepScrubPdf()
 * @param {string} [fileName='']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ bytes: Uint8Array, totalPages: number, burnedPages: number, copiedPages: number, paranoidMode: boolean }>}
 */
export async function applyRedactionsToPdf(
  pdfBytes,
  marks = [],
  config = {},
  fileName = '',
  options = {}
) {
  const { dpi = 220, fillColor = '#000000', paranoidMode = false } = config;
  const { onProgress, abortToken } = options;

  const safeDpi = Math.max(150, Math.min(300, Number(dpi) || 220));
  const scale = safeDpi / 72;

  /** @type {Map<number, RedactionMark[]>} */
  const marksByPage = new Map();
  for (const m of marks) {
    const idx = Math.floor(Number(m.pageIndex));
    if (idx < 0 || !Number.isFinite(idx)) continue;
    if (!marksByPage.has(idx)) marksByPage.set(idx, []);
    marksByPage.get(idx).push(m);
  }

  assertNotAborted(abortToken);
  onProgress?.(8, 'Preparing redaction pipeline...');

  const srcDoc = await loadPdfSafe(pdfBytes, fileName);
  const totalPages = srcDoc.getPageCount();
  const destDoc = await PDFDocument.create();

  const needsRaster = paranoidMode || marksByPage.size > 0;
  const pdfjsDoc = needsRaster ? await loadPdfJsInWorker(pdfBytes, fileName) : null;

  let burnedPages = 0;
  let copiedPages = 0;

  try {
    for (let i = 0; i < totalPages; i += 1) {
      assertNotAborted(abortToken);
      const pageMarks = marksByPage.get(i) || [];
      const shouldBurn = paranoidMode || pageMarks.length > 0;

      if (!shouldBurn) {
        const [copied] = await destDoc.copyPages(srcDoc, [i]);
        destDoc.addPage(copied);
        copiedPages += 1;
      } else {
        if (!pdfjsDoc) throw new Error('Rasterizer unavailable for redaction.');
        const rendered = await renderPdfJsPageToCanvas(pdfjsDoc, i, scale, 0);
        let pngBytes;
        let ptWidth;
        let ptHeight;

        try {
          const baseVp = rendered.page.getViewport({ scale: 1, rotation: rendered.page.rotate });
          ptWidth = baseVp.width;
          ptHeight = baseVp.height;

          // Burn solid opaque redaction rectangles directly onto canvas pixels with 2px safety bleed
          rendered.ctx.fillStyle = fillColor || '#000000';
          for (const mark of pageMarks) {
            const px = normalizedToDomRect(mark, rendered.width, rendered.height);
            const rx = Math.max(0, Math.floor(px.x) - 2);
            const ry = Math.max(0, Math.floor(px.y) - 2);
            const rw = Math.min(rendered.width - rx, Math.ceil(px.width) + 4);
            const rh = Math.min(rendered.height - ry, Math.ceil(px.height) + 4);
            rendered.ctx.fillRect(rx, ry, rw, rh);
          }

          const blob = await rendered.canvas.convertToBlob({ type: 'image/png' });
          pngBytes = new Uint8Array(await blob.arrayBuffer());
        } finally {
          rendered.cleanup();
        }

        const embedded = await destDoc.embedPng(pngBytes);
        const burnedPage = destDoc.addPage([ptWidth, ptHeight]);
        burnedPage.drawImage(embedded, {
          x: 0,
          y: 0,
          width: ptWidth,
          height: ptHeight
        });
        burnedPages += 1;
      }

      const pct = 12 + Math.round(((i + 1) / Math.max(1, totalPages)) * 78);
      onProgress?.(
        pct,
        shouldBurn
          ? `Burning redactions on page ${i + 1} of ${totalPages}...`
          : `Copying clean page ${i + 1} of ${totalPages}...`,
        i + 1,
        totalPages
      );
      await yieldToLoop();
    }
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }

  if (paranoidMode) {
    onProgress?.(93, 'Running Paranoid Mode deep privacy scrub...');
    deepScrubPdf(destDoc, {
      scrubInfo: true,
      purgeXmp: true,
      removeThumbnails: true,
      stripScriptsAndActions: true
    });
  }

  assertNotAborted(abortToken);
  onProgress?.(96, 'Serializing redacted PDF...', totalPages, totalPages);
  const bytes = await destDoc.save({ useObjectStreams: true, addDefaultPage: false });
  onProgress?.(100, 'True redaction complete.', totalPages, totalPages);

  return {
    bytes,
    totalPages,
    burnedPages,
    copiedPages,
    paranoidMode
  };
}
