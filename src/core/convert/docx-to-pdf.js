import { PDFDocument, rgb } from 'pdf-lib';
import { assertNotAborted, yieldToLoop } from '../pdf/doc-loader.js';
import {
  decodeBasicXmlEntities,
  parseRelsMap,
  readOoxmlXml,
  resolveOoxmlTargetPath,
  safeUnzipOoxml
} from './ooxml-reader.js';
import {
  createVectorFontManager,
  embedRasterImageSafe,
  parseHexColor
} from './pdf-vector-utils.js';

const EMU_PER_PT = 12700;

/**
 * Helper to inspect `preserveOrder: true` XML nodes cleanly.
 */
function tagKey(node) {
  if (!node || typeof node !== 'object') return null;
  for (const k of Object.keys(node)) {
    if (k !== ':@' && k !== '#text') return k;
  }
  return null;
}

function getChildren(node, targetTag) {
  const k = tagKey(node);
  const arr = k ? node[k] : Array.isArray(node) ? node : [];
  if (!Array.isArray(arr)) return [];
  if (!targetTag) return arr;
  return arr.filter((ch) => tagKey(ch) === targetTag);
}

function findFirst(node, targetTag) {
  return getChildren(node, targetTag)[0] || null;
}

function attr(node, name) {
  return node?.[':@']?.[`@_${name}`];
}

function collectOrderedText(node) {
  const k = tagKey(node);
  const children = k ? node[k] : Array.isArray(node) ? node : [];
  if (!Array.isArray(children)) return '';
  let out = '';
  for (const ch of children) {
    if (typeof ch?.['#text'] === 'string') {
      out += decodeBasicXmlEntities(ch['#text']);
    } else {
      out += collectOrderedText(ch);
    }
  }
  return out;
}

/**
 * Parses `word/styles.xml` into a fast lookup map by styleId.
 * @param {Record<string, Uint8Array>} files
 * @returns {Map<string, { fontSizePt?: number, bold?: boolean, italic?: boolean, color?: string, jc?: string, spaceBeforePt?: number, spaceAfterPt?: number }>}
 */
function parseDocxStyles(files) {
  /** @type {Map<string, any>} */
  const map = new Map();
  const parsed = readOoxmlXml(files, 'word/styles.xml', { preserveOrder: false });
  const rawStyles = parsed?.['w:styles']?.['w:style'];
  if (!rawStyles) return map;

  const list = Array.isArray(rawStyles) ? rawStyles : [rawStyles];
  for (const st of list) {
    const id = st?.['@_w:styleId'];
    if (!id) continue;
    const rPr = st['w:rPr'] || {};
    const pPr = st['w:pPr'] || {};
    const szHalfPt = Number(rPr?.['w:sz']?.['@_w:val']);
    const bold = rPr['w:b'] !== undefined && rPr['w:b']?.['@_w:val'] !== '0' && rPr['w:b']?.['@_w:val'] !== 'false';
    const italic = rPr['w:i'] !== undefined && rPr['w:i']?.['@_w:val'] !== '0' && rPr['w:i']?.['w:val'] !== 'false';
    const color = rPr?.['w:color']?.['@_w:val'];
    const jc = pPr?.['w:jc']?.['@_w:val'];
    const beforeTwips = Number(pPr?.['w:spacing']?.['@_w:before']);
    const afterTwips = Number(pPr?.['w:spacing']?.['@_w:after']);

    map.set(id, {
      fontSizePt: Number.isFinite(szHalfPt) && szHalfPt > 0 ? szHalfPt / 2 : undefined,
      bold,
      italic,
      color: color && color !== 'auto' ? `#${color}` : undefined,
      jc,
      spaceBeforePt: Number.isFinite(beforeTwips) ? beforeTwips / 20 : undefined,
      spaceAfterPt: Number.isFinite(afterTwips) ? afterTwips / 20 : undefined
    });
  }
  return map;
}

/**
 * Parses `word/numbering.xml` so `<w:numId>` resolves bullet vs. decimal lists accurately.
 * @param {Record<string, Uint8Array>} files
 * @returns {Map<string, 'bullet'|'ordered'>}
 */
