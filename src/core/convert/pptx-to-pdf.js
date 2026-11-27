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
  parseHexColor,
  wrapTextToWidth
} from './pdf-vector-utils.js';

const EMU_PER_PT = 12700;

const asArray = (val) => (!val ? [] : Array.isArray(val) ? val : [val]);

/**
 * Resolves a solid sRGB hex color from an OOXML `a:solidFill` node if available.
 * @param {any} fillNode
 * @returns {string|null}
 */
function extractSolidHex(fillNode) {
  const srgb = fillNode?.['a:srgbClr']?.['@_val'];
  if (srgb) return `#${srgb}`;
  return null;
}

/**
 * Reads slide ordering cleanly from `ppt/presentation.xml` + `ppt/_rels/presentation.xml.rels`,
 * falling back to naturally sorted `ppt/slides/slideN.xml` entries.
 */
function resolveOrderedSlidePaths(files, presParsed) {
  const relsMap = parseRelsMap(files, 'ppt/_rels/presentation.xml.rels');
  const sldIds = asArray(presParsed?.['p:presentation']?.['p:sldIdLst']?.['p:sldId']);
  /** @type {string[]} */
  const ordered = [];

  for (const item of sldIds) {
    const rId = item?.['@_r:id'];
    const rel = rId ? relsMap.get(rId) : null;
    if (rel && rel.target) {
      const targetPath = resolveOoxmlTargetPath('ppt', rel.target);
      if (files[targetPath]) ordered.push(targetPath);
    }
  }

  if (ordered.length > 0) return ordered;

  return Object.keys(files)
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Extracts EMU bounding box `(x, y, cx, cy)` from a shape or picture `xfrm` node.
 */
function extractXfrmPoints(xfrm, offsetXPt = 0, offsetYPt = 0) {
  const off = xfrm?.['a:off'] || {};
  const ext = xfrm?.['a:ext'] || {};
  const x = (Number(off['@_x']) || 0) / EMU_PER_PT + offsetXPt;
  const y = (Number(off['@_y']) || 0) / EMU_PER_PT + offsetYPt;
  const w = Math.max(0, (Number(ext['@_cx']) || 0) / EMU_PER_PT);
  const h = Math.max(0, (Number(ext['@_cy']) || 0) / EMU_PER_PT);
  return { x, y, w, h };
}

/**
 * Collects paragraphs from an OOXML `p:txBody` node cleanly.
 */
function extractSlideParagraphs(txBody) {
  const paras = asArray(txBody?.['a:p']);
  return paras.map((p) => {
    const pPr = p?.['a:pPr'] || {};
    const algn = pPr?.['@_algn'] || 'l';
    const hasBullet = pPr?.['a:buNone'] === undefined && (pPr?.['a:buChar'] !== undefined || pPr?.['a:buAutoNum'] !== undefined);
    const buChar = pPr?.['a:buChar']?.['@_char'] || (pPr?.['a:buAutoNum'] ? '1.' : '•');
    const runs = asArray(p?.['a:r']).map((r) => {
      const rPr = r?.['a:rPr'] || {};
      const rawText = typeof r?.['a:t'] === 'string' ? r['a:t'] : r?.['a:t']?.['#text'] ?? '';
      const text = decodeBasicXmlEntities(String(rawText || ''));
      const sz = Number(rPr?.['@_sz']);
      const fontSize = Number.isFinite(sz) && sz > 0 ? sz / 100 : 18;
      const bold = rPr?.['@_b'] === '1' || rPr?.['@_b'] === 'true';
      const italic = rPr?.['@_i'] === '1' || rPr?.['@_i'] === 'true';
      const color = extractSolidHex(rPr?.['a:solidFill']) || '#1d1d1f';
      return { text, fontSize, bold, italic, color };
    });
    return { algn, hasBullet, buChar, runs };
  });
}

/**
 * Converts a `.pptx` presentation buffer into a slide-matched vector PDF inside `pdf-ops.worker.js`
 * using `fflate`, `fast-xml-parser` (`processEntities: false`), `pdf-lib`, and `@pdf-lib/fontkit`.
 *
 * @param {ArrayBuffer|Uint8Array} pptxBuffer
 * @param {Object} [config={}]
 * @param {string} [fileName='presentation.pptx']
 * @param {{ onProgress?: Function, abortToken?: { aborted?: boolean } }} [options={}]
 * @returns {Promise<{ buffer: ArrayBuffer, fileName: string, mimeType: 'application/pdf', warnings: string[], slideCount: number }>}
 */
export async function convertPptxToPdf(pptxBuffer, config = {}, fileName = 'presentation.pptx', options = {}) {
  const { onProgress, abortToken } = options;

  onProgress?.(5, 'Unpacking PPTX archive...');
  const files = safeUnzipOoxml(pptxBuffer);
  assertNotAborted(abortToken);

  const presParsed = readOoxmlXml(files, 'ppt/presentation.xml', { preserveOrder: false });
  if (!presParsed?.['p:presentation']) {
    throw new Error('Missing ppt/presentation.xml inside PPTX archive.');
  }

  const sldSz = presParsed['p:presentation']['p:sldSz'] || {};
  const slideWidthPt = Math.max(144, (Number(sldSz['@_cx']) || 12192000) / EMU_PER_PT); // Default 960pt (13.33in 16:9)
  const slideHeightPt = Math.max(144, (Number(sldSz['@_cy']) || 6858000) / EMU_PER_PT); // Default 540pt (7.5in)

  const slidePaths = resolveOrderedSlidePaths(files, presParsed);
  if (slidePaths.length === 0) {
    throw new Error('No slides found inside PPTX archive.');
  }

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreator('Poffy Offline PDF Studio');
  const { resolveFont } = createVectorFontManager(pdfDoc);
  const embeddedImages = new Map();
  /** @type {Set<string>} */
  const warnings = new Set();

  for (let i = 0; i < slidePaths.length; i += 1) {
    assertNotAborted(abortToken);
    const slidePath = slidePaths[i];
    const slideParsed = readOoxmlXml(files, slidePath, { preserveOrder: false });
    const slideRoot = slideParsed?.['p:sld'];
    const slideName = slidePath.split('/').pop();
    const relsMap = parseRelsMap(files, `ppt/slides/_rels/${slideName}.rels`);

    const page = pdfDoc.addPage([slideWidthPt, slideHeightPt]);

    // Slide background color
    const bgHex =
      extractSolidHex(slideRoot?.['p:cSld']?.['p:bg']?.['p:bgPr']?.['a:solidFill']) || '#ffffff';
    page.drawRectangle({
      x: 0,
      y: 0,
      width: slideWidthPt,
      height: slideHeightPt,
      color: parseHexColor(bgHex)
    });

    const spTree = slideRoot?.['p:cSld']?.['p:spTree'];

    const renderShapeTree = async (tree, offsetX = 0, offsetY = 0) => {
      if (!tree) return;

      for (const gf of asArray(tree['p:graphicFrame'])) {
        const tbl = gf?.['a:graphic']?.['a:graphicData']?.['a:tbl'];
        if (!tbl) {
          warnings.add('Embedded charts or SmartArt frames were omitted during local conversion.');
          continue;
        }
        const gfXfrm = gf?.['p:xfrm'];
        const tBox = gfXfrm ? extractXfrmPoints(gfXfrm, offsetX, offsetY) : { x: 40, y: 200, w: slideWidthPt - 80, h: 160 };
        const gridCols = asArray(tbl['a:tblGrid']?.['a:gridCol']);
        const rawCols = gridCols.map((c) => Math.max(24, (Number(c?.['@_w']) || 1270000) / EMU_PER_PT));
        const colSum = rawCols.reduce((a, b) => a + b, 0) || 1;
        const colWidths = rawCols.length > 0 ? rawCols.map((w) => (w / colSum) * tBox.w) : [tBox.w];

        let curTop = tBox.y;
        const rows = asArray(tbl['a:tr']);
        for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
          const row = rows[rIdx];
          const rowH = Math.max(18, (Number(row?.['@_h']) || 320000) / EMU_PER_PT);
          let cx = tBox.x;
          const cells = asArray(row?.['a:tc']);
          for (let cIdx = 0; cIdx < cells.length; cIdx += 1) {
            const cw = colWidths[cIdx] || colWidths[colWidths.length - 1] || 80;
            const cellParas = extractSlideParagraphs(cells[cIdx]?.['a:txBody']);
            const cellText = cellParas.map((p) => p.runs.map((r) => r.text).join('')).join(' ').trim();
            page.drawRectangle({
              x: cx,
              y: slideHeightPt - curTop - rowH,
              width: cw,
              height: rowH,
              color: rIdx === 0 ? rgb(0.95, 0.95, 0.97) : rgb(1, 1, 1),
              borderColor: rgb(0.82, 0.82, 0.84),
              borderWidth: 0.5
            });
            if (cellText) {
              const cFont = await resolveFont(cellText, { bold: rIdx === 0 });
              const cSize = Math.min(11, Math.max(8, rowH * 0.45));
              const lines = wrapTextToWidth(cellText, cFont, cSize, Math.max(12, cw - 8));
              if (lines[0]) {
                page.drawText(lines[0], {
                  x: cx + 4,
                  y: slideHeightPt - curTop - rowH / 2 - cSize * 0.35,
                  size: cSize,
                  font: cFont,
                  color: parseHexColor('#1d1d1f')
                });
              }
            }
            cx += cw;
          }
          curTop += rowH;
        }
      }

      // 1. Render Pictures (p:pic)
      for (const pic of asArray(tree['p:pic'])) {
        const xfrm = pic?.['p:spPr']?.['a:xfrm'];
        if (!xfrm) continue;
        const box = extractXfrmPoints(xfrm, offsetX, offsetY);
        if (box.w <= 0 || box.h <= 0) continue;

        const rId = pic?.['p:blipFill']?.['a:blip']?.['@_r:embed'];
        const rel = rId ? relsMap.get(rId) : null;
        if (rel && rel.targetMode !== 'External') {
          const mediaPath = resolveOoxmlTargetPath('ppt/slides', rel.target);
          let imgObj = embeddedImages.get(mediaPath);
          if (imgObj === undefined) {
            imgObj = await embedRasterImageSafe(pdfDoc, files[mediaPath]);
            embeddedImages.set(mediaPath, imgObj);
          }
          if (imgObj) {
            page.drawImage(imgObj, {
              x: box.x,
              y: slideHeightPt - box.y - box.h,
              width: box.w,
              height: box.h
            });
          } else {
            warnings.add('Unsupported vector images (EMF/WMF/SVG) on slides were omitted.');
          }
        }
      }

      // 2. Render Shapes & Text Frames (p:sp)
      for (const sp of asArray(tree['p:sp'])) {
        const spPr = sp?.['p:spPr'] || {};
        const xfrm = spPr['a:xfrm'];
        const box = xfrm ? extractXfrmPoints(xfrm, offsetX, offsetY) : { x: 40, y: 40, w: slideWidthPt - 80, h: slideHeightPt - 80 };

        const fillHex = extractSolidHex(spPr['a:solidFill']);
        if (fillHex && box.w > 0 && box.h > 0) {
          page.drawRectangle({
            x: box.x,
            y: slideHeightPt - box.y - box.h,
            width: box.w,
            height: box.h,
            color: parseHexColor(fillHex)
          });
        }

        const txBody = sp?.['p:txBody'];
        if (!txBody) continue;
        const bodyPr = txBody['a:bodyPr'] || {};
        const lIns = Number(bodyPr['@_lIns']) ? Number(bodyPr['@_lIns']) / EMU_PER_PT : 6;
        const rIns = Number(bodyPr['@_rIns']) ? Number(bodyPr['@_rIns']) / EMU_PER_PT : 6;
        const tIns = Number(bodyPr['@_tIns']) ? Number(bodyPr['@_tIns']) / EMU_PER_PT : 4;
        const usableW = Math.max(24, box.w - lIns - rIns);

        const paragraphs = extractSlideParagraphs(txBody);
        let cursorTopPt = box.y + tIns;

        for (const para of paragraphs) {
          const fullText = para.runs.map((r) => r.text).join('');
          if (!fullText.trim()) {
            cursorTopPt += 10;
            continue;
          }

          const firstRun = para.runs[0] || { fontSize: 18, bold: false, italic: false, color: '#1d1d1f' };
          const fontSize = firstRun.fontSize || 18;
          const lineH = fontSize * 1.28;
          const prefix = para.hasBullet ? `${para.buChar} ` : '';
          const displayText = prefix + fullText;

          const font = await resolveFont(displayText, {
            bold: firstRun.bold,
            italic: firstRun.italic
          });
          const wrappedLines = wrapTextToWidth(displayText, font, fontSize, usableW);

          for (const ln of wrappedLines) {
            if (cursorTopPt + lineH > box.y + box.h + 12) break;
            const lw = font.widthOfTextAtSize(ln, fontSize);
            let drawX = box.x + lIns;
            if (para.algn === 'ctr') drawX = box.x + lIns + Math.max(0, (usableW - lw) / 2);
            else if (para.algn === 'r') drawX = box.x + lIns + Math.max(0, usableW - lw);

            page.drawText(ln, {
              x: drawX,
              y: slideHeightPt - cursorTopPt - fontSize,
              size: fontSize,
              font,
              color: parseHexColor(firstRun.color)
            });
            cursorTopPt += lineH;
          }
          cursorTopPt += Math.max(3, fontSize * 0.22);
        }
      }

      // 3. Recurse into Grouped Shapes (p:grpSp)
      for (const grp of asArray(tree['p:grpSp'])) {
        const gx = grp?.['p:grpSpPr']?.['a:xfrm'];
        const gBox = gx ? extractXfrmPoints(gx, offsetX, offsetY) : { x: offsetX, y: offsetY };
        await renderShapeTree(grp, gBox.x - offsetX, gBox.y - offsetY);
      }
    };

    await renderShapeTree(spTree, 0, 0);

    onProgress?.(
      Math.round(15 + ((i + 1) / slidePaths.length) * 75),
      `Converting slide ${i + 1} of ${slidePaths.length}...`,
      i + 1,
      slidePaths.length
    );
    await yieldToLoop();
  }

  onProgress?.(94, 'Serializing PDF presentation...');
  const pdfBytes = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
  const buffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
  const stem = (fileName || 'presentation').replace(/\.pptx$/i, '') || 'presentation';
  onProgress?.(100, 'PowerPoint to PDF complete.', slidePaths.length, slidePaths.length);

  return {
    buffer,
    fileName: `${stem}.pdf`,
    mimeType: 'application/pdf',
    warnings: [...warnings],
    slideCount: slidePaths.length
  };
}
