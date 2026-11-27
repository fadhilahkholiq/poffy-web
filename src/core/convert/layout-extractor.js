import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { assertNotAborted, yieldToLoop } from '../pdf/doc-loader.js';
import { destroyPdfJsDoc, loadPdfJsInWorker } from '../render/pdfjs-worker-runtime.js';
import { parsePageRange } from '../utils/page-range.js';

/**
 * @typedef {Object} ExtractedTextItem
 * @property {string} str
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} fontSize
 * @property {string} fontName
 * @property {boolean} isBold
 * @property {boolean} isItalic
 */

/**
 * @typedef {Object} StyledRun
 * @property {string} text
 * @property {boolean} isBold
 * @property {boolean} isItalic
 * @property {number} fontSize
 */

/**
 * @typedef {Object} CellSegment
 * @property {number} x
 * @property {number} endX
 * @property {string} text
 * @property {StyledRun[]} runs
 */

/**
 * @typedef {Object} LayoutLine
 * @property {string} text
 * @property {number} x
 * @property {number} y
 * @property {number} endX
 * @property {number} fontSize
 * @property {boolean} isBold
 * @property {boolean} isItalic
 * @property {number} gapBefore
 * @property {StyledRun[]} runs
 * @property {CellSegment[]} segments
 * @property {'bullet'|'ordered'|null} listType
 * @property {string} listMarker
 * @property {string} listText
 * @property {'h1'|'h2'|'h3'|'body'} role
 */

/**
 * @typedef {Object} HeadingBlock
 * @property {'heading'} type
 * @property {1|2|3} level
 * @property {string} text
 * @property {number} x
 * @property {number} y
 * @property {number} fontSize
 * @property {StyledRun[]} runs
 */

/**
 * @typedef {Object} ParagraphBlock
 * @property {'paragraph'} type
 * @property {string} text
 * @property {number} x
 * @property {number} y
 * @property {number} fontSize
 * @property {StyledRun[]} runs
 * @property {{ text: string, runs: StyledRun[], x: number, y: number }[]} lines
 */

/**
 * @typedef {Object} ListBlock
 * @property {'list'} type
 * @property {boolean} ordered
 * @property {{ text: string, marker: string, runs: StyledRun[], x: number, y: number }[]} items
 */

/**
 * @typedef {Object} TableBlock
 * @property {'table'} type
 * @property {string[][]} rows
 * @property {number} columnCount
 * @property {number} y
 */

/** @typedef {HeadingBlock|ParagraphBlock|ListBlock|TableBlock} LayoutBlock */

/**
 * @typedef {Object} PageLayoutResult
 * @property {number} pageNumber
 * @property {number} widthPt
 * @property {number} heightPt
 * @property {number} charCount
 * @property {ExtractedTextItem[]} items
 * @property {LayoutLine[]} lines
 * @property {LayoutBlock[]} blocks
 * @property {string[][][]} tables
 */

/**
 * @typedef {Object} DocumentLayoutResult
 * @property {number} totalPages
 * @property {number} selectedPageCount
 * @property {number} medianFontSize
 * @property {number} totalChars
 * @property {boolean} isLikelyScanned
 * @property {PageLayoutResult[]} pages
 */

const BOLD_RE = /bold|black|heavy|semibold|demibold|medi|extra|bd\b/i;
const ITALIC_RE = /italic|oblique|slant|inclined|it\b/i;
const BULLET_PREFIX_RE = /^([•●○▪▫‣◦\-*–—])\s+(.+)$/;
const ORDERED_PREFIX_RE = /^((?:\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4})[.)]|\(\d{1,3}\))\s+(.+)$/;

/**
 * Detects bold/italic styling from PDF font name and style family string.
 * @param {string} fontName
 * @param {string} fontFamily
 * @returns {{ isBold: boolean, isItalic: boolean }}
 */
function detectFontStyle(fontName, fontFamily) {
  const combined = `${fontName || ''} ${fontFamily || ''}`;
  return {
    isBold: BOLD_RE.test(combined),
    isItalic: ITALIC_RE.test(combined)
  };
}

