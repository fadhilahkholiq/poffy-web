import { assertNotAborted } from '../pdf/doc-loader.js';
import { extractPdfLayout } from './layout-extractor.js';

/**
 * Formats styled runs into Markdown inline emphasis (`**bold**`, `*italic*`, `***both***`).
 * @param {import('./layout-extractor.js').StyledRun[]} runs
 * @returns {string}
 */
function formatRunsToMarkdown(runs) {
  if (!runs || runs.length === 0) return '';
  return runs
    .map((r) => {
      if (!r.text) return '';
      if (!r.isBold && !r.isItalic) return r.text;
      const leadingWs = r.text.match(/^\s*/)?.[0] || '';
      const trailingWs = r.text.match(/\s*$/)?.[0] || '';
      const core = r.text.trim();
      if (!core) return r.text;
      const escapedCore = core.replace(/([\\`*_])/g, '\\$1');
      if (r.isBold && r.isItalic) return `${leadingWs}***${escapedCore}***${trailingWs}`;
      if (r.isBold) return `${leadingWs}**${escapedCore}**${trailingWs}`;
      return `${leadingWs}*${escapedCore}*${trailingWs}`;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formats a 2D cell matrix into a GitHub-Flavored Markdown pipe table.
 * @param {string[][]} rows
 * @returns {string}
 */
function formatTableToMarkdown(rows) {
  if (!rows || rows.length === 0) return '';
  const colCount = Math.max(...rows.map((r) => r.length));
  const normalizeRow = (r) => {
    const out = [];
    for (let c = 0; c < colCount; c += 1) {
      out.push(String(r[c] || '').replace(/\|/g, '\\|').trim());
    }
    return `| ${out.join(' | ')} |`;
  };
  const header = normalizeRow(rows[0]);
  const sep = `| ${new Array(colCount).fill('---').join(' | ')} |`;
  const body = rows.slice(1).map(normalizeRow);
  return [header, sep, ...body].join('\n');
}

/**
 * Converts a PDF buffer into a clean CommonMark / GitHub-Flavored Markdown UTF-8 ArrayBuffer.
 *
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} [config={}]
 * @param {'hr'|'comment'|'none'} [config.pageBreakSeparator='hr']
 * @param {boolean} [config.includePageNumbers=true]
 * @param {boolean} [config.detectTables=true]
 * @param {string} [config.rangeExpression='all']
 * @param {string} [fileName='document.pdf']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: string, warnings: string[], markdownText: string, pageCount: number, isLikelyScanned: boolean, tableCount: number }>}
 */
export async function convertPdfToMarkdown(pdfBytes, config = {}, fileName = 'document.pdf', options = {}) {
  const {
    pageBreakSeparator = 'hr',
    includePageNumbers = true,
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
  onProgress?.(85, 'Formatting Markdown document...');

  /** @type {string[]} */
  const warnings = [];
  if (layout.isLikelyScanned) {
    warnings.push('Near-zero text layer detected; this PDF appears to be scanned images.');
  }

  let tableCount = 0;
  /** @type {string[]} */
  const pageChunks = [];

  for (const page of layout.pages) {
    assertNotAborted(abortToken);
    /** @type {string[]} */
    const parts = [];

    if (includePageNumbers) {
      if (pageBreakSeparator === 'comment') {
        parts.push(`<!-- Page ${page.pageNumber} -->`);
      } else {
        parts.push(`*Page ${page.pageNumber}*`);
      }
    } else if (pageBreakSeparator === 'comment' && pageChunks.length > 0) {
      parts.push(`<!-- Page ${page.pageNumber} -->`);
    }

    for (const block of page.blocks) {
      if (block.type === 'heading') {
        const hashes = '#'.repeat(block.level);
        parts.push(`${hashes} ${block.text}`);
      } else if (block.type === 'paragraph') {
        const mdLine = formatRunsToMarkdown(block.runs) || block.text;
        if (mdLine) parts.push(mdLine);
      } else if (block.type === 'list') {
        const listLines = block.items.map((item, idx) => {
          const itemMd = formatRunsToMarkdown(item.runs) || item.text;
          return block.ordered ? `${idx + 1}. ${itemMd}` : `- ${itemMd}`;
        });
        parts.push(listLines.join('\n'));
      } else if (block.type === 'table') {
        tableCount += 1;
        parts.push(formatTableToMarkdown(block.rows));
      }
    }

    const joined = parts.filter(Boolean).join('\n\n');
    if (joined) pageChunks.push(joined);
  }

  const glue = pageBreakSeparator === 'hr' ? '\n\n---\n\n' : '\n\n';
  const markdownText = pageChunks.join(glue).trim();
  const encoder = new TextEncoder();
  const bytes = encoder.encode(markdownText ? `${markdownText}\n` : '');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const stem = (fileName || 'document').replace(/\.pdf$/i, '') || 'document';
  onProgress?.(100, 'Markdown conversion complete.', layout.selectedPageCount, layout.selectedPageCount);

  return {
    buffer,
    fileName: `${stem}.md`,
    mimeType: 'text/markdown;charset=utf-8',
    warnings,
    markdownText,
    pageCount: layout.selectedPageCount,
    isLikelyScanned: layout.isLikelyScanned,
    tableCount
  };
}
