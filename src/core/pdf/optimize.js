import { PDFDocument } from 'pdf-lib';
import { assertNotAborted, loadPdfSafe, yieldToLoop } from './doc-loader.js';
import { applyMetadataToDocument } from './metadata.js';

/**
 * @typedef {Object} OptimizeConfig
 * @property {boolean} [useObjectStreams=true] - Compress cross-reference and object streams
 * @property {boolean} [rebuildCleanCopy=true] - Copy pages into fresh document to drop orphan objects
 * @property {boolean} [stripMetadata=false] - Also scrub Info/XMP metadata
 * @property {(percent: number, stage: string) => void} [onProgress]
 * @property {{ aborted?: boolean }} [abortToken]
 */

/**
 * Re-saves a PDF buffer using object streams and orphan-object cleanup to reduce size.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Input PDF bytes
 * @param {OptimizeConfig} [config={}] - Optimization options
 * @param {string} [fileName=''] - Optional filename for error context
 * @returns {Promise<{ bytes: Uint8Array, originalSize: number, optimizedSize: number }>}
 */
export async function optimizePdfBuffer(pdfBytes, config = {}, fileName = '') {
  const {
    useObjectStreams = true,
    rebuildCleanCopy = true,
    stripMetadata = false,
    onProgress,
    abortToken
  } = config;

  const originalSize = pdfBytes.byteLength;
  assertNotAborted(abortToken);
  onProgress?.(15, 'Inspecting PDF structure...');

  const srcDoc = await loadPdfSafe(pdfBytes, fileName);
  let targetDoc = srcDoc;

  if (rebuildCleanCopy) {
    const cleanDoc = await PDFDocument.create();
    const total = srcDoc.getPageCount();
    const BATCH = 20;
    for (let i = 0; i < total; i += BATCH) {
      assertNotAborted(abortToken);
      const slice = Array.from({ length: Math.min(BATCH, total - i) }, (_, k) => i + k);
      const copied = await cleanDoc.copyPages(srcDoc, slice);
      for (const page of copied) {
        cleanDoc.addPage(page);
      }
      onProgress?.(20 + Math.round(((i + slice.length) / total) * 60), 'Pruning unused objects...');
      await yieldToLoop();
    }

    if (!stripMetadata) {
      const title = srcDoc.getTitle();
      const author = srcDoc.getAuthor();
      const subject = srcDoc.getSubject();
      if (title) cleanDoc.setTitle(title);
      if (author) cleanDoc.setAuthor(author);
      if (subject) cleanDoc.setSubject(subject);
    }

    targetDoc = cleanDoc;
  }

  if (stripMetadata) {
    applyMetadataToDocument(targetDoc, { stripAll: true });
  }

  assertNotAborted(abortToken);
  onProgress?.(90, 'Compressing object streams...');
  const bytes = await targetDoc.save({
    useObjectStreams,
    addDefaultPage: false
  });

  onProgress?.(100, 'Optimization complete.');
  return {
    bytes,
    originalSize,
    optimizedSize: bytes.byteLength
  };
}
