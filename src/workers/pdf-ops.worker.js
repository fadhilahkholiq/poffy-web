import { mergePdfBuffers } from '../core/pdf/merge.js';
import { splitPdf } from '../core/pdf/split.js';
import { compileVirtualPagesToDocument } from '../core/pdf/pages.js';
import { computeAutoCropMargins } from '../core/pdf/autocrop.js';
import { applyWatermarkToDocument } from '../core/pdf/watermark.js';
import { applyPageNumbersToDocument, batchBatesNumbering } from '../core/pdf/numbering.js';
import { imagesToPdf, normalizeImageForPdf } from '../core/pdf/convert.js';
import {
  applyMetadataToDocument,
  inspectPdfMetadata,
  inspectPdfPrivacyAudit,
  updatePdfMetadata
} from '../core/pdf/metadata.js';
import {
  applyFormChangesToDocument,
  fillAndFlattenPdf,
  inspectAcroFormFields
} from '../core/pdf/forms.js';
import { optimizePdfBuffer } from '../core/pdf/optimize.js';
import { resizePdfDocument } from '../core/pdf/resize.js';
import { imposePdfDocument } from '../core/pdf/imposition.js';
import { splitSpreadsDocument } from '../core/pdf/spreads.js';
import {
  applyColorFiltersToPdf,
  clearColorFilterPreviewCache,
  generateColorFilterPreview
} from '../core/pdf/filters.js';
import { applyRedactionsToPdf, findRedactionMatchesInPdf } from '../core/pdf/redact.js';
import { applyAnnotationsToDocument } from '../core/pdf/annotate.js';
import { buildDiffReportPdf, comparePdfDocuments } from '../core/pdf/compare.js';
import { batchExtractTextZip, extractTextFromPdfBuffer } from '../core/pdf/text-extract.js';
import {
  extractEmbeddedImagesFromPdf,
  packageExtractedImagesZip
} from '../core/pdf/image-extract.js';
import {
  inspectPdfAttachments,
  packageAttachmentsZip,
  updatePdfAttachments
} from '../core/pdf/attachments.js';
import {
  applyOutlinesToPdfBuffer,
  readOutlinesFromPdf,
  writeOutlines
} from '../core/pdf/outlines.js';
import { cbzToPdf, pdfToCbz, unpackSortedCbzEntries } from '../core/pdf/cbz.js';
import { assertNotAborted, loadPdfSafe } from '../core/pdf/doc-loader.js';

/**
 * @typedef {Object} WorkerRequest
 * @property {string} requestId - Correlation UUID
 * @property {'REGISTER_SOURCE'|'EVICT_SOURCE'|'CLEAR_SOURCES'|'MERGE'|'SPLIT'|'EXPORT_WORKSPACE'|'INSPECT_META'|'INSPECT_PRIVACY_AUDIT'|'APPLY_META'|'INSPECT_FORMS'|'APPLY_FORMS'|'IMAGES_TO_PDF'|'OPTIMIZE'|'AUTO_CROP'|'BATCH_BATES'|'RESIZE_PDF'|'NUP_BOOKLET'|'SPLIT_SPREADS'|'COLOR_FILTERS'|'PREVIEW_COLOR_FILTER'|'FIND_REDACTION_MATCHES'|'REDACT_PDF'|'SIGN_ANNOTATE'|'COMPARE_PDF'|'EXPORT_DIFF_REPORT'|'EXTRACT_TEXT'|'BATCH_EXTRACT_TEXT_ZIP'|'EXTRACT_IMAGES'|'PACKAGE_IMAGES_ZIP'|'INSPECT_ATTACHMENTS'|'UPDATE_ATTACHMENTS'|'PACKAGE_ATTACHMENTS_ZIP'|'READ_OUTLINES'|'WRITE_OUTLINES'|'INSPECT_CBZ'|'CBZ_TO_PDF'|'PDF_TO_CBZ'|'ABORT_JOB'} type
 * @property {Object} payload - Operation-specific configuration
 */

/**
 * @typedef {Object} WorkerProgress
 * @property {string} requestId
 * @property {'PROGRESS'} status
 * @property {number} percent - 0 to 100
 * @property {string} stage - Human-readable step
 * @property {number} [current] - Current item/page index
 * @property {number} [total] - Total item/page count
 */