/**
 * Computes weighted median font size across all items in the selected pages.
 * @param {ExtractedTextItem[]} allItems
 * @returns {number}
 */
export function computeMedianFontSize(allItems) {
  if (!allItems || allItems.length === 0) return 12;
  /** @type {number[]} */
  const samples = [];
  for (const item of allItems) {
    const trimmedLen = item.str.trim().length;
    if (trimmedLen === 0) continue;
    const rounded = Math.round(item.fontSize * 2) / 2;
    const weight = Math.min(20, Math.max(1, Math.ceil(trimmedLen / 4)));
    for (let i = 0; i < weight; i += 1) {
      samples.push(rounded);
    }
  }
  if (samples.length === 0) return 12;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] || 12;
}

/**
 * Merges consecutive StyledRuns that share identical bold/italic formatting.
 * @param {StyledRun[]} runs
 * @returns {StyledRun[]}
 */
function coalesceRuns(runs) {
  /** @type {StyledRun[]} */
  const out = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out[out.length - 1];
    if (last && last.isBold === run.isBold && last.isItalic === run.isItalic) {
      last.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/**
 * Parses a bullet or numbered list prefix from a reconstructed line string.
 * @param {string} text
 * @returns {{ listType: 'bullet'|'ordered'|null, listMarker: string, listText: string }}
 */
function parseListPrefix(text) {
  const bulletMatch = BULLET_PREFIX_RE.exec(text);
  if (bulletMatch) {
    return { listType: 'bullet', listMarker: bulletMatch[1], listText: bulletMatch[2].trim() };
  }
  const orderedMatch = ORDERED_PREFIX_RE.exec(text);
  if (orderedMatch) {
    return { listType: 'ordered', listMarker: orderedMatch[1], listText: orderedMatch[2].trim() };
  }
  return { listType: null, listMarker: '', listText: text };
}

/**
 * Strips leading list marker from a line's styled runs cleanly.
 * @param {StyledRun[]} runs
 * @param {string} marker
 * @returns {StyledRun[]}
 */
function stripMarkerFromRuns(runs, marker) {
  if (!marker || runs.length === 0) return runs;
  const cloned = runs.map((r) => ({ ...r }));
  let remainingToStrip = `${marker} `;
  for (const run of cloned) {
    if (!remainingToStrip) break;
    if (run.text.startsWith(remainingToStrip)) {
      run.text = run.text.slice(remainingToStrip.length);
      remainingToStrip = '';
    } else if (remainingToStrip.startsWith(run.text)) {
      remainingToStrip = remainingToStrip.slice(run.text.length);
      run.text = '';
    } else {
      const idx = run.text.indexOf(marker);
      if (idx !== -1) {
        run.text = run.text.slice(idx + marker.length).replace(/^\s+/, '');
      }
      remainingToStrip = '';
    }
  }
  return coalesceRuns(cloned.filter((r) => r.text.length > 0));
}

/**
 * Groups page items into top-down visual lines and splits wide X gaps into cell segments.
 * @param {ExtractedTextItem[]} items
 * @param {number} medianFontSize
 * @returns {LayoutLine[]}
 */
function buildLayoutLines(items, medianFontSize) {
  const nonEmpty = items.filter((it) => it.str.length > 0);
  if (nonEmpty.length === 0) return [];

  const yTol = Math.max(2.5, medianFontSize * 0.38);
  const sorted = [...nonEmpty].sort((a, b) => {
    if (Math.abs(a.y - b.y) > yTol) return a.y - b.y;
    return a.x - b.x;
  });

  /** @type {ExtractedTextItem[][]} */
  const groups = [];
  let curGroup = [sorted[0]];
  let curY = sorted[0].y;

  for (let i = 1; i < sorted.length; i += 1) {
    const it = sorted[i];
    if (Math.abs(it.y - curY) > yTol) {
      groups.push(curGroup);
      curGroup = [it];
      curY = it.y;
    } else {
      curGroup.push(it);
    }
  }
  groups.push(curGroup);

  const columnGapThreshold = Math.max(12, medianFontSize * 1.45);
  /** @type {LayoutLine[]} */
  const lines = [];

  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);

    /** @type {CellSegment[]} */
    const segments = [];
    /** @type {StyledRun[]} */
    const allRuns = [];
    let fullText = '';
    let weightedSizeSum = 0;
    let totalWeight = 0;
    let boldWeight = 0;
    let italicWeight = 0;

    let segStartX = group[0].x;
    let segEndX = group[0].x + group[0].width;
    let segText = '';
    /** @type {StyledRun[]} */
    let segRuns = [];

    for (let i = 0; i < group.length; i += 1) {
      const span = group[i];
      const w = Math.max(1, span.str.trim().length);
      weightedSizeSum += span.fontSize * w;
      totalWeight += w;
      if (span.isBold) boldWeight += w;
      if (span.isItalic) italicWeight += w;

      if (i > 0) {
        const prev = group[i - 1];
        const prevEnd = prev.x + prev.width;
        const gap = span.x - prevEnd;
        const needsSpace =
          !prev.str.endsWith(' ') &&
          !span.str.startsWith(' ') &&
          gap > Math.max(1.2, span.fontSize * 0.16);

        if (gap >= columnGapThreshold) {
          const cleanSeg = segText.replace(/\s+/g, ' ').trim();
          if (cleanSeg) {
            segments.push({
              x: segStartX,
              endX: segEndX,
              text: cleanSeg,
              runs: coalesceRuns(segRuns)
            });
          }
          segStartX = span.x;
          segText = '';
          segRuns = [];
          fullText += ' ';
          allRuns.push({
            text: ' ',
            isBold: false,
            isItalic: false,
            fontSize: span.fontSize
          });
        } else if (needsSpace) {
          segText += ' ';
          segRuns.push({
            text: ' ',
            isBold: prev.isBold && span.isBold,
            isItalic: prev.isItalic && span.isItalic,
            fontSize: span.fontSize
          });
          fullText += ' ';
          allRuns.push({
            text: ' ',
            isBold: prev.isBold && span.isBold,
            isItalic: prev.isItalic && span.isItalic,
            fontSize: span.fontSize
          });
        }
      }

      segText += span.str;
      segEndX = Math.max(segEndX, span.x + span.width);
      segRuns.push({
        text: span.str,
        isBold: span.isBold,
        isItalic: span.isItalic,
        fontSize: span.fontSize
      });
      fullText += span.str;
      allRuns.push({
        text: span.str,
        isBold: span.isBold,
        isItalic: span.isItalic,
        fontSize: span.fontSize
      });
    }

    const cleanLastSeg = segText.replace(/\s+/g, ' ').trim();
    if (cleanLastSeg) {
      segments.push({
        x: segStartX,
        endX: segEndX,
        text: cleanLastSeg,
        runs: coalesceRuns(segRuns)
      });
    }

    const cleanedFull = fullText.replace(/\s+/g, ' ').trim();
    if (!cleanedFull) continue;

    const avgFontSize = totalWeight > 0 ? weightedSizeSum / totalWeight : group[0].fontSize;
    const isBold = totalWeight > 0 && boldWeight / totalWeight >= 0.7;
    const isItalic = totalWeight > 0 && italicWeight / totalWeight >= 0.7;
    const parsedList = segments.length <= 1 ? parseListPrefix(cleanedFull) : { listType: null, listMarker: '', listText: cleanedFull };

    lines.push({
      text: cleanedFull,
      x: group[0].x,
      y: group[0].y,
      endX: Math.max(...group.map((g) => g.x + g.width)),
      fontSize: avgFontSize,
      isBold,
      isItalic,
      gapBefore: 0,
      runs: coalesceRuns(allRuns),
      segments,
      listType: parsedList.listType,
      listMarker: parsedList.listMarker,
      listText: parsedList.listText,
      role: 'body'
    });
  }

  return lines;
}

