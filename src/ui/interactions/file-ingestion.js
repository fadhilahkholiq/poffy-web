import { pdfOpsClient } from '../../core/pdf/worker-client.js';
import { pdfRenderClient } from '../../core/render/pdfjs-client.js';
import { readFileAsArrayBuffer } from '../../core/utils/file-io.js';
import { createUuid, workspace } from '../../state/workspace.js';
import { el, svgEl } from '../utils/dom.js';

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
        // Run deep privacy audit (also extracts standard Info fields + validates pdf-lib parse)
        const auditRes = await pdfOpsClient.run('INSPECT_PRIVACY_AUDIT', { sourceFileId: id });
        entry.audit = auditRes.data || null;
        entry.metadata = auditRes.data?.info || {};
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

/**
 * Installs a sleek macOS-style translucent blue full-window file drop overlay
 * triggered whenever external OS files are dragged anywhere over the browser window.
 * @returns {() => void} Cleanup callback
 */
export function bindWindowDropOverlay() {
  let dragDepth = 0;

  const isExternalFileDrag = (e) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files') && !Array.from(types).includes('application/x-poffy-page');
  };

  const overlay = el(
    'div',
    {
      id: 'window-drop-overlay',
      className:
        'fixed inset-0 z-[70] hidden items-center justify-center p-6 bg-[#0071e3]/12 backdrop-blur-[14px] pointer-events-none transition-opacity duration-150',
      'aria-hidden': 'true'
    },
    el(
      'div',
      {
        className:
          'w-full max-w-[440px] rounded-[24px] bg-white/95 border-2 border-dashed border-[#0071e3] shadow-[0_24px_64px_rgba(0,113,227,0.18)] px-8 py-10 text-center space-y-3'
      },
      el(
        'div',
        {
          className:
            'w-12 h-12 mx-auto rounded-[14px] bg-[#e8f2ff] text-[#0071e3] flex items-center justify-center'
        },
        svgEl(
          'svg',
          {
            width: 24,
            height: 24,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': 2.1,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
          },
          svgEl('path', { d: 'M12 16V4' }),
          svgEl('path', { d: 'm7 9 5-5 5 5' }),
          svgEl('path', { d: 'M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3' })
        )
      ),
      el('p', { className: 'text-[18px] font-semibold text-[#1d1d1f] tracking-[-0.015em]' }, 'Drop to open in Poffy'),
      el('p', { className: 'text-[13.5px] text-[#6e6e73]' }, 'PDF, PNG, JPG, or WebP • 100% offline')
    )
  );

  document.body.appendChild(overlay);

  const showOverlay = () => {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
  };

  const hideOverlay = () => {
    dragDepth = 0;
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
  };

  const onDragEnter = (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    dragDepth += 1;
    showOverlay();
  };

  const onDragOver = (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e) => {
    if (!isExternalFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideOverlay();
  };

  const onDrop = async (e) => {
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    hideOverlay();
    // Avoid double-ingesting if an inner dropzone already handled the drop
    if (/** @type {HTMLElement|null} */ (e.target)?.closest?.('#hero-dropzone, #workspace-drop-area')) {
      return;
    }
    if (e.dataTransfer?.files?.length) {
      await ingestFiles(e.dataTransfer.files);
    }
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
  window.addEventListener('blur', hideOverlay);

  return () => {
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('drop', onDrop);
    window.removeEventListener('blur', hideOverlay);
    overlay.remove();
  };
}