/**
 * @typedef {Object} WorkerSuccess
 * @property {string} requestId
 * @property {'SUCCESS'} status
 * @property {ArrayBuffer} [resultBuffer] - Transferred binary output
 * @property {string} [fileName] - Suggested output filename
 * @property {string} [mimeType] - 'application/pdf' | 'application/zip'
 * @property {any} [data] - Structured inspection payload
 */

/** @type {Map<string, { id: string, name: string, type: 'pdf'|'image', mimeType: string, buffer: ArrayBuffer }>} */
const sourceCache = new Map();

/** @type {Map<string, { aborted: boolean }>} */
const activeJobs = new Map();

/**
 * Converts a Uint8Array cleanly into a standalone transferable ArrayBuffer.
 * @param {Uint8Array} bytes
 * @returns {ArrayBuffer}
 */
function toTransferableBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Emits a WorkerProgress event back to the main thread.
 * @param {string} requestId
 * @param {number} percent
 * @param {string} stage
 */
function postProgress(requestId, percent, stage, current, total) {
  self.postMessage({
    requestId,
    status: 'PROGRESS',
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    stage,
    current,
    total
  });
}

/**
 * Resolves a source entry from either the worker cache or inline payload.
 * @param {string} sourceFileId
 * @param {Record<string, any>} [inlineSources]
 * @returns {{ id: string, name: string, type: 'pdf'|'image', mimeType: string, buffer: ArrayBuffer }}
 */
function resolveSource(sourceFileId, inlineSources = {}) {
  const entry = inlineSources?.[sourceFileId] || sourceCache.get(sourceFileId);
  if (!entry) {
    throw new Error(`Source file "${sourceFileId}" not found in worker memory.`);
  }
  return entry;
}