function parseDocxNumbering(files) {
  /** @type {Map<string, 'bullet'|'ordered'>} */
  const numMap = new Map();
  const parsed = readOoxmlXml(files, 'word/numbering.xml', { preserveOrder: false });
  const root = parsed?.['w:numbering'];
  if (!root) return numMap;

  const abstractTypes = new Map();
  const absList = root['w:abstractNum']
    ? Array.isArray(root['w:abstractNum'])
      ? root['w:abstractNum']
      : [root['w:abstractNum']]
    : [];
  for (const abs of absList) {
    const absId = abs?.['@_w:abstractNumId'];
    const lvls = abs['w:lvl'] ? (Array.isArray(abs['w:lvl']) ? abs['w:lvl'] : [abs['w:lvl']]) : [];
    const firstFmt = lvls[0]?.['w:numFmt']?.['@_w:val'] || 'bullet';
    if (absId !== undefined) {
      abstractTypes.set(String(absId), firstFmt === 'bullet' ? 'bullet' : 'ordered');
    }
  }

  const nums = root['w:num'] ? (Array.isArray(root['w:num']) ? root['w:num'] : [root['w:num']]) : [];
  for (const n of nums) {
    const numId = n?.['@_w:numId'];
    const absRef = n?.['w:abstractNumId']?.['@_w:val'];
    if (numId !== undefined) {
      numMap.set(String(numId), abstractTypes.get(String(absRef)) || 'bullet');
    }
  }
  return numMap;
}

/**
 * Extracts inline text segments, breaks, and embedded drawing rIds from a `<w:p>` ordered node.
 */
function parseParagraphNode(pNode, stylesMap, numberingMap, warnings) {
  const pPr = findFirst(pNode, 'w:pPr');
  const styleId = attr(findFirst(pPr, 'w:pStyle'), 'w:val') || '';
  const namedStyle = stylesMap.get(styleId) || {};

  // Heading classification from styleId
  let headingLevel = 0;
  if (/^(Heading1|Title)$/i.test(styleId) || styleId === '1') headingLevel = 1;
  else if (/^(Heading2|Subtitle)$/i.test(styleId) || styleId === '2') headingLevel = 2;
  else if (/^Heading[3-6]$/i.test(styleId) || styleId === '3') headingLevel = 3;

  const jc = attr(findFirst(pPr, 'w:jc'), 'w:val') || namedStyle.jc || 'left';
  const spacingNode = findFirst(pPr, 'w:spacing');
  const beforeTwips = Number(attr(spacingNode, 'w:before'));
  const afterTwips = Number(attr(spacingNode, 'w:after'));
  const indNode = findFirst(pPr, 'w:ind');
  const leftTwips = Number(attr(indNode, 'w:left')) || 0;

  const numPr = findFirst(pPr, 'w:numPr');
  let listType = null;
  let numId = '';
  let ilvl = 0;
  if (numPr) {
    numId = String(attr(findFirst(numPr, 'w:numId'), 'w:val') || '1');
    ilvl = Number(attr(findFirst(numPr, 'w:ilvl'), 'w:val') || 0);
    listType = numberingMap.get(numId) || 'bullet';
  }

  let defaultSize = namedStyle.fontSizePt || 11;
  if (headingLevel === 1) defaultSize = Math.max(defaultSize, 20);
  else if (headingLevel === 2) defaultSize = Math.max(defaultSize, 15.5);
  else if (headingLevel === 3) defaultSize = Math.max(defaultSize, 13);

  /** @type {{ kind: 'text'|'break'|'pageBreak'|'image', text?: string, bold?: boolean, italic?: boolean, underline?: boolean, fontSize?: number, color?: string, rId?: string, widthPt?: number, heightPt?: number }[]} */
  const items = [];

  const walkRunContent = (rNode) => {
    const rPr = findFirst(rNode, 'w:rPr');
    const bNode = findFirst(rPr, 'w:b');
    const iNode = findFirst(rPr, 'w:i');
    const uNode = findFirst(rPr, 'w:u');
    const szVal = Number(attr(findFirst(rPr, 'w:sz'), 'w:val'));
    const colorVal = attr(findFirst(rPr, 'w:color'), 'w:val');

    const bold = bNode
      ? attr(bNode, 'w:val') !== '0' && attr(bNode, 'w:val') !== 'false'
      : Boolean(namedStyle.bold || headingLevel > 0);
    const italic = iNode
      ? attr(iNode, 'w:val') !== '0' && attr(iNode, 'w:val') !== 'false'
      : Boolean(namedStyle.italic);
    const underline = Boolean(uNode && attr(uNode, 'w:val') !== 'none');
    const fontSize = Number.isFinite(szVal) && szVal > 0 ? szVal / 2 : defaultSize;
    const color =
      colorVal && colorVal !== 'auto'
        ? `#${colorVal}`
        : namedStyle.color || '#1d1d1f';

    const rChildren = getChildren(rNode);
    for (const ch of rChildren) {
      const k = tagKey(ch);
      if (k === 'w:t') {
        const text = collectOrderedText(ch);
        if (text) items.push({ kind: 'text', text, bold, italic, underline, fontSize, color });
      } else if (k === 'w:tab') {
        items.push({ kind: 'text', text: '    ', bold, italic, underline: false, fontSize, color });
      } else if (k === 'w:br') {
        const brType = attr(ch, 'w:type');
        items.push({ kind: brType === 'page' ? 'pageBreak' : 'break' });
      } else if (k === 'w:drawing' || k === 'w:pict') {
        // Locate <a:blip r:embed="..."> and <wp:extent cx cy>
        const stack = [ch];
        let rId = '';
        let widthPt = 0;
        let heightPt = 0;
        while (stack.length > 0) {
          const cur = stack.pop();
          const ck = tagKey(cur);
          if (ck === 'a:blip') {
            rId = attr(cur, 'r:embed') || rId;
          } else if (ck === 'wp:extent' || ck === 'a:ext') {
            const cx = Number(attr(cur, 'cx'));
            const cy = Number(attr(cur, 'cy'));
            if (cx > 0 && cy > 0 && widthPt === 0) {
              widthPt = cx / EMU_PER_PT;
              heightPt = cy / EMU_PER_PT;
            }
          } else if (ck === 'w:chart' || ck === 'c:chart') {
            warnings.push('Embedded Office charts were simplified during local conversion.');
          }
          for (const sub of getChildren(cur)) stack.push(sub);
        }
        if (rId) {
          items.push({ kind: 'image', rId, widthPt, heightPt });
        }
      }
    }
  };

  for (const ch of getChildren(pNode)) {
    const k = tagKey(ch);
    if (k === 'w:r') {
      walkRunContent(ch);
    } else if (k === 'w:hyperlink') {
      for (const hr of getChildren(ch, 'w:r')) {
        walkRunContent(hr);
      }
    }
  }

  return {
    type: /** @type {const} */ ('paragraph'),
    headingLevel,
    jc,
    indentPt: Math.max(0, leftTwips / 20) + (listType ? (ilvl + 1) * 16 : 0),
    listType,
    numId,
    fontSize: defaultSize,
    spaceBeforePt: Number.isFinite(beforeTwips)
      ? beforeTwips / 20
      : namedStyle.spaceBeforePt ?? (headingLevel > 0 ? 12 : 0),
    spaceAfterPt: Number.isFinite(afterTwips)
      ? afterTwips / 20
      : namedStyle.spaceAfterPt ?? (headingLevel > 0 ? 6 : 6),
    items
  };
}

