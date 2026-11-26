import { PDFArray, PDFHexString, PDFName, PDFNull, PDFNumber } from 'pdf-lib';
import {
  destroyPdfJsDoc,
  loadPdfJsInWorker
} from '../render/pdfjs-worker-runtime.js';
import { loadPdfSafe } from './doc-loader.js';

/**
 * @typedef {Object} BookmarkNode
 * @property {string} id
 * @property {string} title
 * @property {number} pageIndex - 0-based target page index
 * @property {BookmarkNode[]} children
 */

/**
 * Reads existing document bookmarks/outlines via `pdfjs-dist` `getOutline()` and resolves
 * each destination into a normalized nested tree with 0-based page indices.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {string} [fileName='']
 * @returns {Promise<{ tree: BookmarkNode[], pageCount: number }>}
 */
export async function readOutlinesFromPdf(pdfBytes, fileName = '') {
  const pdfjsDoc = await loadPdfJsInWorker(pdfBytes, fileName);
  try {
    const pageCount = pdfjsDoc.numPages;
    const rawOutline = await pdfjsDoc.getOutline();
    if (!Array.isArray(rawOutline) || rawOutline.length === 0) {
      return { tree: [], pageCount };
    }

    let counter = 0;
    const resolvePageIdx = async (dest) => {
      try {
        let explicit = dest;
        if (typeof dest === 'string') {
          explicit = await pdfjsDoc.getDestination(dest);
        }
        if (Array.isArray(explicit) && explicit[0]) {
          if (typeof explicit[0] === 'number') {
            return Math.max(0, Math.min(pageCount - 1, explicit[0]));
          }
          const idx = await pdfjsDoc.getPageIndex(explicit[0]);
          return Math.max(0, Math.min(pageCount - 1, idx));
        }
      } catch {
        // Fallback to page 1 if destination ref is malformed
      }
      return 0;
    };

    const convertLevel = async (items) => {
      /** @type {BookmarkNode[]} */
      const out = [];
      for (const item of items) {
        counter += 1;
        const pageIndex = await resolvePageIdx(item.dest);
        const children =
          Array.isArray(item.items) && item.items.length > 0
            ? await convertLevel(item.items)
            : [];
        out.push({
          id: `bm_${counter}_${Date.now().toString(36)}`,
          title: String(item.title || 'Untitled').trim() || 'Untitled',
          pageIndex,
          children
        });
      }
      return out;
    };

    const tree = await convertLevel(rawOutline);
    return { tree, pageCount };
  } finally {
    await destroyPdfJsDoc(pdfjsDoc);
  }
}

/**
 * Shared low-level `pdf-lib` PDF Outlines (Bookmarks) serializer.
 * Constructs the full `/Outlines` linked tree with `/First`, `/Last`, `/Prev`, `/Next`, `/Parent`,
 * `/Count`, `/Dest`, and UTF-16BE `PDFHexString.fromText()` `/Title` for complete Unicode/CJK safety.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @param {BookmarkNode[]} tree
 * @returns {import('pdf-lib').PDFDocument}
 */
export function writeOutlines(pdfDoc, tree = []) {
  const outlinesKey = PDFName.of('Outlines');
  if (!Array.isArray(tree) || tree.length === 0) {
    pdfDoc.catalog.delete(outlinesKey);
    return pdfDoc;
  }

  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    pdfDoc.catalog.delete(outlinesKey);
    return pdfDoc;
  }

  const context = pdfDoc.context;
  const rootDict = context.obj({
    Type: PDFName.of('Outlines')
  });
  const rootRef = context.register(rootDict);

  /**
   * Builds one level of sibling outline nodes recursively, returning `[firstRef, lastRef, totalCount]`.
   * @param {BookmarkNode[]} nodes
   * @param {import('pdf-lib').PDFRef} parentRef
   */
  const buildLevel = (nodes, parentRef) => {
    const valid = nodes.filter((n) => n && String(n.title || '').trim().length > 0);
    if (valid.length === 0) return null;

    const prepared = valid.map((node) => {
      const safePageIdx = Math.max(
        0,
        Math.min(pages.length - 1, Math.floor(Number(node.pageIndex) || 0))
      );
      const destArr = PDFArray.withContext(context);
      destArr.push(pages[safePageIdx].ref);
      destArr.push(PDFName.of('XYZ'));
      destArr.push(PDFNull);
      destArr.push(PDFNull);
      destArr.push(PDFNull);

      const dict = context.obj({
        Title: PDFHexString.fromText(String(node.title).trim()),
        Parent: parentRef,
        Dest: destArr
      });
      const ref = context.register(dict);
      return { node, dict, ref };
    });

    let totalVisibleInSubtree = prepared.length;

    for (let i = 0; i < prepared.length; i += 1) {
      const cur = prepared[i];
      if (i > 0) cur.dict.set(PDFName.of('Prev'), prepared[i - 1].ref);
      if (i < prepared.length - 1) cur.dict.set(PDFName.of('Next'), prepared[i + 1].ref);

      if (Array.isArray(cur.node.children) && cur.node.children.length > 0) {
        const childRes = buildLevel(cur.node.children, cur.ref);
        if (childRes) {
          cur.dict.set(PDFName.of('First'), childRes.firstRef);
          cur.dict.set(PDFName.of('Last'), childRes.lastRef);
          cur.dict.set(PDFName.of('Count'), PDFNumber.of(childRes.totalVisible));
          totalVisibleInSubtree += childRes.totalVisible;
        }
      }
    }

    return {
      firstRef: prepared[0].ref,
      lastRef: prepared[prepared.length - 1].ref,
      totalVisible: totalVisibleInSubtree
    };
  };

  const topRes = buildLevel(tree, rootRef);
  if (!topRes) {
    pdfDoc.catalog.delete(outlinesKey);
    return pdfDoc;
  }

  rootDict.set(PDFName.of('First'), topRes.firstRef);
  rootDict.set(PDFName.of('Last'), topRes.lastRef);
  rootDict.set(PDFName.of('Count'), PDFNumber.of(topRes.totalVisible));
  pdfDoc.catalog.set(outlinesKey, rootRef);

  return pdfDoc;
}

/**
 * Convenience helper to apply a bookmark tree directly onto a PDF byte buffer and save.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {BookmarkNode[]} tree
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function applyOutlinesToPdfBuffer(pdfBytes, tree = [], fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  writeOutlines(doc, tree);
  return doc.save({ useObjectStreams: true, addDefaultPage: false });
}
