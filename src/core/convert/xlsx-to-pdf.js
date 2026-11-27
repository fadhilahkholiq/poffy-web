import { PDFDocument, rgb } from 'pdf-lib';
import { assertNotAborted, yieldToLoop } from '../pdf/doc-loader.js';
import { createVectorFontManager, wrapTextToWidth } from './pdf-vector-utils.js';

/**
 * Formats a worksheet cell value cleanly to string.
 * @param {any} val
 * @returns {string}
 */
function cellToString(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).trim();
}

/**
 * Computes proportional column widths summing cleanly to `availableWidth` from actual content lengths.
 * @param {string[][]} rows
 * @param {number} colCount
 * @param {number} availableWidth
 * @returns {number[]}
 */
function computeSheetColWidths(rows, colCount, availableWidth) {
  const weights = new Array(colCount).fill(6);
  const sampleLimit = Math.min(rows.length, 200);
  for (let r = 0; r < sampleLimit; r += 1) {
    const row = rows[r];
    for (let c = 0; c < colCount; c += 1) {
      const len = String(row[c] || '').length;
      if (len > weights[c]) {
        weights[c] = Math.min(48, len);
      }
    }
  }
  const sum = weights.reduce((a, b) => a + b, 0) || colCount;
  const minColW = Math.min(54, availableWidth / Math.max(1, colCount));
  const raw = weights.map((w) => Math.max(minColW, (w / sum) * availableWidth));
  const rawSum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (w / rawSum) * availableWidth);
}

/**
 * Converts an Excel workbook (`.xlsx`, `.xls`) or `.csv` buffer into a paginated vector PDF
 * using lazy `import('xlsx')`, `pdf-lib`, and `@pdf-lib/fontkit`.
 *
 * @param {ArrayBuffer|Uint8Array} spreadsheetBytes
 * @param {Object} [config={}]
 * @param {'landscape'|'portrait'} [config.orientation='landscape']
 * @param {'all'|'first'} [config.sheetSelection='all']
 * @param {string} [fileName='spreadsheet.xlsx']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: 'application/pdf', warnings: string[], pageCount: number, sheetCount: number }>}
 */
