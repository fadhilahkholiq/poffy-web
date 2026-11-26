import { PDFDocument } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { writeOutlines } from './outlines.js';

/**
 * @typedef {Object} MergeSourceInput
 * @property {string} id - Unique source identifier
 * @property {string} name - Original filename
 * @property {ArrayBuffer|Uint8Array} buffer - Raw PDF bytes
 * @property {number[]} [pageIndices] - Optional 0-based page indices to include (defaults to all)
 */

/**
 * @typedef {Object} MergeOptions
 * @property {'sequential'|'interleave'} [mode='sequential'] - Merge order strategy
 * @property {boolean} [autoBookmarks=false] - Generate top-level outlines from source filenames
 * @property {(percent: number, stage: string) => void} [onProgress] - Progress callback
 * @property {{ aborted?: boolean }} [abortToken] - Cancellation token
 */

/**
 * Merges multiple PDF buffers either sequentially or interleaved (page-by-page round-robin).
 * Optionally builds top-level bookmarks from source filenames using shared `writeOutlines()`.
 * @param {MergeSourceInput[]} sources - Ordered source PDFs
 * @param {MergeOptions} [options={}] - Merge configuration
 * @returns {Promise<Uint8Array>} Serialized merged PDF bytes
 */
export async function mergePdfBuffers(sources, options = {}) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('At least one PDF file is required to merge.');
  }

  const { mode = 'sequential', autoBookmarks = false, onProgress, abortToken } = options;
  const outputDoc = await PDFDocument.create();

  /** @type {{ doc: PDFDocument, indices: number[], name: string }[]} */
  const loadedSources = [];

  for (let i = 0; i < sources.length; i += 1) {
    assertNotAborted(abortToken);
    const src = sources[i];
    onProgress?.(Math.round((i / sources.length) * 30), `Loading ${src.name}...`);
    const doc = await loadPdfSafe(src.buffer, src.name);
    const total = doc.getPageCount();
    const indices =
      Array.isArray(src.pageIndices) && src.pageIndices.length > 0
        ? src.pageIndices.filter((idx) => idx >= 0 && idx < total)
        : Array.from({ length: total }, (_, idx) => idx);
    loadedSources.push({ doc, indices, name: src.name });
  }

  /** @type {{ sourceIdx: number, pageIdx: number }[]} */
  const copyPlan = [];

  if (mode === 'interleave') {
    const maxLen = Math.max(...loadedSources.map((s) => s.indices.length), 0);
    for (let cursor = 0; cursor < maxLen; cursor += 1) {
      for (let sIdx = 0; sIdx < loadedSources.length; sIdx += 1) {
        const pageIdx = loadedSources[sIdx].indices[cursor];
        if (pageIdx !== undefined) {
          copyPlan.push({ sourceIdx: sIdx, pageIdx });
        }
      }
    }
  } else {
    for (let sIdx = 0; sIdx < loadedSources.length; sIdx += 1) {
      for (const pageIdx of loadedSources[sIdx].indices) {
        copyPlan.push({ sourceIdx: sIdx, pageIdx });
      }
    }
  }

  if (copyPlan.length === 0) {
    throw new Error('No pages selected for merge.');
  }

  const BATCH_SIZE = 15;
  for (let start = 0; start < copyPlan.length; start += BATCH_SIZE) {
    assertNotAborted(abortToken);
    const end = Math.min(start + BATCH_SIZE, copyPlan.length);

    // Group contiguous items from the same source within the batch for faster copyPages
    let cursor = start;
    while (cursor < end) {
      const sourceIdx = copyPlan[cursor].sourceIdx;
      const batchIndices = [];
      while (cursor < end && copyPlan[cursor].sourceIdx === sourceIdx) {
        batchIndices.push(copyPlan[cursor].pageIdx);
        cursor += 1;
      }
      const copied = await outputDoc.copyPages(loadedSources[sourceIdx].doc, batchIndices);
      for (const page of copied) {
        outputDoc.addPage(page);
      }
    }

    const pct = 30 + Math.round((end / copyPlan.length) * 60);
    onProgress?.(pct, `Merging pages (${end}/${copyPlan.length})...`);
    await yieldToLoop();
  }

  if (autoBookmarks) {
    /** @type {Set<number>} */
    const seenSources = new Set();
    /** @type {import('./outlines.js').BookmarkNode[]} */
    const toc = [];
    for (let idx = 0; idx < copyPlan.length; idx += 1) {
      const sIdx = copyPlan[idx].sourceIdx;
      if (!seenSources.has(sIdx)) {
        seenSources.add(sIdx);
        const cleanTitle = loadedSources[sIdx].name.replace(/\.pdf$/i, '').trim() || `Document ${sIdx + 1}`;
        toc.push({
          id: `merge_bm_${sIdx}`,
          title: cleanTitle,
          pageIndex: idx,
          children: []
        });
      }
    }
    writeOutlines(outputDoc, toc);
  }

  assertNotAborted(abortToken);
  onProgress?.(95, 'Serializing merged PDF...');
  return outputDoc.save({ useObjectStreams: true });
}
