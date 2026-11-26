import { unzlibSync } from 'fflate';
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString
} from 'pdf-lib';
import { createZipArchive } from '../utils/zip.js';
import { loadPdfSafe } from './doc-loader.js';

/**
 * @typedef {Object} PdfAttachmentEntry
 * @property {string} id - Unique identifier (tree key or index)
 * @property {string} name - UTF-8 filename (/UF fallback /F fallback name-tree key)
 * @property {string} description - /Desc string
 * @property {string} mimeType - Embedded stream /Subtype MIME type
 * @property {number} size - Uncompressed byte length
 * @property {Uint8Array} bytes - Extracted file bytes
 */

/**
 * Decodes a PDFString or PDFHexString safely into JS string.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} val
 * @returns {string}
 */
function decodePdfText(context, val) {
  const resolved = val ? context.lookup(val) : undefined;
  if (resolved instanceof PDFHexString || resolved instanceof PDFString) {
    return resolved.decodeText();
  }
  if (resolved instanceof PDFName) {
    return resolved.decodeText();
  }
  return '';
}

/**
 * Extracts decompressed bytes from an embedded file stream (`/EF -> /UF` or `/EF -> /F`).
 * Decompresses `/FlateDecode` via `fflate.unzlibSync`.
 * @param {import('pdf-lib').PDFContext} context
 * @param {PDFRawStream} stream
 * @returns {Uint8Array}
 */
function extractEmbeddedStreamBytes(context, stream) {
  const filterObj = context.lookup(stream.dict.get(PDFName.of('Filter')));
  let filterName = '';
  if (filterObj instanceof PDFName) {
    filterName = filterObj.decodeText();
  } else if (filterObj instanceof PDFArray && filterObj.size() === 1) {
    const first = context.lookup(filterObj.get(0));
    if (first instanceof PDFName) filterName = first.decodeText();
  }

  if (filterName === 'FlateDecode') {
    return unzlibSync(stream.contents);
  }
  return new Uint8Array(stream.contents);
}

/**
 * Recursively walks a PDF `/EmbeddedFiles` Name Tree (`/Names` leaves & `/Kids` nodes)
 * to collect all file specification entries and embedded file bytes.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} nodeObj
 * @param {PdfAttachmentEntry[]} out
 * @param {Set<any>} [visited=new Set()]
 */
