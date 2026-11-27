import { assertNotAborted } from '../pdf/doc-loader.js';
import { extractPdfLayout } from './layout-extractor.js';

/**
 * Clusters all multi-segment rows across a page into aligned columns for `all-rows` spreadsheet mode.
 * @param {import('./layout-extractor.js').PageLayoutResult} page
 * @returns {string[][]}
 */
function pageLinesToSpreadsheetRows(page) {
  const segLines = page.lines.filter((l) => l.segments.length >= 2);
  /** @type {number[]} */
  const anchors = [];
  if (segLines.length > 0) {
    const xs = segLines.flatMap((l) => l.segments.map((s) => s.x)).sort((a, b) => a - b);
    for (const x of xs) {
      const last = anchors[anchors.length - 1];
      if (last === undefined || x - last > 22) {
        anchors.push(x);
      } else {
        anchors[anchors.length - 1] = (last + x) / 2;
      }
    }
  }

  /** @type {string[][]} */
  const rows = [];
  for (const line of page.lines) {
    if (line.segments.length <= 1 || anchors.length < 2) {
      rows.push([line.text]);
      continue;
    }
    const row = new Array(anchors.length).fill('');
    for (const seg of line.segments) {
      let bestCol = 0;
      let bestDist = Infinity;
      for (let c = 0; c < anchors.length; c += 1) {
        const dist = Math.abs(seg.x - anchors[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = c;
        }
      }
      row[bestCol] = row[bestCol] ? `${row[bestCol]} ${seg.text}` : seg.text;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Computes clean Excel column widths from a 2D cell array.
 * @param {string[][]} aoa
 * @returns {{ wch: number }[]}
 */
function computeColumnWidths(aoa) {
  const maxCols = aoa.reduce((m, r) => Math.max(m, r.length), 0);
  const widths = new Array(maxCols).fill(10);
  for (const row of aoa) {
    for (let c = 0; c < row.length; c += 1) {
      const len = String(row[c] ?? '').length;
      if (len + 2 > widths[c]) {
        widths[c] = Math.min(64, len + 2);
      }
    }
  }
  return widths.map((wch) => ({ wch }));
}

/**
 * Converts a PDF buffer into an Excel `.xlsx` workbook inside browser memory
 * using lazy dynamic `import('xlsx')`.
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [config={}]
 * @param {'per-page'|'combined'} [config.sheetMode='per-page']
 * @param {'tables-only'|'all-rows'} [config.extractionMode='all-rows']
 * @param {string} [config.rangeExpression='all']
 * @param {string} [fileName='document.pdf']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: string, warnings: string[], pageCount: number, isLikelyScanned: boolean, sheetCount: number, tableCount: number }>}
 */
export async function convertPdfToXlsx(pdfBytes, config = {}, fileName = 'document.pdf', options = {}) {
  const {
    sheetMode = 'per-page',
    extractionMode = 'all-rows',
    rangeExpression = 'all'
  } = config;
  const { onProgress, abortToken } = options;

  const layout = await extractPdfLayout(
    pdfBytes,
    { rangeExpression, detectTables: true },
    fileName,
    { onProgress, abortToken }
  );
  assertNotAborted(abortToken);

  onProgress?.(75, 'Loading Excel workbook builder...');
  const XLSX = await import('xlsx');
  assertNotAborted(abortToken);

  /** @type {string[]} */
  const warnings = [];
  if (layout.isLikelyScanned) {
    warnings.push('Near-zero embedded text found; scanned PDF pages cannot be parsed into spreadsheet cells.');
  }

  const wb = XLSX.utils.book_new();
  let tableCount = 0;
  let sheetCount = 0;

  onProgress?.(85, 'Formatting Excel worksheets...');

  if (sheetMode === 'combined') {
    /** @type {string[][]} */
    const combinedAoa = [];
    for (const page of layout.pages) {
      assertNotAborted(abortToken);
      const pageTables = page.tables || [];
      tableCount += pageTables.length;

      if (extractionMode === 'tables-only') {
        for (const tbl of pageTables) {
          if (combinedAoa.length > 0) combinedAoa.push([]);
          combinedAoa.push([`Page ${page.pageNumber}`]);
          combinedAoa.push(...tbl);
        }
      } else {
        const rows = pageLinesToSpreadsheetRows(page);
        if (rows.length > 0) {
          if (combinedAoa.length > 0) combinedAoa.push([]);
          combinedAoa.push([`Page ${page.pageNumber}`]);
          combinedAoa.push(...rows);
        }
      }
    }

    if (combinedAoa.length === 0) {
      warnings.push(
        extractionMode === 'tables-only'
          ? 'No multi-column tables were detected in the selected pages.'
          : 'No text rows were extracted from the selected pages.'
      );
      combinedAoa.push(['No structured rows extracted']);
    }

    const ws = XLSX.utils.aoa_to_sheet(combinedAoa);
    ws['!cols'] = computeColumnWidths(combinedAoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Extracted Data');
    sheetCount = 1;
  } else {
    for (const page of layout.pages) {
      assertNotAborted(abortToken);
      const pageTables = page.tables || [];
      tableCount += pageTables.length;

      /** @type {string[][]} */
      let aoa = [];
      if (extractionMode === 'tables-only') {
        for (const tbl of pageTables) {
          if (aoa.length > 0) aoa.push([]);
          aoa.push(...tbl);
        }
      } else {
        aoa = pageLinesToSpreadsheetRows(page);
      }

      if (aoa.length === 0) {
        if (extractionMode === 'tables-only') continue;
        aoa = [[`Page ${page.pageNumber} (empty)`]];
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = computeColumnWidths(aoa);
      const sheetName = `Page ${page.pageNumber}`.slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      sheetCount += 1;
    }

    if (sheetCount === 0) {
      warnings.push('No multi-column tables were detected in the selected pages.');
      const ws = XLSX.utils.aoa_to_sheet([['No tables detected']]);
      XLSX.utils.book_append_sheet(wb, ws, 'Summary');
      sheetCount = 1;
    }
  }

  onProgress?.(94, 'Writing XLSX file...');
  const written = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const u8 = written instanceof Uint8Array ? written : new Uint8Array(written);
  const buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

  const stem = (fileName || 'document').replace(/\.pdf$/i, '') || 'document';
  onProgress?.(100, 'Excel conversion complete.', layout.selectedPageCount, layout.selectedPageCount);

  return {
    buffer,
    fileName: `${stem}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    warnings,
    pageCount: layout.selectedPageCount,
    isLikelyScanned: layout.isLikelyScanned,
    sheetCount,
    tableCount
  };
}