export async function convertXlsxToPdf(
  spreadsheetBytes,
  config = {},
  fileName = 'spreadsheet.xlsx',
  options = {}
) {
  const { orientation = 'landscape', sheetSelection = 'all' } = config;
  const { onProgress, abortToken } = options;

  onProgress?.(10, 'Loading spreadsheet parser...');
  const XLSX = await import('xlsx');
  assertNotAborted(abortToken);

  onProgress?.(25, 'Parsing workbook sheets...');
  const u8 =
    spreadsheetBytes instanceof Uint8Array
      ? spreadsheetBytes
      : new Uint8Array(spreadsheetBytes);
  const wb = XLSX.read(u8, { type: 'array' });
  const allNames = wb.SheetNames || [];
  if (allNames.length === 0) {
    throw new Error('No worksheets found inside spreadsheet.');
  }

  const targetNames = sheetSelection === 'first' ? [allNames[0]] : allNames;
  const pageWidth = orientation === 'portrait' ? 595.28 : 841.89;
  const pageHeight = orientation === 'portrait' ? 841.89 : 595.28;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = margin + 14;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('Poffy Offline PDF Studio');
  const { resolveFont } = createVectorFontManager(pdfDoc);

  /** @type {string[]} */
  const warnings = [];
  const fontSize = 8.8;
  const lineH = 11.5;
  const padX = 5;
  const padY = 4;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - margin;

  const startNewPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - margin;
  };

  for (let sIdx = 0; sIdx < targetNames.length; sIdx += 1) {
    assertNotAborted(abortToken);
    const sheetName = targetNames[sIdx];
    const ws = wb.Sheets[sheetName];
    const rawAoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Normalize non-empty rows & trim empty trailing columns
    const rows = rawAoa
      .map((r) => (Array.isArray(r) ? r.map(cellToString) : [cellToString(r)]))
      .filter((r) => r.some((cell) => cell.length > 0));

    if (sIdx > 0 && cursorY < pageHeight - margin - 80) {
      startNewPage();
    }

    // Sheet title heading
    const titleText = targetNames.length > 1 ? `Sheet: ${sheetName}` : fileName;
    const titleFont = await resolveFont(titleText, { bold: true });
    page.drawText(titleText, {
      x: margin,
      y: cursorY - 12,
      size: 11.5,
      font: titleFont,
      color: rgb(0.11, 0.11, 0.12)
    });
    cursorY -= 22;

    if (rows.length === 0) {
      const emptyFont = await resolveFont('(Empty worksheet)', { italic: true });
      page.drawText('(Empty worksheet)', {
        x: margin,
        y: cursorY - 10,
        size: 9.5,
        font: emptyFont,
        color: rgb(0.45, 0.45, 0.48)
      });
      cursorY -= 20;
      continue;
    }

    const colCount = Math.max(1, ...rows.map((r) => r.length));
    const maxRenderCols = colCount;
    if (maxRenderCols > 18) {
      warnings.push(
        `Sheet "${sheetName}" has ${maxRenderCols} columns; column text may wrap tightly.`
      );
    }

    const paddedRows = rows.map((r) => {
      const out = new Array(colCount).fill('');
      for (let c = 0; c < Math.min(colCount, r.length); c += 1) out[c] = r[c];
      return out;
    });

    const colWidths = computeSheetColWidths(paddedRows, colCount, contentWidth);
    const headerRow = paddedRows[0];

    const drawTableRow = async (rowCells, isHeader) => {
      /** @type {string[][]} */
      const wrappedCols = [];
      /** @type {any[]} */
      const colFonts = [];
      let maxLines = 1;

      for (let c = 0; c < colCount; c += 1) {
        const text = rowCells[c] || '';
        const font = await resolveFont(text, { bold: isHeader });
        const wrapped = wrapTextToWidth(text, font, fontSize, Math.max(12, colWidths[c] - padX * 2));
        wrappedCols.push(wrapped);
        colFonts.push(font);
        if (wrapped.length > maxLines) maxLines = wrapped.length;
      }

      const rowHeight = Math.max(18, maxLines * lineH + padY * 2);

      if (cursorY - rowHeight < bottomLimit) {
        startNewPage();
        if (!isHeader && headerRow) {
          // Repeat table column header automatically on overflow pages
          await drawTableRow(headerRow, true);
        }
      }

      const rowTop = cursorY;
      const rowBottom = rowTop - rowHeight;
      let x = margin;

      for (let c = 0; c < colCount; c += 1) {
        const cw = colWidths[c];
        page.drawRectangle({
          x,
          y: rowBottom,
          width: cw,
          height: rowHeight,
          color: isHeader ? rgb(0.96, 0.96, 0.97) : rgb(1, 1, 1),
          borderColor: rgb(0.82, 0.82, 0.84),
          borderWidth: 0.5
        });

        const lines = wrappedCols[c];
        const font = colFonts[c];
        let textY = rowTop - padY - fontSize;
        for (const ln of lines) {
          if (ln) {
            page.drawText(ln, {
              x: x + padX,
              y: textY,
              size: fontSize,
              font,
              color: isHeader ? rgb(0.11, 0.11, 0.12) : rgb(0.24, 0.24, 0.26)
            });
          }
          textY -= lineH;
        }
        x += cw;
      }

      cursorY = rowBottom;
    };

    for (let r = 0; r < paddedRows.length; r += 1) {
      assertNotAborted(abortToken);
      await drawTableRow(paddedRows[r], r === 0);
      if (r % 40 === 0) {
        onProgress?.(
          Math.round(30 + ((sIdx + r / Math.max(1, paddedRows.length)) / targetNames.length) * 60),
          `Rendering sheet "${sheetName}" (${r + 1}/${paddedRows.length} rows)...`
        );
        await yieldToLoop();
      }
    }
  }

  onProgress?.(95, 'Serializing PDF file...');
  const pdfBytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  const buffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
  const stem = (fileName || 'spreadsheet').replace(/\.(xlsx|xls|csv)$/i, '') || 'spreadsheet';
  onProgress?.(100, 'Excel to PDF complete.', pdfDoc.getPageCount(), pdfDoc.getPageCount());

  return {
    buffer,
    fileName: `${stem}.pdf`,
    mimeType: 'application/pdf',
    warnings: [...new Set(warnings)],
    pageCount: pdfDoc.getPageCount(),
    sheetCount: targetNames.length
  };
}