/**
 * Parses a `<w:tbl>` node into structured rows and column proportions.
 */
function parseTableNode(tblNode, stylesMap, numberingMap, warnings) {
  const tblGrid = findFirst(tblNode, 'w:tblGrid');
  const gridCols = tblGrid ? getChildren(tblGrid, 'w:gridCol') : [];
  const colTwips = gridCols.map((gc) => Math.max(360, Number(attr(gc, 'w:w')) || 1440));

  const rows = getChildren(tblNode, 'w:tr').map((trNode) => {
    const cells = getChildren(trNode, 'w:tc').map((tcNode) => {
      const tcPr = findFirst(tcNode, 'w:tcPr');
      const gridSpan = Math.max(1, Number(attr(findFirst(tcPr, 'w:gridSpan'), 'w:val')) || 1);
      const paras = getChildren(tcNode, 'w:p').map((p) =>
        parseParagraphNode(p, stylesMap, numberingMap, warnings)
      );
      return { gridSpan, paragraphs: paras };
    });
    return { cells };
  });

  return {
    type: /** @type {const} */ ('table'),
    colTwips,
    rows
  };
}

/**
 * Converts a `.docx` file buffer locally into a paginated vector PDF using
 * `fflate`, `fast-xml-parser` (`processEntities: false`), `pdf-lib`, and `@pdf-lib/fontkit`.
 *
 * @param {ArrayBuffer|Uint8Array} docxBuffer
 * @param {Object} [config={}]
 * @param {'a4'|'letter'} [config.paperSize='a4']
 * @param {'normal'|'compact'} [config.margins='normal']
 * @param {string} [fileName='document.docx']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: 'application/pdf', warnings: string[], pageCount: number }>}
 */
