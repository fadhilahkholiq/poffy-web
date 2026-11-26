import { PDFArray, PDFDict, PDFName, PDFStream } from 'pdf-lib';
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
 * @typedef {Object} DeepScrubOptions
 * @property {boolean} [scrubInfo=true] - Clear Info dictionary fields and trailer reference
 * @property {boolean} [purgeXmp=true] - Delete /Metadata XMP XML stream from catalog
 * @property {boolean} [removeThumbnails=true] - Delete /Thumb embedded page thumbnails
 * @property {boolean} [stripScriptsAndActions=true] - Delete /OpenAction, /AA, and /Names -> /JavaScript
 */

/**
 * @typedef {Object} PrivacyAuditReport
 * @property {PdfMetadataFields} info
 * @property {number} infoFieldCount - Non-empty standard Info dictionary fields
 * @property {number} xmpSizeBytes - Byte length of catalog /Metadata stream (0 if absent)
 * @property {number} thumbnailCount - Number of pages carrying /Thumb entries
 * @property {boolean} openActionPresent - Whether catalog /OpenAction exists
 * @property {number} additionalActionsCount - Count of /AA dicts on catalog and page nodes
 * @property {number} javascriptCount - Count of /JavaScript name tree entries + JS action references
 * @property {number} pageCount
 */

/**
 * @typedef {Object} MetadataUpdateConfig
 * @property {boolean} [stripAll=false] - Run deep privacy scrub (Info + XMP + Thumbs + Scripts/Actions)
 * @property {DeepScrubOptions} [scrubOptions] - Granular deep scrub toggles
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
 * Extracts standard Info dictionary fields from a loaded PDFDocument.
 * @param {import('pdf-lib').PDFDocument} doc
 * @returns {PdfMetadataFields}
 */
function extractInfoFields(doc) {
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
 * Counts entries inside a PDF Name Tree (such as /Names -> /JavaScript).
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} nodeObj
 * @param {Set<any>} [visited=new Set()]
 * @returns {number}
 */
function countNameTreeEntries(context, nodeObj, visited = new Set()) {
  const dict = context.lookup(nodeObj);
  if (!(dict instanceof PDFDict) || visited.has(dict)) return 0;
  visited.add(dict);

  let count = 0;
  const namesArr = context.lookup(dict.get(PDFName.of('Names')));
  if (namesArr instanceof PDFArray) {
    count += Math.floor(namesArr.size() / 2);
  }
  const kidsArr = context.lookup(dict.get(PDFName.of('Kids')));
  if (kidsArr instanceof PDFArray) {
    for (let i = 0; i < kidsArr.size(); i += 1) {
      count += countNameTreeEntries(context, kidsArr.get(i), visited);
    }
  }
  return count;
}

/**
 * Checks whether an action dict (or ref) triggers JavaScript (/S /JavaScript or /JS).
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} actionObj
 * @returns {boolean}
 */
function isJavaScriptAction(context, actionObj) {
  const resolved = context.lookup(actionObj);
  if (!(resolved instanceof PDFDict)) return false;
  const s = context.lookup(resolved.get(PDFName.of('S')));
  return s === PDFName.of('JavaScript') || resolved.has(PDFName.of('JS'));
}

/**
 * Reads Info dictionary metadata from raw PDF bytes.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Raw PDF bytes
 * @param {string} [fileName=''] - Optional filename for error context
 * @returns {Promise<PdfMetadataFields>}
 */
export async function inspectPdfMetadata(pdfBytes, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  return extractInfoFields(doc);
}

/**
 * Performs a deep pre-scrub privacy audit across Info dictionary, XMP XML stream,
 * embedded page thumbnails, /OpenAction, /AA, and /Names -> /JavaScript.
 * @param {ArrayBuffer|Uint8Array} pdfBytes - Raw PDF bytes
 * @param {string} [fileName=''] - Optional filename for error context
 * @returns {Promise<PrivacyAuditReport>}
 */
