import { PDFName } from 'pdf-lib';
import { loadPdfSafe } from './doc-loader.js';

/**
 * @typedef {Object} PdfMetadataFields
 * @property {string} title
 * @property {string} author
 * @property {string} subject
 * @property {string} keywords
 * @property {string} creator
 * @property {string} producer
 * @property {string} creationDate - ISO string or empty
 * @property {string} modificationDate - ISO string or empty
 * @property {number} [pageCount]
 */

/**
 * @typedef {Object} MetadataUpdateConfig
 * @property {boolean} [stripAll=false] - Erase all Info dictionary fields and XMP metadata stream
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string} [keywords]
 * @property {string} [creator]
 * @property {string} [producer]
 * @property {string} [creationDate]
 * @property {string} [modificationDate]
 */

/**
 * Formats an optional Date into an ISO date string safely.
 * @param {Date|undefined} date
 * @returns {string}
 */
function toIsoOrEmpty(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

/**
 * Reads Info dictionary metadata from a PDFDocument or raw PDF bytes.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Raw PDF bytes
 * @param {string} [fileName=''] - Optional filename for error context
 * @returns {Promise<PdfMetadataFields>}
 */
export async function inspectPdfMetadata(pdfBytes, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  return {
    title: doc.getTitle() ?? '',
    author: doc.getAuthor() ?? '',
    subject: doc.getSubject() ?? '',
    keywords: doc.getKeywords() ?? '',
    creator: doc.getCreator() ?? '',
    producer: doc.getProducer() ?? '',
    creationDate: toIsoOrEmpty(doc.getCreationDate()),
    modificationDate: toIsoOrEmpty(doc.getModificationDate()),
    pageCount: doc.getPageCount()
  };
}

/**
 * Applies metadata edits or strips all metadata/XMP streams on a PDFDocument in place.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {MetadataUpdateConfig} config - Update or strip configuration
 * @returns {import('pdf-lib').PDFDocument}
 */
export function applyMetadataToDocument(pdfDoc, config) {
  if (!config) return pdfDoc;

  if (config.stripAll) {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');

    // Remove Info dictionary reference and XMP Metadata stream if present
    const trailer = pdfDoc.context.trailerInfo;
    if (trailer && trailer.Info) {
      delete trailer.Info;
    }
    const metadataRef = PDFName.of('Metadata');
    if (pdfDoc.catalog.has(metadataRef)) {
      pdfDoc.catalog.delete(metadataRef);
    }
    return pdfDoc;
  }

  if (config.title !== undefined) pdfDoc.setTitle(String(config.title));
  if (config.author !== undefined) pdfDoc.setAuthor(String(config.author));
  if (config.subject !== undefined) pdfDoc.setSubject(String(config.subject));
  if (config.keywords !== undefined) {
    const kwList = String(config.keywords)
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    pdfDoc.setKeywords(kwList);
  }
  if (config.creator !== undefined) pdfDoc.setCreator(String(config.creator));
  if (config.producer !== undefined) pdfDoc.setProducer(String(config.producer));
  if (config.creationDate) {
    const d = new Date(config.creationDate);
    if (!Number.isNaN(d.getTime())) pdfDoc.setCreationDate(d);
  }
  if (config.modificationDate) {
    const d = new Date(config.modificationDate);
    if (!Number.isNaN(d.getTime())) pdfDoc.setModificationDate(d);
  }

  return pdfDoc;
}

/**
 * Convenience helper to edit or scrub metadata directly on a PDF buffer.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {MetadataUpdateConfig} config
 * @param {string} [fileName='']
 * @returns {Promise<Uint8Array>}
 */
export async function updatePdfMetadata(pdfBytes, config, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName, { updateMetadata: !config?.stripAll });
  applyMetadataToDocument(doc, config);
  return doc.save({
    useObjectStreams: true,
    updateFieldAppearances: false
  });
}