/**
 * Classifies heading roles and vertical line gaps across a page's lines.
 * @param {LayoutLine[]} lines
 * @param {number} medianFontSize
 * @returns {number} medianLineStep
 */
function classifyLines(lines, medianFontSize) {
  const gaps = [];
  for (let i = 1; i < lines.length; i += 1) {
    const gap = lines[i].y - lines[i - 1].y;
    if (gap > 0) {
      lines[i].gapBefore = gap;
      gaps.push(gap);
    }
  }
  gaps.sort((a, b) => a - b);
  const medianLineStep = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : medianFontSize * 1.25;

  for (const line of lines) {
    if (line.segments.length >= 2 || line.listType) {
      line.role = 'body';
      continue;
    }
    const ratio = line.fontSize / Math.max(1, medianFontSize);
    const shortHeadingCandidate = line.text.length <= 140;
    if (shortHeadingCandidate && ratio >= 1.65) {
      line.role = 'h1';
    } else if (shortHeadingCandidate && ratio >= 1.3) {
      line.role = 'h2';
    } else if (
      shortHeadingCandidate &&
      (ratio >= 1.12 || (line.isBold && line.text.length <= 85 && line.gapBefore > medianLineStep * 1.25))
    ) {
      line.role = 'h3';
    } else {
      line.role = 'body';
    }
  }

  return medianLineStep;
}

