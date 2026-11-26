import { pdfOpsClient } from '../../core/pdf/worker-client.js';
import { pdfRenderClient } from '../../core/render/pdfjs-client.js';
import { readFileAsArrayBuffer } from '../../core/utils/file-io.js';
import { createUuid, workspace } from '../../state/workspace.js';

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

/**
 * Checks whether a File is a supported PDF or raster image.
 * @param {File} file
 * @returns {'pdf'|'image'|null}
 */
function classifyFile(file) {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    SUPPORTED_IMAGE_TYPES.has(type) ||
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.webp')
  ) {
    return 'image';
  }
  return null;
}

/**
 * Reads, validates, registers, and adds one or more PDF/image files into the workspace.
 * Catches EncryptedPdfError cleanly so password-protected PDFs never crash the UI.
 * @param {FileList|File[]} fileList
 * @returns {Promise<void>}
 */
export async function ingestFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const valid = [];
  const rejected = [];
  for (const f of files) {
    const kind = classifyFile(f);
    if (kind) valid.push({ file: f, kind });
    else rejected.push(f.name);
  }

  if (rejected.length > 0) {
    workspace.showNotice(
      'warning',
      'Unsupported file skipped',
      `Skipped unsupported file(s): ${rejected.join(', ')}. Supported formats: PDF, PNG, JPG, WebP.`
    );
  }

  if (valid.length === 0) return;

  workspace.setJobStatus({
    active: true,
    requestId: null,
    percent: 10,
    stage: `Loading ${valid.length} file${valid.length > 1 ? 's' : ''} locally...`
  });

  try {
    for (let i = 0; i < valid.length; i += 1) {
      const { file, kind } = valid[i];
      workspace.setJobStatus({
        percent: Math.round(((i + 0.5) / valid.length) * 85),
        stage: `Parsing ${file.name}...`
      });

      const buffer = await readFileAsArrayBuffer(file);
      const id = createUuid();

      if (kind === 'pdf') {
        // Load into render.worker.js first (fast check for encryption + page count)
        const pageCount = await pdfRenderClient.loadPdfDocument(id, buffer, file.name);
        /** @type {import('../../state/workspace.js').SourceFileEntry} */
        const entry = {
          id,
          name: file.name,
          type: 'pdf',
          mimeType: 'application/pdf',
          buffer,
          pageCount,
          metadata: {}
        };
        await pdfOpsClient.registerSource(entry);
        // Extract metadata safely (also validates pdf-lib non-encrypted parse)
        const metaRes = await pdfOpsClient.run('INSPECT_META', { sourceFileId: id });
        entry.metadata = metaRes.data || {};
        workspace.addSourceFile(entry);
      } else {
        /** @type {import('../../state/workspace.js').SourceFileEntry} */
        const entry = {
          id,
          name: file.name,
          type: 'image',
          mimeType: file.type || 'image/png',
          buffer,
          pageCount: 1,
          metadata: {}
        };
        await pdfOpsClient.registerSource(entry);
        workspace.addSourceFile(entry);
      }
    }
  } catch (err) {
    if (err?.code === 'ENCRYPTED_PDF' || err?.name === 'EncryptedPdfError') {
      workspace.showNotice(
        'error',
        'Password-Protected PDF Detected',
        err.message ||
          'This PDF is encrypted. Unlock or remove its password locally before loading it into Poffy.'
      );
    } else {
      workspace.showNotice(
        'error',
        'Failed to load file',
        err?.message || 'An unexpected error occurred while reading the document.'
      );
    }
  } finally {
    workspace.setJobStatus({
      active: false,
      requestId: null,
      percent: 0,
      stage: ''
    });
  }
}

/**
 * Attaches drag-and-drop file ingestion listeners to an element (dropzone or workspace).
 * Only triggers for external OS file drops (ignores internal page-reorder drags).
 * @param {HTMLElement} targetEl
 * @param {(active: boolean) => void} [onDragState]
 * @returns {() => void} Cleanup function
 */
export function bindFileDropzone(targetEl, onDragState) {
  let depth = 0;

  const isExternalFileDrag = (e) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files') && !Array.from(types).includes('application/x-poffy-page');
  };

  const handleDragEnter = (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    depth += 1;
    targetEl.classList.add('is-dragover');
    onDragState?.(true);
  };

  const handleDragOver = (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      targetEl.classList.remove('is-dragover');
      onDragState?.(false);
    }
  };

  const handleDrop = async (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    depth = 0;
    targetEl.classList.remove('is-dragover');
    onDragState?.(false);
    if (e.dataTransfer?.files?.length) {
      await ingestFiles(e.dataTransfer.files);
    }
  };

  targetEl.addEventListener('dragenter', handleDragEnter);
  targetEl.addEventListener('dragover', handleDragOver);
  targetEl.addEventListener('dragleave', handleDragLeave);
  targetEl.addEventListener('drop', handleDrop);

  return () => {
    targetEl.removeEventListener('dragenter', handleDragEnter);
    targetEl.removeEventListener('dragover', handleDragOver);
    targetEl.removeEventListener('dragleave', handleDragLeave);
    targetEl.removeEventListener('drop', handleDrop);
  };
}