export async function convertDocxToPdf(docxBuffer, config = {}, fileName = 'document.docx', options = {}) {
  const { paperSize = 'a4', margins = 'normal' } = config;
  const { onProgress, abortToken } = options;

  onProgress?.(5, 'Unpacking DOCX archive...');
  const files = safeUnzipOoxml(docxBuffer);
  assertNotAborted(abortToken);

  const docOrdered = readOoxmlXml(files, 'word/document.xml', { preserveOrder: true });
  if (!docOrdered) {
    throw new Error('Missing word/document.xml inside DOCX archive.');
  }

  onProgress?.(20, 'Parsing document styles & layout...');
  const stylesMap = parseDocxStyles(files);
  const numberingMap = parseDocxNumbering(files);
  const relsMap = parseRelsMap(files, 'word/_rels/document.xml.rels');

  /** @type {string[]} */
  const warningsSet = new Set();
  const warningsProxy = { push: (msg) => warningsSet.add(msg) };

  const rootDoc = Array.isArray(docOrdered)
    ? docOrdered.find((n) => tagKey(n) === 'w:document')
    : docOrdered;
  const bodyNode = findFirst(rootDoc, 'w:body');
  if (!bodyNode) {
    throw new Error('Invalid Word document structure (missing w:body).');
  }

  const blocks = [];
  for (const child of getChildren(bodyNode)) {
    const k = tagKey(child);
    if (k === 'w:p') {
      blocks.push(parseParagraphNode(child, stylesMap, numberingMap, warningsProxy));
    } else if (k === 'w:tbl') {
      blocks.push(parseTableNode(child, stylesMap, numberingMap, warningsProxy));
    }
  }

  assertNotAborted(abortToken);
  onProgress?.(40, 'Rendering vector PDF pages...');

  const pageWidth = paperSize === 'letter' ? 612 : 595.28;
  const pageHeight = paperSize === 'letter' ? 792 : 841.89;
  const marginPt = margins === 'compact' ? 34 : 56;
  const contentWidth = pageWidth - marginPt * 2;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('Poffy Offline PDF Studio');
  const { resolveFont } = createVectorFontManager(pdfDoc);
  const embeddedImages = new Map();

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let cursorY = pageHeight - marginPt;
  const bottomLimit = marginPt;

  const newPage = () => {
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    cursorY = pageHeight - marginPt;
  };

  /** @type {Map<string, number>} */
  const listCounters = new Map();

  const renderParagraph = async (para, boxLeft = marginPt, boxWidth = contentWidth) => {
    // Handle explicit page breaks or empty spacer paragraphs
    const effectiveLeft = Math.min(boxLeft + boxWidth - 40, boxLeft + para.indentPt);
    const maxLineW = Math.max(36, boxLeft + boxWidth - effectiveLeft);

    cursorY -= para.spaceBeforePt;
    if (cursorY < bottomLimit + para.fontSize * 1.4) {
      newPage();
    }

    // List marker prefix
    let markerPrefix = '';
    if (para.listType === 'bullet') {
      markerPrefix = '• ';
    } else if (para.listType === 'ordered') {
      const nextNum = (listCounters.get(para.numId) || 0) + 1;
      listCounters.set(para.numId, nextNum);
      markerPrefix = `${nextNum}. `;
    }

    // Break paragraph items into logical lines of styled tokens
    /** @type {{ tokens: { text: string, bold: boolean, italic: boolean, underline: boolean, fontSize: number, color: string, font: any, width: number }[] }[]} */
    const visualLines = [];
    let currentLineTokens = [];
    let currentLineWidth = 0;

    const flushLine = () => {
      visualLines.push({ tokens: currentLineTokens });
      currentLineTokens = [];
      currentLineWidth = 0;
    };

    const pushWordToken = async (word, style) => {
      const font = await resolveFont(word, { bold: style.bold, italic: style.italic });
      const w = font.widthOfTextAtSize(word, style.fontSize);
      if (currentLineTokens.length > 0 && currentLineWidth + w > maxLineW) {
        flushLine();
        if (word.trim() === '') return;
      }
      currentLineTokens.push({
        text: word,
        bold: style.bold,
        italic: style.italic,
        underline: style.underline,
        fontSize: style.fontSize,
        color: style.color,
        font,
        width: w
      });
      currentLineWidth += w;
    };

    let markerInjected = false;
    for (const item of para.items) {
      if (item.kind === 'pageBreak') {
        if (currentLineTokens.length > 0) flushLine();
        newPage();
        continue;
      }
      if (item.kind === 'break') {
        flushLine();
        continue;
      }
      if (item.kind === 'image') {
        if (currentLineTokens.length > 0) flushLine();
        const rel = relsMap.get(item.rId || '');
        if (rel && rel.targetMode !== 'External') {
          const mediaPath = resolveOoxmlTargetPath('word', rel.target);
          let imgObj = embeddedImages.get(mediaPath);
          if (imgObj === undefined) {
            imgObj = await embedRasterImageSafe(pdfDoc, files[mediaPath]);
            embeddedImages.set(mediaPath, imgObj);
          }
          if (imgObj) {
            let drawW = item.widthPt || imgObj.width;
            let drawH = item.heightPt || imgObj.height;
            const scale = Math.min(1, maxLineW / Math.max(1, drawW), (pageHeight - marginPt * 2) / Math.max(1, drawH));
            drawW *= scale;
            drawH *= scale;
            if (cursorY - drawH < bottomLimit) newPage();
            page.drawImage(imgObj, {
              x: effectiveLeft,
              y: cursorY - drawH,
              width: drawW,
              height: drawH
            });
            cursorY -= drawH + 8;
          } else {
            warningsSet.add('Non-PNG/JPEG images (such as EMF/WMF/SVG) were omitted.');
          }
        }
        continue;
      }

      if (item.kind === 'text' && item.text) {
        let text = item.text;
        if (markerPrefix && !markerInjected) {
          // Draw list marker outside wrap box
          markerInjected = true;
          const mFont = await resolveFont(markerPrefix, { bold: false });
          const mW = mFont.widthOfTextAtSize(markerPrefix, item.fontSize || para.fontSize);
          if (cursorY < bottomLimit + (item.fontSize || para.fontSize) * 1.4) newPage();
          page.drawText(markerPrefix, {
            x: Math.max(boxLeft, effectiveLeft - mW - 2),
            y: cursorY - (item.fontSize || para.fontSize),
            size: item.fontSize || para.fontSize,
            font: mFont,
            color: parseHexColor('#1d1d1f')
          });
        }

        // Split into alternating words and whitespace preserving inline styling
        const parts = text.split(/(\s+)/);
        for (const part of parts) {
          if (!part) continue;
          await pushWordToken(part, {
            bold: Boolean(item.bold),
            italic: Boolean(item.italic),
            underline: Boolean(item.underline),
            fontSize: item.fontSize || para.fontSize,
            color: item.color || '#1d1d1f'
          });
        }
      }
    }

    if (currentLineTokens.length > 0) flushLine();
    if (visualLines.length === 0 && para.items.length === 0) {
      cursorY -= para.fontSize * 0.7;
      return;
    }

    for (const line of visualLines) {
      // Trim trailing whitespace tokens for alignment math
      while (line.tokens.length > 0 && line.tokens[line.tokens.length - 1].text.trim() === '') {
        line.tokens.pop();
      }
      const lineFontSize = line.tokens.reduce((m, t) => Math.max(m, t.fontSize), para.fontSize);
      const lineHeight = lineFontSize * 1.38;

      if (cursorY - lineHeight < bottomLimit) {
        newPage();
      }

      const totalW = line.tokens.reduce((s, t) => s + t.width, 0);
      let drawX = effectiveLeft;
      if (para.jc === 'center') {
        drawX = effectiveLeft + Math.max(0, (maxLineW - totalW) / 2);
      } else if (para.jc === 'right') {
        drawX = effectiveLeft + Math.max(0, maxLineW - totalW);
      }

      const baselineY = cursorY - lineFontSize;
      for (const tok of line.tokens) {
        if (tok.text) {
          page.drawText(tok.text, {
            x: drawX,
            y: baselineY,
            size: tok.fontSize,
            font: tok.font,
            color: parseHexColor(tok.color)
          });
          if (tok.underline) {
            page.drawLine({
              start: { x: drawX, y: baselineY - 1.5 },
              end: { x: drawX + tok.width, y: baselineY - 1.5 },
              thickness: Math.max(0.6, tok.fontSize * 0.06),
              color: parseHexColor(tok.color)
            });
          }
        }
        drawX += tok.width;
      }

      cursorY -= lineHeight;
    }

    cursorY -= para.spaceAfterPt;
  };

  for (let bIdx = 0; bIdx < blocks.length; bIdx += 1) {
    assertNotAborted(abortToken);
    const blk = blocks[bIdx];

    if (blk.type === 'paragraph') {
      if (!blk.listType) listCounters.clear();
      await renderParagraph(blk);
    } else if (blk.type === 'table') {
      listCounters.clear();
      const totalGridCols = Math.max(
        1,
        blk.colTwips.length || (blk.rows[0]?.cells.reduce((s, c) => s + c.gridSpan, 0) || 1)
      );
      const rawWeights =
        blk.colTwips.length === totalGridCols
          ? blk.colTwips
          : new Array(totalGridCols).fill(1);
      const sumWeight = rawWeights.reduce((a, b) => a + b, 0);
      const colWidths = rawWeights.map((w) => (w / sumWeight) * contentWidth);

      for (let rIdx = 0; rIdx < blk.rows.length; rIdx += 1) {
        assertNotAborted(abortToken);
        const row = blk.rows[rIdx];
        const cellPadX = 6;
        const cellPadY = 5;

        // Measure cell text height per cell using plain text summary for row height calculation
        const cellBlocks = [];
        let colCursor = 0;
        let maxRowHeight = 20;

        for (const cell of row.cells) {
          let cellW = 0;
          for (let s = 0; s < cell.gridSpan && colCursor + s < colWidths.length; s += 1) {
            cellW += colWidths[colCursor + s];
          }
          if (cellW <= 0) cellW = contentWidth / totalGridCols;

          let estLines = 0;
          for (const p of cell.paragraphs) {
            const pText = p.items.filter((i) => i.kind === 'text').map((i) => i.text).join('');
            const font = await resolveFont(pText, { bold: rIdx === 0 });
            const usableW = Math.max(18, cellW - cellPadX * 2);
            const approxW = font.widthOfTextAtSize(pText || ' ', 10);
            estLines += Math.max(1, Math.ceil(approxW / usableW));
          }
          maxRowHeight = Math.max(maxRowHeight, estLines * 14 + cellPadY * 2);
          cellBlocks.push({ cell, colStart: colCursor, cellW });
          colCursor += cell.gridSpan;
        }

        if (cursorY - maxRowHeight < bottomLimit) {
          newPage();
        }

        const rowTop = cursorY;
        const rowBottom = rowTop - maxRowHeight;

        // Draw cells
        let xOff = marginPt;
        for (const cb of cellBlocks) {
          page.drawRectangle({
            x: xOff,
            y: rowBottom,
            width: cb.cellW,
            height: maxRowHeight,
            color: rIdx === 0 ? rgb(0.96, 0.96, 0.97) : rgb(1, 1, 1),
            borderColor: rgb(0.82, 0.82, 0.84),
            borderWidth: 0.6
          });

          // Render cell paragraphs inside cell bounds without mutating main cursorY
          const savedPage = page;
          const savedCursor = cursorY;
          cursorY = rowTop - cellPadY;
          for (const p of cb.cell.paragraphs) {
            const cellPara = {
              ...p,
              fontSize: Math.min(10.5, p.fontSize || 10),
              spaceBeforePt: 0,
              spaceAfterPt: 2,
              items: p.items.map((it) =>
                it.kind === 'text'
                  ? { ...it, fontSize: Math.min(10.5, it.fontSize || 10), bold: it.bold || rIdx === 0 }
                  : it
              )
            };
            await renderParagraph(cellPara, xOff + cellPadX, Math.max(20, cb.cellW - cellPadX * 2));
            if (page !== savedPage) {
              // Keep cell rendering bounded to single row page
              page = savedPage;
              break;
            }
          }
          cursorY = savedCursor;
          xOff += cb.cellW;
        }

        cursorY = rowBottom;
      }
      cursorY -= 8;
    }

    if (bIdx % 8 === 0) {
      onProgress?.(
        Math.round(40 + ((bIdx + 1) / Math.max(1, blocks.length)) * 50),
        `Laying out document (${bIdx + 1}/${blocks.length})...`
      );
      await yieldToLoop();
    }
  }

  onProgress?.(94, 'Serializing PDF file...');
  const pdfBytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  const buffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
  const stem = (fileName || 'document').replace(/\.docx$/i, '') || 'document';
  onProgress?.(100, 'Word to PDF complete.', pdfDoc.getPageCount(), pdfDoc.getPageCount());

  return {
    buffer,
    fileName: `${stem}.pdf`,
    mimeType: 'application/pdf',
    warnings: [...warningsSet],
    pageCount: pdfDoc.getPageCount()
  };
}