/**
 * Clusters consecutive multi-segment rows sharing aligned X-column anchors into structured 2D matrices.
 * @param {LayoutLine[]} rowLines
 * @returns {{ rows: string[][], columnCount: number }|null}
 */
function buildTableFromRows(rowLines) {
  if (rowLines.length < 2) return null;

  /** @type {number[]} */
  const allX = [];
  for (const row of rowLines) {
    for (const seg of row.segments) {
      allX.push(seg.x);
    }
  }
  allX.sort((a, b) => a - b);

  /** @type {number[]} */
  const anchors = [];
  const clusterTol = 18;
  for (const x of allX) {
    const last = anchors[anchors.length - 1];
    if (last === undefined || x - last > clusterTol) {
      anchors.push(x);
    } else {
      anchors[anchors.length - 1] = (last + x) / 2;
    }
  }

  if (anchors.length < 2) return null;

  // Merge anchors whose clusters remain very close or produce empty columns across rows
  const columnCount = anchors.length;
  /** @type {string[][]} */
  const matrix = rowLines.map((row) => {
    const cells = new Array(columnCount).fill('');
    for (const seg of row.segments) {
      let bestCol = 0;
      let bestDist = Infinity;
      for (let c = 0; c < columnCount; c += 1) {
        const dist = Math.abs(seg.x - anchors[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = c;
        }
      }
      cells[bestCol] = cells[bestCol] ? `${cells[bestCol]} ${seg.text}` : seg.text;
    }
    return cells;
  });

  // Drop empty columns created by tiny X jitter
  const nonEmptyCols = [];
  for (let c = 0; c < columnCount; c += 1) {
    if (matrix.some((r) => r[c].length > 0)) {
      nonEmptyCols.push(c);
    }
  }
  if (nonEmptyCols.length < 2) return null;

  const trimmed = matrix.map((r) => nonEmptyCols.map((c) => r[c]));
  const avgFilledCols =
    trimmed.reduce((sum, r) => sum + r.filter(Boolean).length, 0) / trimmed.length;
  if (avgFilledCols < 1.5) return null;

  return {
    rows: trimmed,
    columnCount: nonEmptyCols.length
  };
}

/**
 * Groups classified lines into structured blocks (headings, paragraphs, lists, tables).
 * @param {LayoutLine[]} lines
 * @param {number} medianLineStep
 * @param {number} medianFontSize
 * @param {boolean} detectTables
 * @returns {{ blocks: LayoutBlock[], tables: string[][][] }}
 */
function buildLayoutBlocks(lines, medianLineStep, medianFontSize, detectTables = true) {
  /** @type {LayoutBlock[]} */
  const blocks = [];
  /** @type {string[][][]} */
  const tables = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 1. Tabular region run: >= 2 consecutive rows with >= 2 segments and bounded vertical gap
    if (detectTables && line.segments.length >= 2) {
      const candidateRows = [line];
      let j = i + 1;
      const maxRowGap = Math.max(medianLineStep * 3.2, medianFontSize * 4);
      while (j < lines.length && lines[j].segments.length >= 2 && lines[j].gapBefore <= maxRowGap) {
        candidateRows.push(lines[j]);
        j += 1;
      }
      const parsedTable = buildTableFromRows(candidateRows);
      if (parsedTable) {
        blocks.push({
          type: 'table',
          rows: parsedTable.rows,
          columnCount: parsedTable.columnCount,
          y: line.y
        });
        tables.push(parsedTable.rows);
        i = j;
        continue;
      }
    }

    // 2. Headings
    if (line.role !== 'body') {
      const level = /** @type {1|2|3} */ (line.role === 'h1' ? 1 : line.role === 'h2' ? 2 : 3);
      blocks.push({
        type: 'heading',
        level,
        text: line.text,
        x: line.x,
        y: line.y,
        fontSize: line.fontSize,
        runs: line.runs
      });
      i += 1;
      continue;
    }

    // 3. Bullet or Ordered Lists
    if (line.listType) {
      const ordered = line.listType === 'ordered';
      const items = [];
      while (i < lines.length && lines[i].listType && (lines[i].listType === 'ordered') === ordered) {
        if (items.length > 0 && lines[i].gapBefore > medianLineStep * 2.4) break;
        const cur = lines[i];
        items.push({
          text: cur.listText,
          marker: cur.listMarker,
          runs: stripMarkerFromRuns(cur.runs, cur.listMarker),
          x: cur.x,
          y: cur.y
        });
        i += 1;
      }
      blocks.push({
        type: 'list',
        ordered,
        items
      });
      continue;
    }

    // 4. Paragraph block (joins closely spaced consecutive body lines)
    const paraLines = [line];
    let k = i + 1;
    const paraBreakGap = medianLineStep * 1.45;
    while (
      k < lines.length &&
      lines[k].role === 'body' &&
      !lines[k].listType &&
      !(detectTables && lines[k].segments.length >= 2 && k + 1 < lines.length && lines[k + 1].segments.length >= 2) &&
      lines[k].gapBefore <= paraBreakGap
    ) {
      paraLines.push(lines[k]);
      k += 1;
    }

    /** @type {StyledRun[]} */
    const combinedRuns = [];
    const textParts = [];
    for (let pIdx = 0; pIdx < paraLines.length; pIdx += 1) {
      const pl = paraLines[pIdx];
      if (pIdx > 0) {
        const prevTxt = textParts[textParts.length - 1];
        if (prevTxt.endsWith('-') && /^[a-z]/.test(pl.text)) {
          textParts[textParts.length - 1] = prevTxt.slice(0, -1) + pl.text;
          const lastRun = combinedRuns[combinedRuns.length - 1];
          if (lastRun && lastRun.text.endsWith('-')) {
            lastRun.text = lastRun.text.slice(0, -1);
          }
          combinedRuns.push(...pl.runs);
          continue;
        }
        combinedRuns.push({
          text: ' ',
          isBold: false,
          isItalic: false,
          fontSize: pl.fontSize
        });
      }
      textParts.push(pl.text);
      combinedRuns.push(...pl.runs);
    }

    blocks.push({
      type: 'paragraph',
      text: textParts.join(' '),
      x: line.x,
      y: line.y,
      fontSize: line.fontSize,
      runs: coalesceRuns(combinedRuns),
      lines: paraLines.map((pl) => ({
        text: pl.text,
        runs: pl.runs,
        x: pl.x,
        y: pl.y
      }))
    });
    i = k;
  }

  return { blocks, tables };
}

