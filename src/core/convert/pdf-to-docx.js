import { assertNotAborted } from '../pdf/doc-loader.js';
import { extractPdfLayout } from './layout-extractor.js';

/**
 * Converts a PDF buffer into a native Word `.docx` document inside browser memory
 * using lazy dynamic `import('docx')`.
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [config={}]
 * @param {boolean} [config.preservePageBreaks=true]
 * @param {'flowing'|'preserve-lines'} [config.layoutMode='flowing']
 * @param {boolean} [config.detectTables=true]
 * @param {string} [config.rangeExpression='all']
 * @param {string} [fileName='document.pdf']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: string, warnings: string[], pageCount: number, isLikelyScanned: boolean, tableCount: number }>}
 */
export async function convertPdfToDocx(pdfBytes, config = {}, fileName = 'document.pdf', options = {}) {
  const {
    preservePageBreaks = true,
    layoutMode = 'flowing',
    detectTables = true,
    rangeExpression = 'all'
  } = config;
  const { onProgress, abortToken } = options;

  const layout = await extractPdfLayout(
    pdfBytes,
    { rangeExpression, detectTables },
    fileName,
    { onProgress, abortToken }
  );
  assertNotAborted(abortToken);

  onProgress?.(75, 'Loading Word document builder...');
  const docx = await import('docx');
  assertNotAborted(abortToken);

  const {
    Document,
    HeadingLevel,
    Packer,
    PageBreak,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = docx;

  /** @type {string[]} */
  const warnings = [];
  if (layout.isLikelyScanned) {
    warnings.push('Near-zero embedded text found; scanned PDF pages produce minimal editable text in Word.');
  }

  const toTextRuns = (runs, fallbackText, sizePt) => {
    const sourceRuns = runs && runs.length > 0 ? runs : [{ text: fallbackText, isBold: false, isItalic: false }];
    return sourceRuns.map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: Boolean(r.isBold),
          italics: Boolean(r.isItalic),
          size: sizePt ? Math.max(16, Math.round(sizePt * 2)) : undefined
        })
    );
  };

  /** @type {any[]} */
  const children = [];
  let tableCount = 0;

  onProgress?.(85, 'Building Word paragraphs & tables...');
  for (let pIdx = 0; pIdx < layout.pages.length; pIdx += 1) {
    assertNotAborted(abortToken);
    const page = layout.pages[pIdx];

    if (pIdx > 0 && preservePageBreaks) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    for (const block of page.blocks) {
      if (block.type === 'heading') {
        const heading =
          block.level === 1
            ? HeadingLevel.HEADING_1
            : block.level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3;
        children.push(
          new Paragraph({
            heading,
            spacing: { before: 180, after: 80 },
            children: [
              new TextRun({
                text: block.text,
                bold: true
              })
            ]
          })
        );
      } else if (block.type === 'paragraph') {
        if (layoutMode === 'preserve-lines' && block.lines.length > 1) {
          /** @type {any[]} */
          const lineRuns = [];
          block.lines.forEach((ln, idx) => {
            if (idx > 0) {
              lineRuns.push(new TextRun({ text: '', break: 1 }));
            }
            lineRuns.push(...toTextRuns(ln.runs, ln.text, 11));
          });
          children.push(
            new Paragraph({
              spacing: { after: 120 },
              children: lineRuns
            })
          );
        } else {
          children.push(
            new Paragraph({
              spacing: { after: 120 },
              children: toTextRuns(block.runs, block.text, 11)
            })
          );
        }
      } else if (block.type === 'list') {
        for (const item of block.items) {
          if (block.ordered) {
            children.push(
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  new TextRun({ text: `${item.marker} `, bold: true }),
                  ...toTextRuns(item.runs, item.text, 11)
                ]
              })
            );
          } else {
            children.push(
              new Paragraph({
                bullet: { level: 0 },
                spacing: { after: 60 },
                children: toTextRuns(item.runs, item.text, 11)
              })
            );
          }
        }
      } else if (block.type === 'table') {
        tableCount += 1;
        const rows = block.rows.map(
          (rowCells, rIdx) =>
            new TableRow({
              tableHeader: rIdx === 0,
              children: rowCells.map(
                (cellText) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: cellText || '',
                            bold: rIdx === 0,
                            size: 20
                          })
                        ]
                      })
                    ]
                  })
              )
            })
        );
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows
          })
        );
        children.push(new Paragraph({ text: '', spacing: { after: 80 } }));
      }
    }
  }

  if (children.length === 0) {
    children.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    creator: 'Poffy Offline PDF Studio',
    sections: [{ children }]
  });

  onProgress?.(94, 'Packaging DOCX archive...');
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  const stem = (fileName || 'document').replace(/\.pdf$/i, '') || 'document';
  onProgress?.(100, 'Word conversion complete.', layout.selectedPageCount, layout.selectedPageCount);

  return {
    buffer: arrayBuffer,
    fileName: `${stem}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    warnings,
    pageCount: layout.selectedPageCount,
    isLikelyScanned: layout.isLikelyScanned,
    tableCount
  };
}