function walkEmbeddedFilesTree(context, nodeObj, out, visited = new Set()) {
  const dict = context.lookup(nodeObj);
  if (!(dict instanceof PDFDict) || visited.has(dict)) return;
  visited.add(dict);

  const namesArr = context.lookup(dict.get(PDFName.of('Names')));
  if (namesArr instanceof PDFArray) {
    for (let i = 0; i + 1 < namesArr.size(); i += 2) {
      const keyName = decodePdfText(context, namesArr.get(i));
      const specDict = context.lookup(namesArr.get(i + 1));
      if (!(specDict instanceof PDFDict)) continue;

      const efDict = context.lookup(specDict.get(PDFName.of('EF')));
      if (!(efDict instanceof PDFDict)) continue;

      const fileStream =
        context.lookup(efDict.get(PDFName.of('UF'))) ||
        context.lookup(efDict.get(PDFName.of('F')));
      if (!(fileStream instanceof PDFRawStream)) continue;

      const filename =
        decodePdfText(context, specDict.get(PDFName.of('UF'))) ||
        decodePdfText(context, specDict.get(PDFName.of('F'))) ||
        keyName ||
        `attachment_${out.length + 1}`;
      const description = decodePdfText(context, specDict.get(PDFName.of('Desc')));
      const rawSubtype = decodePdfText(context, fileStream.dict.get(PDFName.of('Subtype')));
      const mimeType = rawSubtype ? rawSubtype.replace(/^#2F/i, '').replace(/#2F/gi, '/') : 'application/octet-stream';

      let bytes;
      try {
        bytes = extractEmbeddedStreamBytes(context, fileStream);
      } catch {
        bytes = new Uint8Array(fileStream.contents);
      }

      out.push({
        id: `att_${out.length}_${filename}`,
        name: filename,
        description,
        mimeType: mimeType || 'application/octet-stream',
        size: bytes.byteLength,
        bytes
      });
    }
  }

  const kidsArr = context.lookup(dict.get(PDFName.of('Kids')));
  if (kidsArr instanceof PDFArray) {
    for (let i = 0; i < kidsArr.size(); i += 1) {
      walkEmbeddedFilesTree(context, kidsArr.get(i), out, visited);
    }
  }
}

/**
 * Inspects and extracts all embedded file attachments from a PDFDocument.
 * @param {import('pdf-lib').PDFDocument} pdfDoc
 * @returns {PdfAttachmentEntry[]}
 */
export function inspectPdfAttachmentsFromDoc(pdfDoc) {
  const context = pdfDoc.context;
  const namesDict = context.lookup(pdfDoc.catalog.get(PDFName.of('Names')));
  if (!(namesDict instanceof PDFDict)) return [];
  const efTree = namesDict.get(PDFName.of('EmbeddedFiles'));
  if (!efTree) return [];

  /** @type {PdfAttachmentEntry[]} */
  const entries = [];
  walkEmbeddedFilesTree(context, efTree, entries);
  return entries;
}

/**
 * Inspects embedded file attachments directly from raw PDF bytes.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {string} [fileName='']
 * @returns {Promise<PdfAttachmentEntry[]>}
 */
export async function inspectPdfAttachments(pdfBytes, fileName = '') {
  const doc = await loadPdfSafe(pdfBytes, fileName);
  return inspectPdfAttachmentsFromDoc(doc);
}

/**
 * Recursively removes attachment entries whose filename matches `removeNamesSet` from an
 * `/EmbeddedFiles` name tree and deletes orphaned FileSpec & stream objects cleanly.
 * @param {import('pdf-lib').PDFContext} context
 * @param {any} nodeObj
 * @param {Set<string>} removeNamesSet
 * @param {Set<any>} [visited=new Set()]
 */
function pruneEmbeddedFilesTree(context, nodeObj, removeNamesSet, visited = new Set()) {
  const dict = context.lookup(nodeObj);
  if (!(dict instanceof PDFDict) || visited.has(dict)) return;
  visited.add(dict);

  const namesArr = context.lookup(dict.get(PDFName.of('Names')));
  if (namesArr instanceof PDFArray) {
    for (let i = namesArr.size() - 2; i >= 0; i -= 2) {
      const keyText = decodePdfText(context, namesArr.get(i));
      const specRaw = namesArr.get(i + 1);
      const specDict = context.lookup(specRaw);
      let specFilename = keyText;
      if (specDict instanceof PDFDict) {
        specFilename =
          decodePdfText(context, specDict.get(PDFName.of('UF'))) ||
          decodePdfText(context, specDict.get(PDFName.of('F'))) ||
          keyText;
      }

      if (removeNamesSet.has(specFilename) || removeNamesSet.has(keyText)) {
        // Delete indirect embedded stream(s) and filespec ref to prune orphans
        if (specDict instanceof PDFDict) {
          const efDict = context.lookup(specDict.get(PDFName.of('EF')));
          if (efDict instanceof PDFDict) {
            const fRef = efDict.get(PDFName.of('F'));
            const ufRef = efDict.get(PDFName.of('UF'));
            if (fRef instanceof PDFRef) context.delete(fRef);
            if (ufRef instanceof PDFRef && ufRef !== fRef) context.delete(ufRef);
          }
        }
        if (specRaw instanceof PDFRef) {
          context.delete(specRaw);
        }
        namesArr.remove(i + 1);
        namesArr.remove(i);
      }
    }
  }

  const kidsArr = context.lookup(dict.get(PDFName.of('Kids')));
  if (kidsArr instanceof PDFArray) {
    for (let i = 0; i < kidsArr.size(); i += 1) {
      pruneEmbeddedFilesTree(context, kidsArr.get(i), removeNamesSet, visited);
    }
  }
}

/**
 * Updates attachments inside a PDFDocument by removing specified names and attaching new files
 * via `pdfDoc.attach()`, preserving MIME type, description, and UTF-8 filenames.
 * @param {ArrayBuffer|Uint8Array} pdfBytes
 * @param {Object} changes
 * @param {string[]} [changes.removeNames=[]] - Filenames to delete from /EmbeddedFiles
 * @param {{ name: string, bytes: ArrayBuffer|Uint8Array, mimeType?: string, description?: string }[]} [changes.addFiles=[]]
 * @param {string} [fileName='']
 * @returns {Promise<{ bytes: Uint8Array, attachments: PdfAttachmentEntry[] }>}
 */
export async function updatePdfAttachments(pdfBytes, changes = {}, fileName = '') {
  const { removeNames = [], addFiles = [] } = changes;
  const doc = await loadPdfSafe(pdfBytes, fileName);

  if (removeNames.length > 0) {
    const namesDict = doc.context.lookup(doc.catalog.get(PDFName.of('Names')));
    if (namesDict instanceof PDFDict) {
      const efTree = namesDict.get(PDFName.of('EmbeddedFiles'));
      if (efTree) {
        pruneEmbeddedFilesTree(doc.context, efTree, new Set(removeNames));
      }
    }
  }

  for (const file of addFiles) {
    const raw = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    await doc.attach(raw, file.name, {
      mimeType: file.mimeType || 'application/octet-stream',
      description: file.description || '',
      creationDate: new Date(),
      modificationDate: new Date()
    });
  }

  const saved = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  const reloaded = await loadPdfSafe(saved, fileName);
  const finalAttachments = inspectPdfAttachmentsFromDoc(reloaded);

  return {
    bytes: saved,
    attachments: finalAttachments
  };
}

/**
 * Packages extracted attachments into a single `.zip` via `fflate`.
 * @param {{ name: string, bytes: Uint8Array }[]} attachments
 * @param {string} [sourceName='document']
 */
export function packageAttachmentsZip(attachments, sourceName = 'document') {
  const stem = String(sourceName || 'document').replace(/\.pdf$/i, '') || 'document';
  const zipBytes = createZipArchive(
    attachments.map((att) => ({ name: att.name, data: att.bytes })),
    6
  );
  return {
    buffer: zipBytes,
    fileName: `${stem}_attachments.zip`,
    mimeType: 'application/zip'
  };
}
