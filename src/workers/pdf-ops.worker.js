import { mergePdfBuffers } from '../core/pdf/merge.js';
import { splitPdf } from '../core/pdf/split.js';
import { compileVirtualPagesToDocument } from '../core/pdf/pages.js';
import { applyWatermarkToDocument } from '../core/pdf/watermark.js';
import { applyPageNumbersToDocument } from '../core/pdf/numbering.js';
import { imagesToPdf, normalizeImageForPdf } from '../core/pdf/convert.js';
import {
  applyMetadataToDocument,
  inspectPdfMetadata,
  updatePdfMetadata
} from '../core/pdf/metadata.js';
import {
  applyFormChangesToDocument,
  fillAndFlattenPdf,
  inspectAcroFormFields
} from '../core/pdf/forms.js';
import { optimizePdfBuffer } from '../core/pdf/optimize.js';
import { assertNotAborted } from '../core/pdf/doc-loader.js';

/**
 * @typedef {Object} WorkerRequest
 * @property {string} requestId - Correlation UUID
 * @property {'REGISTER_SOURCE'|'EVICT_SOURCE'|'CLEAR_SOURCES'|'MERGE'|'SPLIT'|'EXPORT_WORKSPACE'|'INSPECT_META'|'APPLY_META'|'INSPECT_FORMS'|'APPLY_FORMS'|'IMAGES_TO_PDF'|'OPTIMIZE'|'ABORT_JOB'} type
 * @property {Object} payload - Operation-specific configuration
 */

/**
 * @typedef {Object} WorkerProgress
 * @property {string} requestId
 * @property {'PROGRESS'} status
 * @property {number} percent - 0 to 100
 * @property {string} stage - Human-readable step
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
function postProgress(requestId, percent, stage) {
  self.postMessage({
    requestId,
    status: 'PROGRESS',
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    stage
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
      self.postMessage({ requestId, status: 'SUCCESS', data: { evicted: true } });
      return;
    }

    if (type === 'CLEAR_SOURCES') {
      sourceCache.clear();
      self.postMessage({ requestId, status: 'SUCCESS', data: { cleared: true } });
      return;
    }

    if (type === 'INSPECT_META') {
      const src = resolveSource(payload.sourceFileId, payload.inlineSources);
      const metadata = await inspectPdfMetadata(src.buffer, src.name);
      self.postMessage({ requestId, status: 'SUCCESS', data: metadata });
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
        onProgress: (pct, stage) => postProgress(requestId, 30 + pct * 0.7, stage),
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
            optimizedSize: opt.optimizedSize
          }
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
        fileName = 'poffy_export.pdf'
      } = payload;

      const outputDoc = await compileVirtualPagesToDocument(virtualPages, sourceCache, {
        onProgress: (pct, stage) => postProgress(requestId, pct, stage),
        abortToken
      });

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
