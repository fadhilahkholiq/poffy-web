import { pdfOpsClient } from '../../core/pdf/worker-client.js';
import { pdfRenderClient } from '../../core/render/pdfjs-client.js';
import { formatBytes, triggerDownload } from '../../core/utils/file-io.js';
import { workspace } from '../../state/workspace.js';

/**
 * Serializes VirtualPage[] into plain worker-safe objects.
 * @param {import('../../state/workspace.js').VirtualPage[]} pages
 */
function serializePages(pages) {
  return pages.map((p) => ({
    id: p.id,
    sourceFileId: p.sourceFileId,
    sourcePageIndex: p.sourcePageIndex,
    rotation: p.rotation,
    cropMargins: p.cropMargins ? { ...p.cropMargins } : null,
    blankSpec: p.blankSpec ? { ...p.blankSpec } : null
  }));
}

/**
 * Runs a background worker job with unified progress, cancellation, and error handling.
 * @param {string} initialStage
 * @param {(onProgress: (pct: number, stage: string) => void, onRequestId: (id: string) => void) => Promise<any>} taskFn
 */
async function runWithProgress(initialStage, taskFn) {
  if (workspace.job.active) return null;
  workspace.setJobStatus({
    active: true,
    requestId: null,
    percent: 5,
    stage: initialStage
  });

  try {
    return await taskFn(
      (percent, stage) => workspace.setJobStatus({ percent, stage }),
      (requestId) => workspace.setJobStatus({ requestId })
    );
  } catch (err) {
    if (err?.code === 'ABORTED_JOB') {
      workspace.showNotice('info', 'Operation Cancelled', 'Background PDF task was cancelled.');
    } else if (err?.code === 'ENCRYPTED_PDF') {
      workspace.showNotice('error', 'Encrypted PDF', err.message);
    } else {
      workspace.showNotice('error', 'Operation Failed', err?.message || 'Could not complete PDF task.');
    }
    return null;
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
 * Cancels the currently active worker job via ABORT_JOB.
 */
export function cancelActiveJob() {
  const reqId = workspace.job.requestId;
  if (!reqId) return;
  if (reqId.startsWith('rnd_')) {
    pdfRenderClient.abortJob(reqId);
  } else {
    pdfOpsClient.abortJob(reqId);
  }
}

/**
 * Compiles and downloads the entire workspace (with active watermark, numbering, metadata, forms, and compression).
 */
export async function exportWorkspacePdf() {
  if (workspace.pages.length === 0) return;

  const wm = workspace.tools.watermark;
  const watermarkConfig = wm.enabled
    ? {
        ...wm,
        imageBytes: wm.imageBytes ? wm.imageBytes.slice(0) : null
      }
    : { enabled: false };

  const firstFile = [...workspace.sourceFiles.values()][0];
  const base = firstFile ? firstFile.name.replace(/\.\w+$/i, '') : 'poffy_studio';

  const result = await runWithProgress('Starting PDF compilation...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'EXPORT_WORKSPACE',
      {
        virtualPages: serializePages(workspace.pages),
        watermarkConfig,
        numberingConfig: { ...workspace.tools.numbering },
        metadataConfig: { ...workspace.tools.metadata },
        formConfig: {
          values: { ...workspace.tools.forms.values },
          flatten: workspace.tools.forms.flatten
        },
        optimizeConfig: { ...workspace.tools.optimize },
        fileName: `${base}_poffy.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'PDF Exported',
      `Saved ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Executes a Split / Extract / Burst operation packaged via fflate when multi-file.
 * @param {'ranges'|'extract'|'every_n'|'burst'} [overrideMode]
 */
export async function runSplitJob(overrideMode) {
  if (workspace.pages.length === 0) return;
  const splitCfg = workspace.tools.split;
  const mode = overrideMode || splitCfg.mode;
  const selectedIndices = workspace.pages
    .map((p, idx) => (p.selected ? idx : -1))
    .filter((idx) => idx >= 0);

  const firstFile = [...workspace.sourceFiles.values()][0];
  const baseName = firstFile ? firstFile.name : 'poffy_document';

  const result = await runWithProgress('Preparing split job...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'SPLIT',
      {
        targetScope: 'workspace',
        virtualPages: serializePages(workspace.pages),
        mode,
        rangeExpression: splitCfg.rangeExpression,
        selectedIndices: mode === 'extract' && selectedIndices.length > 0 ? selectedIndices : [],
        everyN: splitCfg.everyN,
        baseName
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    const count = result.data?.fileCount || 1;
    workspace.showNotice(
      'success',
      count > 1 ? 'Split Archive Ready' : 'PDF Extracted',
      `Downloaded ${result.fileName} (${count} file${count > 1 ? 's' : ''}, ${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Converts all uploaded image files (or selected image pages) directly into a single PDF.
 */
export async function runImagesToPdfJob() {
  const imageSources = [...workspace.sourceFiles.values()].filter((s) => s.type === 'image');
  if (imageSources.length === 0) {
    workspace.showNotice(
      'warning',
      'No Image Files Found',
      'Drop or upload PNG, JPG, or WebP images first to convert them into a PDF.'
    );
    return;
  }

  const { pageFit, margin } = workspace.tools.convert;
  const result = await runWithProgress('Converting images to PDF...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'IMAGES_TO_PDF',
      {
        items: imageSources.map((s) => ({ sourceFileId: s.id })),
        pageFit,
        margin,
        fileName: 'poffy_images.pdf'
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Images Converted to PDF',
      `Saved ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Rasterizes workspace pages via pdfjs-dist + OffscreenCanvas into PNG/JPG/WebP (single file or ZIP).
 */
export async function runPdfToImagesJob() {
  const cfg = workspace.tools.convert;
  const targetPages =
    cfg.selectedOnly && workspace.getTargetPages(false).length > 0
      ? workspace.getTargetPages(false)
      : workspace.pages;

  if (targetPages.length === 0) return;

  const firstFile = [...workspace.sourceFiles.values()][0];
  const baseName = firstFile ? firstFile.name : 'poffy_pages';

  const payloadPages = targetPages.map((p) => {
    if (p.sourceFileId === '__blank__') {
      return { kind: 'blank', rotation: p.rotation };
    }
    const src = workspace.sourceFiles.get(p.sourceFileId);
    if (!src) throw new Error('Missing source file for rasterization.');
    if (src.type === 'image') {
      return {
        kind: 'image',
        imageBuffer: src.buffer.slice(0),
        imageMimeType: src.mimeType,
        rotation: p.rotation
      };
    }
    return {
      kind: 'pdf',
      sourceFileId: src.id,
      sourcePageIndex: p.sourcePageIndex,
      rotation: p.rotation
    };
  });

  const result = await runWithProgress('Rasterizing pages...', (onProgress, onRequestId) =>
    pdfRenderClient.rasterizePages(
      {
        pages: payloadPages,
        format: cfg.exportFormat,
        quality: cfg.exportQuality,
        scale: cfg.exportScale,
        baseName
      },
      onProgress,
      onRequestId
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Images Exported',
      `Saved ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Applies metadata edits or strips all metadata from the selected source PDF.
 * @param {boolean} stripAll
 */
export async function runMetadataJob(stripAll) {
  const meta = workspace.tools.metadata;
  const targetId = meta.targetFileId;
  if (!targetId) {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload a PDF file to edit or scrub metadata.');
    return;
  }

  const config = stripAll
    ? { stripAll: true }
    : {
        stripAll: false,
        title: meta.title,
        author: meta.author,
        subject: meta.subject,
        keywords: meta.keywords,
        creator: meta.creator,
        producer: meta.producer
      };

  const result = await runWithProgress(
    stripAll ? 'Scrubbing all metadata...' : 'Updating PDF metadata...',
    (onProgress, onRequestId) =>
      pdfOpsClient.run(
        'APPLY_META',
        { sourceFileId: targetId, config },
        { onProgress, onRequestId }
      )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    if (stripAll) {
      workspace.hydrateMetadataFields({
        title: '',
        author: '',
        subject: '',
        keywords: '',
        creator: '',
        producer: '',
        creationDate: '',
        modificationDate: ''
      });
    }
    workspace.showNotice(
      'success',
      stripAll ? 'Metadata Stripped' : 'Metadata Updated',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Inspects AcroForm fields of the selected PDF file.
 */
export async function inspectFormsForTarget() {
  const formsState = workspace.tools.forms;
  if (!formsState.targetFileId) return;
  formsState.loading = true;
  workspace.emit('tool');

  try {
    const res = await pdfOpsClient.run('INSPECT_FORMS', {
      sourceFileId: formsState.targetFileId
    });
    formsState.fields = res.data || [];
    formsState.values = {};
    for (const f of formsState.fields) {
      formsState.values[f.name] = f.value;
    }
  } catch (err) {
    workspace.showNotice('error', 'Form Scan Failed', err?.message || 'Unable to inspect form fields.');
  } finally {
    formsState.loading = false;
    workspace.emit('tool');
  }
}

/**
 * Applies form field values and optionally flattens AcroForm fields into static content.
 */
export async function runFormsJob() {
  const formsState = workspace.tools.forms;
  if (!formsState.targetFileId) {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload a PDF file containing form fields first.');
    return;
  }

  const result = await runWithProgress('Applying form changes...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'APPLY_FORMS',
      {
        sourceFileId: formsState.targetFileId,
        config: {
          values: { ...formsState.values },
          flatten: formsState.flatten
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      formsState.flatten ? 'Form Flattened & Saved' : 'Form Saved',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Optimizes the workspace PDF using object streams and orphan-object pruning.
 */
export async function runOptimizeJob() {
  if (workspace.pages.length === 0) return;

  const firstFile = [...workspace.sourceFiles.values()][0];
  const stem = firstFile ? firstFile.name.replace(/\.\w+$/i, '') : 'poffy_studio';

  const result = await runWithProgress('Optimizing PDF structure...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'OPTIMIZE',
      {
        virtualPages: serializePages(workspace.pages),
        config: { ...workspace.tools.optimize },
        fileName: `${stem}_optimized.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    const before = result.data?.originalSize || 0;
    const after = result.data?.optimizedSize || result.resultBuffer.byteLength;
    const pctSaved = before > 0 ? Math.max(0, Math.round(((before - after) / before) * 100)) : 0;
    workspace.showNotice(
      'success',
      'PDF Optimized',
      `Saved ${result.fileName}: ${formatBytes(after)} (${pctSaved}% smaller than ${formatBytes(before)}).`
    );
  }
}