self.addEventListener('message', async (event) => {
  /** @type {WorkerRequest} */
  const msg = event.data;
  if (!msg || !msg.requestId) return;
  const { requestId, type, payload = {} } = msg;

  if (type === 'ABORT_JOB') {
    const token = activeJobs.get(payload.targetRequestId);
    if (token) {
      token.aborted = true;
    }
    self.postMessage({ requestId, status: 'SUCCESS', data: { aborted: true } });
    return;
  }

  const abortToken = { aborted: false };
  activeJobs.set(requestId, abortToken);

  try {
    if (type === 'REGISTER_SOURCE') {
      let buffer = payload.buffer;
      let mimeType = payload.mimeType || '';
      if (payload.type === 'image') {
        const normalized = await normalizeImageForPdf(buffer, mimeType, payload.name);
        buffer = toTransferableBuffer(normalized.bytes);
        mimeType = normalized.format === 'png' ? 'image/png' : 'image/jpeg';
      }
      sourceCache.set(payload.id, {
        id: payload.id,
        name: payload.name,
        type: payload.type,
        mimeType,
        buffer
      });
      self.postMessage({ requestId, status: 'SUCCESS', data: { registered: true } });
      return;
    }

    if (type === 'EVICT_SOURCE') {
      sourceCache.delete(payload.sourceFileId);
      clearColorFilterPreviewCache();
      self.postMessage({ requestId, status: 'SUCCESS', data: { evicted: true } });
      return;
    }

    if (type === 'CLEAR_SOURCES') {
      sourceCache.clear();
      clearColorFilterPreviewCache();
      self.postMessage({ requestId, status: 'SUCCESS', data: { cleared: true } });
      return;
    }

    if (type === 'INSPECT_META') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const metadata = await inspectPdfMetadata(src.buffer, src.name);
      self.postMessage({ requestId, status: 'SUCCESS', data: metadata });
      return;
    }

    if (type === 'INSPECT_PRIVACY_AUDIT') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const audit = await inspectPdfPrivacyAudit(src.buffer, src.name);
      self.postMessage({ requestId, status: 'SUCCESS', data: audit });
      return;
    }

    if (type === 'AUTO_CROP') {
      const result = await computeAutoCropMargins(payload.targetPages || [], sourceCache, {
        paddingPt: payload.paddingPt,
        threshold: payload.threshold,
        mode: payload.mode,
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      self.postMessage({ requestId, status: 'SUCCESS', data: result });
      return;
    }

    if (type === 'BATCH_BATES') {
      const files = (payload.sourceIds || []).map((id) => resolveSource(id, payload.inlineSources));
      const batesResult = await batchBatesNumbering(files, payload.config || {}, {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      const resultBuffer = toTransferableBuffer(batesResult.buffer);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: batesResult.fileName,
          mimeType: batesResult.mimeType,
          data: {
            fileCount: batesResult.fileCount,
            totalPagesStamped: batesResult.totalPagesStamped,
            manifestRows: batesResult.manifestRows
          }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'APPLY_META') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      postProgress(requestId, 30, 'Updating document metadata...');
      const bytes = await updatePdfMetadata(src.buffer, payload.config, src.name);
      const resultBuffer = toTransferableBuffer(bytes);
      const stem = src.name.replace(/\.pdf$/i, '') || 'document';
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.config?.stripAll ? `${stem}_scrubbed.pdf` : `${stem}_metadata.pdf`,
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'INSPECT_FORMS') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const fields = await inspectAcroFormFields(src.buffer, src.name);
      self.postMessage({ requestId, status: 'SUCCESS', data: fields });
      return;
    }

    if (type === 'APPLY_FORMS') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      postProgress(requestId, 35, payload.config?.flatten ? 'Filling and flattening form...' : 'Updating form values...');
      const bytes = await fillAndFlattenPdf(src.buffer, payload.config, src.name);
      const resultBuffer = toTransferableBuffer(bytes);
      const stem = src.name.replace(/\.pdf$/i, '') || 'form';
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.config?.flatten ? `${stem}_flattened.pdf` : `${stem}_filled.pdf`,
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'MERGE') {
      const sources = (payload.sourceIds || []).map((id) => resolveSource(id, payload.inlineSources));
      const bytes = await mergePdfBuffers(sources, {
        mode: payload.mode || 'sequential',
        autoBookmarks: Boolean(payload.autoBookmarks),
        onProgress: (pct, stage) => postProgress(requestId, pct, stage),
        abortToken
      });
      const resultBuffer = toTransferableBuffer(bytes);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_merged.pdf',
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'IMAGES_TO_PDF') {
      const items = (payload.items || []).map((item) => {
        if (item.sourceFileId) {
          const src = resolveSource(item.sourceFileId, payload.inlineSources);
          return {
            name: src.name,
            mimeType: src.mimeType,
            buffer: src.buffer
          };
        }
        return item;
      });
      const bytes = await imagesToPdf(items, {
        pageFit: payload.pageFit || 'a4',
        margin: payload.margin ?? 24,
        onProgress: (pct, stage) => postProgress(requestId, pct, stage),
        abortToken
      });
      const resultBuffer = toTransferableBuffer(bytes);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_images.pdf',
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'SPLIT') {
      let targetBuffer;
      let baseName = payload.baseName || 'poffy_document';
      let sourceName = baseName;

      if (payload.targetScope === 'workspace' && Array.isArray(payload.virtualPages)) {
        postProgress(requestId, 5, 'Compiling workspace order...');
        const compiledDoc = await compileVirtualPagesToDocument(
          payload.virtualPages,
          sourceCache,
          {
            onProgress: (pct, stage) => postProgress(requestId, pct * 0.4, stage),
            abortToken
          }
        );
        targetBuffer = await compiledDoc.save({ useObjectStreams: false });
      } else {
        const src = resolveSource(payload.sourceFileId, payload.inlineSources);
        targetBuffer = src.buffer;
        baseName = src.name;
        sourceName = src.name;
      }

      const splitResult = await splitPdf(targetBuffer, {
        mode: payload.mode,
        rangeExpression: payload.rangeExpression,
        selectedIndices: payload.selectedIndices,
        everyN: payload.everyN,
        baseName,
        sourceName,
        onProgress: (pct, stage) => postProgress(requestId, 40 + pct * 0.6, stage),
        abortToken
      });

      const resultBuffer = toTransferableBuffer(splitResult.buffer);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: splitResult.fileName,
          mimeType: splitResult.mimeType,
          data: { fileCount: splitResult.fileCount }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'OPTIMIZE') {
      let inputBytes;
      let baseName = payload.fileName || 'poffy_optimized.pdf';

      if (Array.isArray(payload.virtualPages) && payload.virtualPages.length > 0) {
        const compiled = await compileVirtualPagesToDocument(payload.virtualPages, sourceCache, {
          onProgress: (pct, stage) => postProgress(requestId, pct * 0.3, stage),
          abortToken
        });
        inputBytes = await compiled.save({ useObjectStreams: false });
      } else {
        const src = resolveSource(payload.sourceFileId, payload.inlineSources);
        inputBytes = src.buffer;
        baseName = `${src.name.replace(/\.pdf$/i, '')}_optimized.pdf`;
      }

      const opt = await optimizePdfBuffer(inputBytes, {
        ...payload.config,
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, 30 + pct * 0.7, stage, cur, tot),
        abortToken
      });

      const resultBuffer = toTransferableBuffer(opt.bytes);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: baseName,
          mimeType: 'application/pdf',
          data: {
            originalSize: opt.originalSize,
            optimizedSize: opt.optimizedSize,
            recompressedImages: opt.recompressedImages,
            skippedImages: opt.skippedImages,
            preset: opt.preset
          }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'RESIZE_PDF') {
      const compiled = await compileVirtualPagesToDocument(payload.virtualPages || [], sourceCache, {
        onProgress: (pct, stage) => postProgress(requestId, pct * 0.25, stage),
        abortToken
      });
      const res = await resizePdfDocument(compiled, {
        ...payload.config,
        onProgress: (pct, stage, cur, tot) =>
          postProgress(requestId, 25 + pct * 0.7, stage, cur, tot),
        abortToken
      });
      assertNotAborted(abortToken);
      postProgress(requestId, 95, 'Serializing standardized PDF...');
      const bytes = await res.doc.save({ useObjectStreams: true, addDefaultPage: false });
      const resultBuffer = toTransferableBuffer(bytes);
      postProgress(requestId, 100, 'Resize complete.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_resized.pdf',
          mimeType: 'application/pdf',
          data: { pageCount: res.pageCount, targetDimensions: res.targetDimensions }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'NUP_BOOKLET') {
      const compiled = await compileVirtualPagesToDocument(payload.virtualPages || [], sourceCache, {
        onProgress: (pct, stage) => postProgress(requestId, pct * 0.25, stage),
        abortToken
      });
      const res = await imposePdfDocument(compiled, {
        ...payload.config,
        onProgress: (pct, stage, cur, tot) =>
          postProgress(requestId, 25 + pct * 0.7, stage, cur, tot),
        abortToken
      });
      assertNotAborted(abortToken);
      postProgress(requestId, 95, 'Serializing imposed sheets...');
      const bytes = await res.doc.save({ useObjectStreams: true, addDefaultPage: false });
      const resultBuffer = toTransferableBuffer(bytes);
      postProgress(requestId, 100, 'Imposition complete.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_imposed.pdf',
          mimeType: 'application/pdf',
          data: {
            sheetCount: res.sheetCount,
            paddedPageCount: res.paddedPageCount
          }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'SPLIT_SPREADS') {
      const compiled = await compileVirtualPagesToDocument(payload.virtualPages || [], sourceCache, {
        onProgress: (pct, stage) => postProgress(requestId, pct * 0.25, stage),
        abortToken
      });
      const res = await splitSpreadsDocument(compiled, {
        ...payload.config,
        onProgress: (pct, stage, cur, tot) =>
          postProgress(requestId, 25 + pct * 0.7, stage, cur, tot),
        abortToken
      });
      assertNotAborted(abortToken);
      postProgress(requestId, 95, 'Serializing split pages...');
      const bytes = await res.doc.save({ useObjectStreams: true, addDefaultPage: false });
      const resultBuffer = toTransferableBuffer(bytes);
      postProgress(requestId, 100, 'Spreads split cleanly.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_split_spreads.pdf',
          mimeType: 'application/pdf',
          data: {
            inputPages: res.inputPages,
            outputPages: res.outputPages,
            splitCount: res.splitCount
          }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'PREVIEW_COLOR_FILTER') {
      const targetVPage = payload.virtualPage;
      if (!targetVPage) {
        throw new Error('No preview page specified.');
      }
      const src =
        targetVPage.sourceFileId !== '__blank__' ? sourceCache.get(targetVPage.sourceFileId) : null;
      let inputBytes;
      let pageIndex = 0;
      let rotation = 0;

      if (src && src.type === 'pdf' && !targetVPage.cropMargins) {
        inputBytes = src.buffer;
        pageIndex = targetVPage.sourcePageIndex || 0;
        rotation = targetVPage.rotation || 0;
      } else {
        const singleDoc = await compileVirtualPagesToDocument([targetVPage], sourceCache, {
          abortToken
        });
        inputBytes = await singleDoc.save({ useObjectStreams: false });
      }

      const cropSig = targetVPage.cropMargins
        ? `${targetVPage.cropMargins.top},${targetVPage.cropMargins.right},${targetVPage.cropMargins.bottom},${targetVPage.cropMargins.left}`
        : 'none';
      const cacheKey = `${targetVPage.id}:${targetVPage.sourceFileId}:${pageIndex}:${rotation}:${cropSig}`;

      const preview = await generateColorFilterPreview(inputBytes, {
        cacheKey,
        pageIndex,
        rotation,
        filterConfig: payload.config,
        fileName: src?.name || ''
      });

      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer: preview.filteredBuffer,
          mimeType: preview.mimeType,
          data: {
            originalBuffer: preview.originalBuffer,
            width: preview.width,
            height: preview.height,
            otsuThreshold: preview.otsuThreshold
          }
        },
        [preview.filteredBuffer, preview.originalBuffer]
      );
      return;
    }

    if (type === 'COLOR_FILTERS') {
      const compiled = await compileVirtualPagesToDocument(payload.virtualPages || [], sourceCache, {
        onProgress: (pct, stage) => postProgress(requestId, pct * 0.15, stage),
        abortToken
      });
      const inputBytes = await compiled.save({ useObjectStreams: false });
      const filtered = await applyColorFiltersToPdf(
        inputBytes,
        {
          ...payload.config,
          onProgress: (pct, stage, cur, tot) =>
            postProgress(requestId, 15 + pct * 0.85, stage, cur, tot),
          abortToken
        },
        payload.fileName || ''
      );
      const resultBuffer = toTransferableBuffer(filtered.bytes);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_filtered.pdf',
          mimeType: 'application/pdf',
          data: { pageCount: filtered.pageCount }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'FIND_REDACTION_MATCHES') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const matches = await findRedactionMatchesInPdf(src.buffer, payload.queryConfig || {}, {
        fileName: src.name,
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      self.postMessage({ requestId, status: 'SUCCESS', data: matches });
      return;
    }

    if (type === 'REDACT_PDF') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const res = await applyRedactionsToPdf(
        src.buffer,
        payload.marks || [],
        payload.config || {},
        src.name,
        {
          onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
          abortToken
        }
      );
      const resultBuffer = toTransferableBuffer(res.bytes);
      const outName =
        payload.fileName || `${src.name.replace(/\.pdf$/i, '')}_redacted.pdf`;
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: outName,
          mimeType: 'application/pdf',
          data: {
            totalPages: res.totalPages,
            burnedPages: res.burnedPages,
            copiedPages: res.copiedPages,
            paranoidMode: res.paranoidMode
          }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'SIGN_ANNOTATE') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const doc = await loadPdfSafe(src.buffer, src.name);
      await applyAnnotationsToDocument(doc, payload.overlays || [], {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      assertNotAborted(abortToken);
      postProgress(requestId, 95, 'Serializing signed PDF...');
      const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
      const resultBuffer = toTransferableBuffer(bytes);
      const outName =
        payload.fileName || `${src.name.replace(/\.pdf$/i, '')}_signed.pdf`;
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: outName,
          mimeType: 'application/pdf',
          data: { overlayCount: (payload.overlays || []).length }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'COMPARE_PDF') {
      const res = await comparePdfDocuments(payload.bufferA, payload.bufferB, {
        nameA: payload.nameA,
        nameB: payload.nameB,
        scale: payload.scale ?? 1.5,
        sensitivity: payload.sensitivity ?? 24,
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          data: {
            pagesA: res.pagesA,
            pagesB: res.pagesB,
            totalPages: res.totalPages,
            pages: res.pages
          }
        },
        res.transferables
      );
      return;
    }

    if (type === 'EXPORT_DIFF_REPORT') {
      postProgress(requestId, 20, 'Building diff report PDF...');
      const bytes = await buildDiffReportPdf({
        nameA: payload.nameA || 'Original.pdf',
        nameB: payload.nameB || 'Revised.pdf',
        pages: payload.pages || []
      });
      const resultBuffer = toTransferableBuffer(bytes);
      postProgress(requestId, 100, 'Diff report ready.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || 'poffy_diff_report.pdf',
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'EXTRACT_TEXT') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const res = await extractTextFromPdfBuffer(src.buffer, payload.config || {}, src.name, {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      self.postMessage({ requestId, status: 'SUCCESS', data: res });
      return;
    }

    if (type === 'BATCH_EXTRACT_TEXT_ZIP') {
      const ids = Array.isArray(payload.sourceIds) ? payload.sourceIds : [];
      const files = ids.map((id) => resolveSource(id, payload.inlineSources));
      const res = await batchExtractTextZip(files, payload.config || {}, {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      const resultBuffer = toTransferableBuffer(res.buffer);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: res.fileName,
          mimeType: res.mimeType,
          data: { fileCount: res.fileCount, scannedCount: res.scannedCount }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'EXTRACT_IMAGES') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const res = await extractEmbeddedImagesFromPdf(src.buffer, payload.config || {}, src.name, {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      const transferables = [];
      const items = res.images.map((img) => {
        const buf = toTransferableBuffer(img.bytes);
        transferables.push(buf);
        return {
          id: img.id,
          fileName: img.fileName,
          format: img.format,
          mimeType: img.mimeType,
          width: img.width,
          height: img.height,
          hasAlpha: img.hasAlpha,
          buffer: buf
        };
      });
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          data: {
            images: items,
            skippedSmall: res.skippedSmall,
            skippedUnsupported: res.skippedUnsupported
          }
        },
        transferables
      );
      return;
    }

    if (type === 'PACKAGE_IMAGES_ZIP') {
      const res = packageExtractedImagesZip(payload.images || [], payload.sourceName || 'document');
      const resultBuffer = toTransferableBuffer(res.buffer);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: res.fileName,
          mimeType: res.mimeType
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'INSPECT_ATTACHMENTS') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const entries = await inspectPdfAttachments(src.buffer, src.name);
      const transferables = [];
      const items = entries.map((att) => {
        const buf = toTransferableBuffer(att.bytes);
        transferables.push(buf);
        return {
          id: att.id,
          name: att.name,
          description: att.description,
          mimeType: att.mimeType,
          size: att.size,
          buffer: buf
        };
      });
      self.postMessage({ requestId, status: 'SUCCESS', data: items }, transferables);
      return;
    }

    if (type === 'UPDATE_ATTACHMENTS') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      postProgress(requestId, 30, 'Updating embedded file attachments...');
      const res = await updatePdfAttachments(
        src.buffer,
        {
          removeNames: payload.removeNames || [],
          addFiles: payload.addFiles || []
        },
        src.name
      );
      const resultBuffer = toTransferableBuffer(res.bytes);
      const transferables = [resultBuffer];
      const nextList = res.attachments.map((att) => {
        const buf = toTransferableBuffer(att.bytes);
        transferables.push(buf);
        return {
          id: att.id,
          name: att.name,
          description: att.description,
          mimeType: att.mimeType,
          size: att.size,
          buffer: buf
        };
      });
      postProgress(requestId, 100, 'Attachments updated.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || `${src.name.replace(/\.pdf$/i, '')}_attachments.pdf`,
          mimeType: 'application/pdf',
          data: { attachments: nextList }
        },
        transferables
      );
      return;
    }

    if (type === 'PACKAGE_ATTACHMENTS_ZIP') {
      const res = packageAttachmentsZip(payload.attachments || [], payload.sourceName || 'document');
      const resultBuffer = toTransferableBuffer(res.buffer);
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: res.fileName,
          mimeType: res.mimeType
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'READ_OUTLINES') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const res = await readOutlinesFromPdf(src.buffer, src.name);
      self.postMessage({ requestId, status: 'SUCCESS', data: res });
      return;
    }

    if (type === 'WRITE_OUTLINES') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      postProgress(requestId, 40, 'Writing bookmark outlines...');
      const bytes = await applyOutlinesToPdfBuffer(src.buffer, payload.tree || [], src.name);
      const resultBuffer = toTransferableBuffer(bytes);
      postProgress(requestId, 100, 'Bookmarks saved.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: payload.fileName || `${src.name.replace(/\.pdf$/i, '')}_bookmarked.pdf`,
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'INSPECT_CBZ') {
      const unpacked = unpackSortedCbzEntries(payload.buffer);
      self.postMessage({
        requestId,
        status: 'SUCCESS',
        data: { fileNames: unpacked.fileNames, pageCount: unpacked.fileNames.length }
      });
      return;
    }

    if (type === 'CBZ_TO_PDF') {
      const res = await cbzToPdf(payload.buffer, payload.config || {}, {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      const resultBuffer = toTransferableBuffer(res.bytes);
      const base = String(payload.fileName || 'comic').replace(/\.cbz$/i, '');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: `${base}.pdf`,
          mimeType: 'application/pdf',
          data: { pageCount: res.pageCount, fileNames: res.fileNames }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'PDF_TO_CBZ') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const res = await pdfToCbz(src.buffer, payload.config || {}, src.name, {
        onProgress: (pct, stage, cur, tot) => postProgress(requestId, pct, stage, cur, tot),
        abortToken
      });
      const resultBuffer = toTransferableBuffer(res.bytes);
      const base = src.name.replace(/\.pdf$/i, '') || 'comic';
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName: `${base}.cbz`,
          mimeType: 'application/vnd.comicbook+zip',
          data: { pageCount: res.pageCount, entryNames: res.entryNames }
        },
        [resultBuffer]
      );
      return;
    }

    if (type === 'EXPORT_WORKSPACE') {
      const {
        virtualPages = [],
        watermarkConfig,
        numberingConfig,
        metadataConfig,
        formConfig,
        optimizeConfig,
        autoBookmarks = false,
        fileName = 'poffy_export.pdf'
      } = payload;

      const outputDoc = await compileVirtualPagesToDocument(virtualPages, sourceCache, {
        onProgress: (pct, stage) => postProgress(requestId, pct, stage),
        abortToken
      });

      if (autoBookmarks) {
        const seenSources = new Set();
        const toc = [];
        for (let idx = 0; idx < virtualPages.length; idx += 1) {
          const vp = virtualPages[idx];
          if (vp.sourceFileId === '__blank__' || seenSources.has(vp.sourceFileId)) continue;
          seenSources.add(vp.sourceFileId);
          const sEntry = sourceCache.get(vp.sourceFileId);
          if (sEntry) {
            toc.push({
              id: `ws_bm_${idx}`,
              title: sEntry.name.replace(/\.\w+$/i, '').trim() || `File ${toc.length + 1}`,
              pageIndex: idx,
              children: []
            });
          }
        }
        writeOutlines(outputDoc, toc);
      }

      if (watermarkConfig?.enabled) {
        assertNotAborted(abortToken);
        postProgress(requestId, 65, 'Embedding watermarks...');
        await applyWatermarkToDocument(outputDoc, watermarkConfig, {
          onProgress: (pct, stage) => postProgress(requestId, pct, stage),
          abortToken
        });
      }

      if (numberingConfig?.enabled) {
        assertNotAborted(abortToken);
        postProgress(requestId, 80, 'Stamping page numbers...');
        await applyPageNumbersToDocument(outputDoc, numberingConfig, {
          onProgress: (pct, stage) => postProgress(requestId, pct, stage),
          abortToken
        });
      }

      if (formConfig && (Object.keys(formConfig.values || {}).length > 0 || formConfig.flatten)) {
        assertNotAborted(abortToken);
        postProgress(requestId, 88, 'Applying form updates...');
        applyFormChangesToDocument(outputDoc, formConfig);
      }

      if (metadataConfig && (metadataConfig.stripAll || metadataConfig.applyOnExport)) {
        assertNotAborted(abortToken);
        postProgress(requestId, 92, 'Updating metadata...');
        applyMetadataToDocument(outputDoc, metadataConfig);
      }

      assertNotAborted(abortToken);
      postProgress(requestId, 96, 'Serializing final PDF...');
      const useObjectStreams = optimizeConfig?.useObjectStreams !== false;
      const bytes = await outputDoc.save({
        useObjectStreams,
        addDefaultPage: false
      });

      const resultBuffer = toTransferableBuffer(bytes);
      postProgress(requestId, 100, 'Export ready.');
      self.postMessage(
        {
          requestId,
          status: 'SUCCESS',
          resultBuffer,
          fileName,
          mimeType: 'application/pdf'
        },
        [resultBuffer]
      );
      return;
    }

    throw new Error(`Unsupported pdf-ops worker operation: ${type}`);
  } catch (err) {
    self.postMessage({
      requestId,
      status: 'ERROR',
      code: err?.code || 'PDF_OP_ERROR',
      message: err?.message || String(err),
      fileName: err?.fileName || ''
    });
  } finally {
    activeJobs.delete(requestId);
  }
});