export async function inspectPdfPrivacyAudit(pdfBytes, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  const context = doc.context;
  const info = extractInfoFields(doc);

  const infoFieldCount = [
    info.title,
    info.author,
    info.subject,
    info.keywords,
    info.creator,
    info.producer,
    info.creationDate,
    info.modificationDate
  ].filter((v) => String(v).trim().length > 0).length;

  let xmpSizeBytes = 0;
  const xmpObj = context.lookup(doc.catalog.get(PDFName.of('Metadata')));
  if (xmpObj instanceof PDFStream) {
    xmpSizeBytes = xmpObj.getContents().byteLength;
  }

  let thumbnailCount = 0;
  let additionalActionsCount = 0;
  let javascriptCount = 0;

  const openActionPresent = doc.catalog.has(PDFName.of('OpenAction'));
  if (openActionPresent && isJavaScriptAction(context, doc.catalog.get(PDFName.of('OpenAction')))) {
    javascriptCount += 1;
  }

  if (doc.catalog.has(PDFName.of('AA'))) {
    additionalActionsCount += 1;
    const catAA = context.lookup(doc.catalog.get(PDFName.of('AA')));
    if (catAA instanceof PDFDict) {
      for (const [, val] of catAA.entries()) {
        if (isJavaScriptAction(context, val)) javascriptCount += 1;
      }
    }
  }

  const namesDict = context.lookup(doc.catalog.get(PDFName.of('Names')));
  if (namesDict instanceof PDFDict && namesDict.has(PDFName.of('JavaScript'))) {
    javascriptCount += Math.max(1, countNameTreeEntries(context, namesDict.get(PDFName.of('JavaScript'))));
  }

  for (const page of doc.getPages()) {
    if (page.node.has(PDFName.of('Thumb'))) {
      thumbnailCount += 1;
    }
    if (page.node.has(PDFName.of('AA'))) {
      additionalActionsCount += 1;
      const pageAA = context.lookup(page.node.get(PDFName.of('AA')));
      if (pageAA instanceof PDFDict) {
        for (const [, val] of pageAA.entries()) {
          if (isJavaScriptAction(context, val)) javascriptCount += 1;
        }
      }
    }
  }

  return {
    info,
    infoFieldCount,
    xmpSizeBytes,
    thumbnailCount,
    openActionPresent,
    additionalActionsCount,
    javascriptCount,
    pageCount: doc.getPageCount()
  };
}

/**
 * Reusable deep privacy scrubber for PDFDocument instances.
 * Removes Info dictionary, XMP XML stream, page /Thumb entries, /OpenAction, /AA, and /Names -> /JavaScript.
 * Exported directly so FEAT-01 (Paranoid Mode) and Metadata Scrubber share one audited routine.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {DeepScrubOptions} [options={}] - Category toggles (all enabled by default)
 * @returns {import('pdf-lib').PDFDocument}
 */
export function deepScrubPdf(pdfDoc, options = {}) {
  const {
    scrubInfo = true,
    purgeXmp = true,
    removeThumbnails = true,
    stripScriptsAndActions = true
  } = options;

  const context = pdfDoc.context;

  if (scrubInfo) {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');

    const trailer = context.trailerInfo;
    if (trailer && trailer.Info) {
      delete trailer.Info;
    }
  }

  if (purgeXmp) {
    const metadataRef = PDFName.of('Metadata');
    if (pdfDoc.catalog.has(metadataRef)) {
      pdfDoc.catalog.delete(metadataRef);
    }
    for (const page of pdfDoc.getPages()) {
      if (page.node.has(metadataRef)) {
        page.node.delete(metadataRef);
      }
    }
  }

  if (removeThumbnails) {
    const thumbName = PDFName.of('Thumb');
    for (const page of pdfDoc.getPages()) {
      if (page.node.has(thumbName)) {
        page.node.delete(thumbName);
      }
    }
  }

  if (stripScriptsAndActions) {
    const openActionName = PDFName.of('OpenAction');
    const aaName = PDFName.of('AA');
    if (pdfDoc.catalog.has(openActionName)) {
      pdfDoc.catalog.delete(openActionName);
    }
    if (pdfDoc.catalog.has(aaName)) {
      pdfDoc.catalog.delete(aaName);
    }

    const namesDict = context.lookup(pdfDoc.catalog.get(PDFName.of('Names')));
    if (namesDict instanceof PDFDict && namesDict.has(PDFName.of('JavaScript'))) {
      namesDict.delete(PDFName.of('JavaScript'));
    }

    for (const page of pdfDoc.getPages()) {
      if (page.node.has(aaName)) {
        page.node.delete(aaName);
      }
    }
  }

  return pdfDoc;
}

/**
 * Applies metadata edits or strips metadata/XMP/scripts on a PDFDocument in place.
 * Preserves full backward compatibility with `stripAll: true` and field-editing configs.
 * @param {import('pdf-lib').PDFDocument} pdfDoc - Target document
 * @param {MetadataUpdateConfig} config - Update or strip configuration
 * @returns {import('pdf-lib').PDFDocument}
 */
export function applyMetadataToDocument(pdfDoc, config) {
  if (!config) return pdfDoc;

  if (config.stripAll) {
    deepScrubPdf(pdfDoc, config.scrubOptions || {
      scrubInfo: true,
      purgeXmp: true,
      removeThumbnails: true,
      stripScriptsAndActions: true
    });
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

  if (config.scrubOptions) {
    deepScrubPdf(pdfDoc, {
      scrubInfo: Boolean(config.scrubOptions.scrubInfo),
      purgeXmp: Boolean(config.scrubOptions.purgeXmp),
      removeThumbnails: Boolean(config.scrubOptions.removeThumbnails),
      stripScriptsAndActions: Boolean(config.scrubOptions.stripScriptsAndActions)
    });
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
  const doc = await loadPdfSafe(pdfBytes, fileName, {
    updateMetadata: !(config?.stripAll || config?.scrubOptions?.scrubInfo)
  });
  applyMetadataToDocument(doc, config);
  return doc.save({
    useObjectStreams: true,
    updateFieldAppearances: false
  });
}