/**
 * Extracts rich geometric layout information from selected PDF pages using `pdfjs-dist`
 * inside the Web Worker with strict CSP compliance (`isEvalSupported: false`, local assets).
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [config={}]
 * @param {string} [config.rangeExpression='all']
 * @param {boolean} [config.detectTables=true]
 * @param {string} [fileName='']
 * @param {{ onProgress?: (percent: number, stage: string, current?: number, total?: number) => void, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<DocumentLayoutResult>}
 */
export async function extractPdfLayout(pdfBytes, config = {}, fileName = '', options = {}) {
  const { rangeExpression = 'all', detectTables = true } = config;
  const { onProgress, abortToken } = options;

  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);
  try {
    const totalPages = pdfjsDoc.numPages;
    const indices = parsePageRange(rangeExpression || 'all', totalPages);

    /** @type {{ pageNumber: number, widthPt: number, heightPt: number, items: ExtractedTextItem[] }[]} */
    const rawPages = [];
    /** @type {ExtractedTextItem[]} */
    const allItems = [];

    for (let i = 0; i < indices.length; i += 1) {
      assertNotAborted(abortToken);
      const pageIdx = indices[i];
      const page = await pdfjsDoc.getPage(pageIdx + 1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const styles = content.styles || {};

        /** @type {ExtractedTextItem[]} */
        const pageItems = [];
        for (const it of content.items || []) {
          // Skip synthetic pure-whitespace filler items emitted by pdfjs-dist across wide column gaps
          if (typeof it?.str !== 'string' || it.str.trim().length === 0) continue;
          const m = pdfjsLib.Util.transform(viewport.transform, it.transform || [10, 0, 0, 10, 0, 0]);
          const fontSize = Math.max(
            1,
            Number(it.height) || Math.hypot(Number(m[0]) || 0, Number(m[1]) || 0) || 10
          );
          const fontName = String(it.fontName || '');
          const fontFamily = String(styles[fontName]?.fontFamily || '');
          const styleFlags = detectFontStyle(fontName, fontFamily);

          const item = {
            str: it.str,
            x: Number(m[4] ?? 0),
            // Baseline converted via top-down viewport transform
            y: Number(m[5] ?? 0),
            width: Math.max(0, Number(it.width ?? 0)),
            height: fontSize,
            fontSize,
            fontName,
            isBold: styleFlags.isBold,
            isItalic: styleFlags.isItalic
          };
          pageItems.push(item);
          allItems.push(item);
        }

        rawPages.push({
          pageNumber: pageIdx + 1,
          widthPt: viewport.width,
          heightPt: viewport.height,
          items: pageItems
        });
      } finally {
        page.cleanup();
      }

      onProgress?.(
        Math.round(((i + 1) / Math.max(1, indices.length)) * 65),
        `Analyzing layout on page ${i + 1} of ${indices.length}...`,
        i + 1,
        indices.length
      );
      await yieldToLoop();
    }

    const medianFontSize = computeMedianFontSize(allItems);
    /** @type {PageLayoutResult[]} */
    const pages = [];
    let totalChars = 0;

    for (let i = 0; i < rawPages.length; i += 1) {
      assertNotAborted(abortToken);
      const rp = rawPages[i];
      const lines = buildLayoutLines(rp.items, medianFontSize);
      const medianStep = classifyLines(lines, medianFontSize);
      const { blocks, tables } = buildLayoutBlocks(lines, medianStep, medianFontSize, detectTables);
      const charCount = lines.reduce((sum, l) => sum + l.text.length, 0);
      totalChars += charCount;

      pages.push({
        pageNumber: rp.pageNumber,
        widthPt: rp.widthPt,
        heightPt: rp.heightPt,
        charCount,
        items: rp.items,
        lines,
        blocks,
        tables
      });
    }

    const avgCharsPerPage = indices.length > 0 ? totalChars / indices.length : 0;
    const isLikelyScanned = indices.length > 0 && (totalChars < 12 || avgCharsPerPage < 15);

    return {
      totalPages,
      selectedPageCount: indices.length,
      medianFontSize,
      totalChars,
      isLikelyScanned,
      pages
    };
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}
