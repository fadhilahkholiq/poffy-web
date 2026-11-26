import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker,
  renderPdfJsPageToCanvas
} from '../render/pdfjs-worker-runtime.js';
import { assertNotAborted, yieldToLoop } from './doc-loader.js';

/**
 * Pure vanilla JS Myers O((N+M)D) diff algorithm for arrays of strings (words or lines).
 * Automatically falls back to coarse windowed diff if edit distance exceeds safety cap.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {{ type: 'equal'|'removed'|'added', value: string }[]}
 */
export function computeMyersDiff(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((value) => ({ type: 'added', value }));
  if (m === 0) return a.map((value) => ({ type: 'removed', value }));

  const maxD = Math.min(n + m, 2400);
  const offset = maxD;
  let v = new Int32Array(2 * maxD + 1);
  v.fill(-1);
  v[offset + 1] = 0;

  /** @type {Int32Array[]} */
  const trace = [];
  let foundD = -1;

  for (let d = 0; d <= maxD; d += 1) {
    trace.push(new Int32Array(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
    if (foundD >= 0) break;
  }

  if (foundD < 0) {
    return [
      ...a.map((value) => ({ type: /** @type {const} */ ('removed'), value })),
      ...b.map((value) => ({ type: /** @type {const} */ ('added'), value }))
    ];
  }

  /** @type {{ type: 'equal'|'removed'|'added', value: string }[]} */
  const reversed = [];
  let x = n;
  let y = m;

  for (let d = foundD; d > 0; d -= 1) {
    const prevV = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && prevV[offset + k - 1] < prevV[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prevV[offset + prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      reversed.push({ type: 'equal', value: a[x] });
    }
    if (x > prevX) {
      x -= 1;
      reversed.push({ type: 'removed', value: a[x] });
    } else if (y > prevY) {
      y -= 1;
      reversed.push({ type: 'added', value: b[y] });
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    reversed.push({ type: 'equal', value: a[x] });
  }
  while (x > 0) {
    x -= 1;
    reversed.push({ type: 'removed', value: a[x] });
  }
  while (y > 0) {
    y -= 1;
    reversed.push({ type: 'added', value: b[y] });
  }

  reversed.reverse();
  return reversed;
}

/**
 * Reconstructs ordered reading lines from `pdfjs-dist` `getTextContent()` items
 * sorted top-to-bottom (`transform[5]` desc) and left-to-right (`transform[4]` asc).
 * @param {any[]} items
 * @returns {string[]}
 */
export function extractOrderedTextLines(items = []) {
  const positioned = items
    .filter((it) => typeof it?.str === 'string' && it.str.length > 0)
    .map((it) => ({
      str: it.str,
      x: Number(it.transform?.[4] ?? 0),
      y: Number(it.transform?.[5] ?? 0)
    }));

  if (positioned.length === 0) return [];

  // Sort by Y descending (3pt row bucket) then X ascending
  positioned.sort((a, b) => {
    if (Math.abs(a.y - b.y) > 3.5) return b.y - a.y;
    return a.x - b.x;
  });

  /** @type {string[]} */
  const lines = [];
  let curY = positioned[0].y;
  let curRow = [];

  for (const item of positioned) {
    if (Math.abs(item.y - curY) > 3.5) {
      const joined = curRow
        .map((c) => c.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (joined) lines.push(joined);
      curRow = [item];
      curY = item.y;
    } else {
      curRow.push(item);
    }
  }

  if (curRow.length > 0) {
    const joined = curRow
      .map((c) => c.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (joined) lines.push(joined);
  }

  return lines;
}

/**
 * Diffs two equal-dimension RGBA Uint8ClampedArrays into a visual diff buffer:
 * - Unchanged pixels -> dimmed grayscale context
 * - Removed pixels (present/darker in A) -> Red (#ef4444)
 * - Added pixels (present/darker in B) -> Green (#22c55e)
 * @param {Uint8ClampedArray} dataA
 * @param {Uint8ClampedArray} dataB
 * @param {Uint8ClampedArray} outData
 * @param {number} [sensitivity=24] - Per-channel delta threshold (5..100)
 * @returns {{ changedPixels: number, totalPixels: number, changePercent: number }}
 */
export function diffRgbaBuffers(dataA, dataB, outData, sensitivity = 24) {
  const len = Math.min(dataA.length, dataB.length, outData.length);
  const totalPixels = Math.max(1, Math.floor(len / 4));
  let changedPixels = 0;

  for (let i = 0; i < len; i += 4) {
    const rA = dataA[i];
    const gA = dataA[i + 1];
    const bA = dataA[i + 2];
    const rB = dataB[i];
    const gB = dataB[i + 1];
    const bB = dataB[i + 2];

    const delta = Math.max(Math.abs(rA - rB), Math.abs(gA - gB), Math.abs(bA - bB));
    if (delta <= sensitivity) {
      const lumB = 0.299 * rB + 0.587 * gB + 0.114 * bB;
      const dimmed = Math.round(255 - (255 - lumB) * 0.25);
      outData[i] = dimmed;
      outData[i + 1] = dimmed;
      outData[i + 2] = dimmed;
      outData[i + 3] = 255;
    } else {
      changedPixels += 1;
      const lumA = 0.299 * rA + 0.587 * gA + 0.114 * bA;
      const lumB = 0.299 * rB + 0.587 * gB + 0.114 * bB;
      if (lumA + 4 < lumB) {
        // Ink existed in Original (A), removed/lighter in Revised (B) -> Red #ef4444
        outData[i] = 239;
        outData[i + 1] = 68;
        outData[i + 2] = 68;
      } else {
        // Ink added/changed in Revised (B) -> Green #22c55e
        outData[i] = 34;
        outData[i + 1] = 197;
        outData[i + 2] = 94;
      }
      outData[i + 3] = 255;
    }
  }

  return {
    changedPixels,
    totalPixels,
    changePercent: Math.round((changedPixels / totalPixels) * 10000) / 100
  };
}

/**
 * Renders a single pdfjs page into an equal-sized normalized white-background canvas (`targetW x targetH`)
 * and returns RGBA ImageData + WebP preview buffer while cleaning up canvas/page immediately.
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {number} pageIndex
 * @param {number} scale
 * @param {number|null} [forceW]
 * @param {number|null} [forceH]
 */
async function rasterizeForDiff(doc, pageIndex, scale, forceW = null, forceH = null) {
  const rendered = await renderPdfJsPageToCanvas(doc, pageIndex, scale, 0);
  try {
    const outW = forceW || rendered.width;
    const outH = forceH || rendered.height;
    let imageData;
    let webpBuffer;

    if (outW === rendered.width && outH === rendered.height) {
      imageData = rendered.ctx.getImageData(0, 0, outW, outH);
      const blob = await rendered.canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
      webpBuffer = await blob.arrayBuffer();
    } else {
      const padded = new OffscreenCanvas(outW, outH);
      try {
        const pCtx = padded.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!pCtx) throw new Error('Could not create padded diff canvas context.');
        pCtx.fillStyle = '#ffffff';
        pCtx.fillRect(0, 0, outW, outH);
        pCtx.drawImage(rendered.canvas, 0, 0);
        imageData = pCtx.getImageData(0, 0, outW, outH);
        const blob = await padded.convertToBlob({ type: 'image/webp', quality: 0.85 });
        webpBuffer = await blob.arrayBuffer();
      } finally {
        padded.width = 0;
        padded.height = 0;
      }
    }

    const textContent = await rendered.page.getTextContent();
    const lines = extractOrderedTextLines(textContent.items || []);

    return {
      width: outW,
      height: outH,
      data: imageData.data,
      webpBuffer,
      lines
    };
  } finally {
    rendered.cleanup();
  }
}

/**
 * Compares two PDF buffers visually (1.5x OffscreenCanvas pixel diff) and textually (Myers diff)
 * inside a Web Worker with mismatched page count handling and strict memory cleanup.
 * @param {ArrayBuffer|Uint8Array} bytesA
 * @param {ArrayBuffer|Uint8Array} bytesB
 * @param {Object} [config={}]
 * @param {number} [config.scale=1.5]
 * @param {number} [config.sensitivity=24]
 * @param {string} [config.nameA='Original.pdf']
 * @param {string} [config.nameB='Revised.pdf']
 * @param {(percent: number, stage: string, current?: number, total?: number) => void} [config.onProgress]
 * @param {{ aborted?: boolean }} [config.abortToken]
 */
export async function comparePdfDocuments(bytesA, bytesB, config = {}) {
  const {
    scale = 1.5,
    sensitivity = 24,
    nameA = 'Original.pdf',
    nameB = 'Revised.pdf',
    onProgress,
    abortToken
  } = config;

  const safeScale = Math.max(0.75, Math.min(2.0, Number(scale) || 1.5));
  const safeSens = Math.max(5, Math.min(100, Number(sensitivity) || 24));

  onProgress?.(5, 'Loading both PDFs for comparison...');
  const docA = await loadPdfJsInWorker(bytesA, nameA);
  const docB = await loadPdfJsInWorker(bytesB, nameB);

  try {
    const pagesA = docA.numPages;
    const pagesB = docB.numPages;
    const total = Math.max(pagesA, pagesB);
    const results = [];
    /** @type {ArrayBuffer[]} */
    const transferables = [];

    for (let i = 0; i < total; i += 1) {
      assertNotAborted(abortToken);
      const hasA = i < pagesA;
      const hasB = i < pagesB;

      if (hasA && hasB) {
        const ra = await rasterizeForDiff(docA, i, safeScale);
        const rb = await rasterizeForDiff(docB, i, safeScale, null, null);
        let dataA = ra.data;
        let dataB = rb.data;
        let bufA = ra.webpBuffer;
        let bufB = rb.webpBuffer;
        let w = ra.width;
        let h = ra.height;

        if (ra.width !== rb.width || ra.height !== rb.height) {
          w = Math.max(ra.width, rb.width);
          h = Math.max(ra.height, rb.height);
          const raNorm = await rasterizeForDiff(docA, i, safeScale, w, h);
          const rbNorm = await rasterizeForDiff(docB, i, safeScale, w, h);
          dataA = raNorm.data;
          dataB = rbNorm.data;
          bufA = raNorm.webpBuffer;
          bufB = rbNorm.webpBuffer;
        }

        const outCanvas = new OffscreenCanvas(w, h);
        let diffBuffer;
        let diffMetrics;
        try {
          const outCtx = outCanvas.getContext('2d', { alpha: false });
          if (!outCtx) throw new Error('Could not initialize diff output canvas.');
          const outImg = outCtx.createImageData(w, h);
          diffMetrics = diffRgbaBuffers(dataA, dataB, outImg.data, safeSens);
          outCtx.putImageData(outImg, 0, 0);
          const diffBlob = await outCanvas.convertToBlob({ type: 'image/png' });
          diffBuffer = await diffBlob.arrayBuffer();
        } finally {
          outCanvas.width = 0;
          outCanvas.height = 0;
        }

        const textDiff = computeMyersDiff(ra.lines, rb.lines);
        const status = diffMetrics.changePercent > 0.01 ? 'modified' : 'unchanged';

        transferables.push(bufA, bufB, diffBuffer);
        results.push({
          pageNumber: i + 1,
          status,
          width: w,
          height: h,
          changePercent: diffMetrics.changePercent,
          imageABuffer: bufA,
          imageBBuffer: bufB,
          diffBuffer,
          linesA: ra.lines,
          linesB: rb.lines,
          textDiff
        });
      } else if (hasA && !hasB) {
        const ra = await rasterizeForDiff(docA, i, safeScale);
        const outCanvas = new OffscreenCanvas(ra.width, ra.height);
        let diffBuffer;
        try {
          const outCtx = outCanvas.getContext('2d', { alpha: false });
          if (outCtx) {
            outCtx.fillStyle = '#fef2f2';
            outCtx.fillRect(0, 0, ra.width, ra.height);
            outCtx.fillStyle = '#ef4444';
            outCtx.fillRect(0, 0, ra.width, 16);
          }
          const diffBlob = await outCanvas.convertToBlob({ type: 'image/png' });
          diffBuffer = await diffBlob.arrayBuffer();
        } finally {
          outCanvas.width = 0;
          outCanvas.height = 0;
        }
        transferables.push(ra.webpBuffer, diffBuffer);
        results.push({
          pageNumber: i + 1,
          status: 'removed',
          width: ra.width,
          height: ra.height,
          changePercent: 100,
          imageABuffer: ra.webpBuffer,
          imageBBuffer: null,
          diffBuffer,
          linesA: ra.lines,
          linesB: [],
          textDiff: computeMyersDiff(ra.lines, [])
        });
      } else {
        const rb = await rasterizeForDiff(docB, i, safeScale);
        const outCanvas = new OffscreenCanvas(rb.width, rb.height);
        let diffBuffer;
        try {
          const outCtx = outCanvas.getContext('2d', { alpha: false });
          if (outCtx) {
            outCtx.fillStyle = '#f0fdf4';
            outCtx.fillRect(0, 0, rb.width, rb.height);
            outCtx.fillStyle = '#22c55e';
            outCtx.fillRect(0, 0, rb.width, 16);
          }
          const diffBlob = await outCanvas.convertToBlob({ type: 'image/png' });
          diffBuffer = await diffBlob.arrayBuffer();
        } finally {
          outCanvas.width = 0;
          outCanvas.height = 0;
        }
        transferables.push(rb.webpBuffer, diffBuffer);
        results.push({
          pageNumber: i + 1,
          status: 'added',
          width: rb.width,
          height: rb.height,
          changePercent: 100,
          imageABuffer: null,
          imageBBuffer: rb.webpBuffer,
          diffBuffer,
          linesA: [],
          linesB: rb.lines,
          textDiff: computeMyersDiff([], rb.lines)
        });
      }

      onProgress?.(
        10 + Math.round(((i + 1) / Math.max(1, total)) * 86),
        `Comparing page ${i + 1} of ${total}...`,
        i + 1,
        total
      );
      await yieldToLoop();
    }

    onProgress?.(100, 'Comparison complete.', total, total);
    return {
      pagesA,
      pagesB,
      totalPages: total,
      pages: results,
      transferables
    };
  } finally {
    await destroyPdfJsDoc(docA);
    await destroyPdfJsDoc(docB);
  }
}

/**
 * Generates a compact PDF visual diff report summarizing changed pages and embedding diff maps.
 * @param {{ nameA: string, nameB: string, pages: { pageNumber: number, status: string, changePercent: number, diffPngBytes: Uint8Array|ArrayBuffer }[] }} reportInput
 * @returns {Promise<Uint8Array>}
 */
export async function buildDiffReportPdf(reportInput) {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await doc.embedFont(StandardFonts.Helvetica);

  const summary = doc.addPage([595.28, 841.89]);
  summary.drawText('Poffy — Visual & Text Diff Report', {
    x: 42,
    y: 785,
    size: 18,
    font: fontBold,
    color: rgb(0.04, 0.04, 0.04)
  });
  summary.drawText(`Original (v1): ${reportInput.nameA}`, { x: 42, y: 755, size: 11, font: fontReg });
  summary.drawText(`Revised (v2): ${reportInput.nameB}`, { x: 42, y: 738, size: 11, font: fontReg });

  let y = 702;
  for (const p of reportInput.pages) {
    if (y < 60) break;
    const statusText = `Page ${p.pageNumber}: ${p.status.toUpperCase()} (${p.changePercent}% visual delta)`;
    summary.drawText(statusText, {
      x: 42,
      y,
      size: 10.5,
      font: p.status === 'unchanged' ? fontReg : fontBold,
      color:
        p.status === 'removed'
          ? rgb(0.85, 0.15, 0.15)
          : p.status === 'added'
            ? rgb(0.08, 0.55, 0.25)
            : rgb(0.1, 0.1, 0.1)
    });
    y -= 18;
  }

  for (const p of reportInput.pages) {
    if (!p.diffPngBytes || p.status === 'unchanged') continue;
    const raw =
      p.diffPngBytes instanceof Uint8Array ? p.diffPngBytes : new Uint8Array(p.diffPngBytes);
    const img = await doc.embedPng(raw);
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${p.pageNumber} — ${p.status.toUpperCase()} (${p.changePercent}% changed)`, {
      x: 36,
      y: 805,
      size: 12,
      font: fontBold
    });
    const availW = 523.28;
    const availH = 740;
    const scale = Math.min(availW / img.width, availH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    page.drawImage(img, {
      x: (595.28 - dw) / 2,
      y: 785 - dh,
      width: dw,
      height: dh
    });
  }

  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
