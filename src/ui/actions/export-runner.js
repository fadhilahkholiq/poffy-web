import { pdfOpsClient } from '../../core/pdf/worker-client.js';
import { pdfRenderClient } from '../../core/render/pdfjs-client.js';
import { ObjectUrlTracker, formatBytes, readFileAsArrayBuffer, triggerDownload } from '../../core/utils/file-io.js';
import { createUuid, workspace } from '../../state/workspace.js';

const toolPreviewTracker = new ObjectUrlTracker();
const compareUrlTracker = new ObjectUrlTracker();
const extractUrlTracker = new ObjectUrlTracker();
let filterPreviewSeq = 0;

const resetToolPreviews = () => {
  toolPreviewTracker.revokeAll();
  compareUrlTracker.revokeAll();
  extractUrlTracker.revokeAll();
  filterPreviewSeq += 1;
  workspace.tools.spreads.previewUrl = null;
  workspace.tools.spreads.previewKey = '';
  workspace.tools.spreads.previewLoading = false;
  workspace.tools.filters.previewOriginalUrl = null;
  workspace.tools.filters.previewFilteredUrl = null;
  workspace.tools.filters.previewLoading = false;
  workspace.tools.filters.previewOtsuThreshold = null;
  workspace.tools.redact.previewUrl = null;
  workspace.tools.redact.previewPageIndex = -1;
  workspace.tools.redact.previewLoading = false;
  workspace.tools.sign.previewUrl = null;
  workspace.tools.sign.previewPageIndex = -1;
  workspace.tools.sign.previewLoading = false;
  workspace.tools.extractImages.items = [];
  workspace.tools.bookmarks.previewUrl = null;
  workspace.tools.bookmarks.previewLoadedIdx = -1;
  workspace.tools.bookmarks.previewLoading = false;
};

workspace.onWorkspaceClear(resetToolPreviews);
workspace.onSourceEvict(resetToolPreviews);

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
      (percent, stage, current, total) =>
        workspace.setJobStatus({ percent, stage, current: current || 0, total: total || 0 }),
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
      stage: '',
      current: 0,
      total: 0
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
        autoBookmarks: Boolean(workspace.tools.organize.autoBookmarks),
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
 * Runs a pre-scrub Privacy Audit on the selected Metadata target PDF.
 */
export async function runPrivacyAuditForTarget() {
  const meta = workspace.tools.metadata;
  if (!meta.targetFileId) return;
  meta.auditLoading = true;
  workspace.emit('tool');

  try {
    const res = await pdfOpsClient.run('INSPECT_PRIVACY_AUDIT', {
      sourceFileId: meta.targetFileId
    });
    meta.audit = res.data || null;
    if (res.data?.info) {
      workspace.hydrateMetadataFields(res.data.info);
    }
    const entry = workspace.sourceFiles.get(meta.targetFileId);
    if (entry) {
      entry.audit = meta.audit;
      entry.metadata = res.data?.info || entry.metadata;
    }
  } catch (err) {
    workspace.showNotice('error', 'Privacy Audit Failed', err?.message || 'Unable to inspect PDF.');
  } finally {
    meta.auditLoading = false;
    workspace.emit('tool');
  }
}

/**
 * Applies metadata edits or runs granular deep privacy scrub on the selected source PDF.
 * @param {boolean|'scrub-selected'|'scrub-all'} mode
 */
export async function runMetadataJob(mode) {
  const meta = workspace.tools.metadata;
  const targetId = meta.targetFileId;
  if (!targetId) {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload a PDF file to edit or scrub metadata.');
    return;
  }

  const stripAll = mode === true || mode === 'scrub-all';
  const useGranularScrub = mode === 'scrub-selected';

  const config = stripAll
    ? {
        stripAll: true,
        scrubOptions: {
          scrubInfo: true,
          purgeXmp: true,
          removeThumbnails: true,
          stripScriptsAndActions: true
        }
      }
    : useGranularScrub
      ? {
          stripAll: true,
          scrubOptions: { ...meta.scrubOptions }
        }
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
    stripAll || useGranularScrub ? 'Scrubbing metadata, XMP & scripts...' : 'Updating PDF metadata...',
    (onProgress, onRequestId) =>
      pdfOpsClient.run(
        'APPLY_META',
        { sourceFileId: targetId, config },
        { onProgress, onRequestId }
      )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    if (stripAll || (useGranularScrub && meta.scrubOptions.scrubInfo)) {
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
      stripAll || useGranularScrub ? 'Privacy Scrub Complete' : 'Metadata Updated',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Runs worker-side Auto-Crop Whitespace analysis and pushes computed margins onto undo history.
 */
export async function runAutoCropJob() {
  const org = workspace.tools.organize;
  const selected = workspace.getTargetPages(false);
  const targetPages =
    org.autoCropScope === 'selected' && selected.length > 0 ? selected : workspace.pages;

  if (targetPages.length === 0) return;

  const paddingPt =
    org.autoCropUnit === 'mm'
      ? Math.round((Number(org.autoCropPadding) || 0) * 2.83465)
      : Number(org.autoCropPadding) || 0;

  const res = await runWithProgress('Scanning pages for whitespace...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'AUTO_CROP',
      {
        targetPages: serializePages(targetPages),
        paddingPt,
        threshold: Number(org.autoCropThreshold) || 245,
        mode: org.autoCropMode || 'uniform'
      },
      { onProgress, onRequestId }
    )
  );

  if (res?.data) {
    org.autoCropModalOpen = false;
    workspace.applyAutoCropResult(res.data.marginsByPageId);
    workspace.emit('tool');
    workspace.showNotice(
      'success',
      'Auto-Crop Applied',
      `Updated crop margins on ${res.data.scannedCount} page${
        res.data.scannedCount === 1 ? '' : 's'
      } (${org.autoCropMode === 'uniform' ? 'Uniform' : 'Per-Page'}).`
    );
  }
}

/**
 * Runs Batch Bates Numbering across the ordered PDF queue and downloads a ZIP archive.
 */
export async function runBatchBatesJob() {
  const n = workspace.tools.numbering;
  const validIds = n.batesQueue.filter((id) => workspace.sourceFiles.get(id)?.type === 'pdf');
  if (validIds.length === 0) {
    workspace.showNotice(
      'warning',
      'Bates Queue Empty',
      'Add at least one PDF file to the Batch Bates queue.'
    );
    return;
  }

  const result = await runWithProgress('Stamping Bates numbers...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'BATCH_BATES',
      {
        sourceIds: validIds,
        config: {
          prefix: n.batesPrefix,
          suffix: n.batesSuffix,
          padding: n.batesPadding,
          startNumber: n.batesStart,
          template: n.batesTemplate,
          placement: n.batesPlacement,
          alignment: n.batesAlignment,
          marginX: n.marginX,
          marginY: n.marginY,
          fontSize: n.fontSize,
          fontFamily: n.fontFamily,
          color: n.color,
          opacity: n.opacity,
          includeCsvManifest: n.batesIncludeCsv,
          skipCover: n.skipCover
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    const totalStamped = result.data?.totalPagesStamped || 0;
    const fileCount = result.data?.fileCount || validIds.length;
    workspace.showNotice(
      'success',
      'Batch Bates ZIP Ready',
      `Stamped ${totalStamped} pages across ${fileCount} PDF${fileCount > 1 ? 's' : ''} (${formatBytes(
        result.resultBuffer.byteLength
      )}).`
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
    const pctSaved = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
    workspace.tools.optimize.lastStats = {
      originalSize: before,
      optimizedSize: after,
      pctSaved,
      recompressedImages: result.data?.recompressedImages || 0,
      skippedImages: result.data?.skippedImages || 0,
      preset: result.data?.preset || workspace.tools.optimize.preset,
      fileName: result.fileName
    };
    workspace.emit('tool');
    workspace.showNotice(
      'success',
      'PDF Optimized',
      `Saved ${result.fileName}: ${formatBytes(after)} (${pctSaved >= 0 ? `${pctSaved}% smaller` : `${Math.abs(pctSaved)}% diff`} vs ${formatBytes(before)}).`
    );
  }
}

/**
 * Standardizes all workspace pages to a uniform preset/custom paper size (FEAT-04).
 */
export async function runResizePdfJob() {
  if (workspace.pages.length === 0) return;

  const firstFile = [...workspace.sourceFiles.values()][0];
  const stem = firstFile ? firstFile.name.replace(/\.\w+$/i, '') : 'poffy_studio';
  const cfg = workspace.tools.resize;

  const result = await runWithProgress('Standardizing page sizes...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'RESIZE_PDF',
      {
        virtualPages: serializePages(workspace.pages),
        config: { ...cfg },
        fileName: `${stem}_resized_${cfg.preset}.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Pages Resized',
      `Saved ${result.fileName} (${result.data?.pageCount || workspace.pages.length} pages, ${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}

/**
 * Imposes workspace pages into N-Up sheets or Saddle-Stitch Booklet spreads (FEAT-05).
 */
export async function runImpositionJob() {
  if (workspace.pages.length === 0) return;

  const firstFile = [...workspace.sourceFiles.values()][0];
  const stem = firstFile ? firstFile.name.replace(/\.\w+$/i, '') : 'poffy_studio';
  const cfg = workspace.tools.nup;
  const suffix = cfg.mode === 'booklet' ? 'booklet' : `${cfg.nUp}up`;

  const result = await runWithProgress(
    cfg.mode === 'booklet' ? 'Imposing saddle-stitch booklet...' : `Building ${cfg.nUp}-Up grid sheets...`,
    (onProgress, onRequestId) =>
      pdfOpsClient.run(
        'NUP_BOOKLET',
        {
          virtualPages: serializePages(workspace.pages),
          config: { ...cfg },
          fileName: `${stem}_${suffix}.pdf`
        },
        { onProgress, onRequestId }
      )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    const sheets = result.data?.sheetCount || 0;
    workspace.showNotice(
      'success',
      cfg.mode === 'booklet' ? 'Booklet Imposed' : 'N-Up PDF Ready',
      `Saved ${result.fileName} (${sheets} sheet${sheets === 1 ? '' : 's'}, ${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}

/**
 * Loads a preview image ObjectURL for the Split Spreads interactive divider widget (FEAT-06).
 */
export async function loadSpreadsPreview() {
  const sp = workspace.tools.spreads;
  const total = workspace.pages.length;
  if (total === 0) return;

  const idx = Math.max(0, Math.min(total - 1, Number(sp.previewPageIndex) || 0));
  sp.previewPageIndex = idx;
  const page = workspace.pages[idx];
  const key = `${page.id}:${page.rotation}`;
  if (sp.previewKey === key && sp.previewUrl) return;

  if (sp.previewUrl) {
    toolPreviewTracker.revoke(sp.previewUrl);
    sp.previewUrl = null;
  }

  if (page.sourceFileId === '__blank__') {
    sp.previewKey = key;
    sp.previewLoading = false;
    workspace.emit('tool');
    return;
  }

  const src = workspace.sourceFiles.get(page.sourceFileId);
  if (!src) return;

  sp.previewLoading = true;
  sp.previewKey = key;
  workspace.emit('tool');

  try {
    let url;
    if (src.type === 'image') {
      url = toolPreviewTracker.create(new Blob([src.buffer], { type: src.mimeType || 'image/png' }));
    } else {
      await pdfRenderClient.ensureDocumentLoaded(src.id);
      const res = await pdfRenderClient.request('RENDER_PREVIEW', {
        sourceFileId: src.id,
        pageIndex: page.sourcePageIndex,
        scale: 1.2,
        rotation: page.rotation || 0
      });
      url = toolPreviewTracker.create(
        new Blob([res.resultBuffer], { type: res.mimeType || 'image/webp' })
      );
    }

    if (workspace.tools.spreads.previewKey === key) {
      sp.previewUrl = url;
    } else {
      toolPreviewTracker.revoke(url);
    }
  } catch (err) {
    workspace.showNotice('error', 'Preview Failed', err?.message || 'Unable to render spread preview.');
  } finally {
    sp.previewLoading = false;
    workspace.emit('tool');
  }
}

/**
 * Splits book spreads cleanly by updating CropBox and MediaBox via copyPages() (FEAT-06).
 */
export async function runSplitSpreadsJob() {
  if (workspace.pages.length === 0) return;

  const firstFile = [...workspace.sourceFiles.values()][0];
  const stem = firstFile ? firstFile.name.replace(/\.\w+$/i, '') : 'poffy_studio';
  const cfg = workspace.tools.spreads;

  const result = await runWithProgress('Splitting book spreads...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'SPLIT_SPREADS',
      {
        virtualPages: serializePages(workspace.pages),
        config: {
          axis: cfg.axis,
          splitRatio: cfg.splitRatio,
          readingOrder: cfg.readingOrder,
          skipFirstPage: cfg.skipFirstPage,
          skipLastPage: cfg.skipLastPage,
          landscapeOnly: cfg.landscapeOnly
        },
        fileName: `${stem}_split_spreads.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Spreads Split',
      `Saved ${result.fileName} (${result.data?.outputPages || 0} output pages from ${
        result.data?.inputPages || workspace.pages.length
      }, ${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Generates fast live side-by-side single-page preview for Color & Scan Cleanup Filters (FEAT-07).
 * Uses sequence tracking and ObjectUrlTracker to avoid stale updates or URL leaks.
 */
export async function requestColorFilterPreview() {
  const flt = workspace.tools.filters;
  const total = workspace.pages.length;
  if (total === 0) return;

  const idx = Math.max(0, Math.min(total - 1, Number(flt.previewPageIndex) || 0));
  flt.previewPageIndex = idx;
  const page = workspace.pages[idx];
  const seq = ++filterPreviewSeq;

  flt.previewLoading = true;
  workspace.emit('filter-preview');

  try {
    const res = await pdfOpsClient.run('PREVIEW_COLOR_FILTER', {
      virtualPage: serializePages([page])[0],
      config: {
        preset: flt.preset,
        invertVariant: flt.invertVariant,
        contrast: flt.contrast,
        threshold: flt.threshold,
        autoOtsu: flt.autoOtsu,
        binarize: flt.binarize
      }
    });

    if (seq !== filterPreviewSeq) return;

    const nextOrigUrl = res.data?.originalBuffer
      ? toolPreviewTracker.create(new Blob([res.data.originalBuffer], { type: 'image/webp' }))
      : null;
    const nextFilteredUrl = res.resultBuffer
      ? toolPreviewTracker.create(new Blob([res.resultBuffer], { type: res.mimeType || 'image/jpeg' }))
      : null;

    if (flt.previewOriginalUrl) toolPreviewTracker.revoke(flt.previewOriginalUrl);
    if (flt.previewFilteredUrl) toolPreviewTracker.revoke(flt.previewFilteredUrl);

    flt.previewOriginalUrl = nextOrigUrl;
    flt.previewFilteredUrl = nextFilteredUrl;
    flt.previewOtsuThreshold = res.data?.otsuThreshold ?? null;
  } catch (err) {
    if (seq === filterPreviewSeq) {
      workspace.showNotice('error', 'Filter Preview Failed', err?.message || 'Unable to preview filter.');
    }
  } finally {
    if (seq === filterPreviewSeq) {
      flt.previewLoading = false;
      workspace.emit('filter-preview');
    }
  }
}

/**
 * Applies Grayscale, Invert/Dark Mode, or Scan Cleanup Filters across all workspace pages (FEAT-07).
 */
export async function runColorFiltersJob() {
  if (workspace.pages.length === 0) return;

  const firstFile = [...workspace.sourceFiles.values()][0];
  const stem = firstFile ? firstFile.name.replace(/\.\w+$/i, '') : 'poffy_studio';
  const flt = workspace.tools.filters;

  const result = await runWithProgress(
    `Applying ${flt.preset} filter across ${workspace.pages.length} pages...`,
    (onProgress, onRequestId) =>
      pdfOpsClient.run(
        'COLOR_FILTERS',
        {
          virtualPages: serializePages(workspace.pages),
          config: {
            preset: flt.preset,
            invertVariant: flt.invertVariant,
            contrast: flt.contrast,
            threshold: flt.threshold,
            autoOtsu: flt.autoOtsu,
            binarize: flt.binarize,
            dpi: flt.dpi,
            jpegQuality: flt.jpegQuality
          },
          fileName: `${stem}_${flt.preset}.pdf`
        },
        { onProgress, onRequestId }
      )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Color Filter Applied',
      `Saved ${result.fileName} (${result.data?.pageCount || workspace.pages.length} pages at ${flt.dpi} DPI, ${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}

/**
 * Loads a high-res page preview for either True Redaction Studio ('redact') or Sign Studio ('sign').
 * @param {'redact'|'sign'} targetTool
 */
async function loadPdfToolPagePreview(targetTool) {
  const cfg = workspace.tools[targetTool];
  const src = cfg.targetFileId ? workspace.sourceFiles.get(cfg.targetFileId) : null;
  if (!src || src.type !== 'pdf') return;

  const pageIndex = Math.max(0, Math.min(src.pageCount - 1, Number(cfg.activePageIndex) || 0));
  cfg.activePageIndex = pageIndex;
  if (cfg.previewPageIndex === pageIndex && cfg.previewUrl) return;

  if (cfg.previewUrl) {
    toolPreviewTracker.revoke(cfg.previewUrl);
    cfg.previewUrl = null;
  }

  cfg.previewLoading = true;
  cfg.previewPageIndex = pageIndex;
  workspace.emit('tool');

  try {
    await pdfRenderClient.ensureDocumentLoaded(src.id);
    const res = await pdfRenderClient.request('RENDER_PREVIEW', {
      sourceFileId: src.id,
      pageIndex,
      scale: 1.5,
      rotation: 0
    });
    if (cfg.targetFileId === src.id && cfg.activePageIndex === pageIndex) {
      cfg.previewUrl = toolPreviewTracker.create(
        new Blob([res.resultBuffer], { type: res.mimeType || 'image/webp' })
      );
      cfg.previewWidth = res.width || 0;
      cfg.previewHeight = res.height || 0;
    }
  } catch (err) {
    workspace.showNotice('error', 'Preview Failed', err?.message || 'Unable to render PDF page.');
  } finally {
    cfg.previewLoading = false;
    workspace.emit('tool');
  }
}

export const loadRedactPreview = () => loadPdfToolPagePreview('redact');
export const loadSignPreview = () => loadPdfToolPagePreview('sign');

/**
 * Searches PDF text boxes using pdfjs getTextContent() and adds matching redaction marks (FEAT-01).
 */
export async function runFindRedactionMatchesJob() {
  const r = workspace.tools.redact;
  if (!r.targetFileId) {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload or select a PDF file to scan.');
    return;
  }

  const res = await runWithProgress('Searching text bounding boxes...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'FIND_REDACTION_MATCHES',
      {
        sourceFileId: r.targetFileId,
        queryConfig: {
          mode: r.searchMode,
          query: r.searchQuery,
          caseSensitive: r.caseSensitive
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (Array.isArray(res?.data)) {
    const newMarks = res.data.map((m) => ({
      id: createUuid(),
      pageIndex: m.pageIndex,
      nx: m.nx,
      ny: m.ny,
      nw: m.nw,
      nh: m.nh,
      sourceLabel: m.matchedText || r.searchMode
    }));
    r.marks.push(...newMarks);
    if (newMarks.length > 0 && newMarks[0].pageIndex !== r.activePageIndex) {
      r.activePageIndex = newMarks[0].pageIndex;
      r.previewPageIndex = -1;
    }
    workspace.emit('tool');
    workspace.showNotice(
      newMarks.length > 0 ? 'success' : 'info',
      'Redaction Search Complete',
      newMarks.length > 0
        ? `Marked ${newMarks.length} match${newMarks.length === 1 ? '' : 'es'} across the document.`
        : 'No matching text spans found.'
    );
  }
}

/**
 * Permanently burns redaction marks via Selective Raster-Burn or Paranoid Mode (FEAT-01).
 */
export async function runRedactPdfJob() {
  const r = workspace.tools.redact;
  const src = r.targetFileId ? workspace.sourceFiles.get(r.targetFileId) : null;
  if (!src || src.type !== 'pdf') {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload or select a PDF file to redact.');
    return;
  }
  if (r.marks.length === 0 && !r.paranoidMode) {
    workspace.showNotice(
      'warning',
      'No Redaction Marks',
      'Draw redaction boxes or search-and-mark text before burning, or enable Paranoid Mode.'
    );
    return;
  }

  const result = await runWithProgress(
    r.paranoidMode ? 'Paranoid Mode: raster-burning all pages & scrubbing...' : 'Burning redactions permanently...',
    (onProgress, onRequestId) =>
      pdfOpsClient.run(
        'REDACT_PDF',
        {
          sourceFileId: src.id,
          marks: r.marks.map((m) => ({
            id: m.id,
            pageIndex: m.pageIndex,
            nx: m.nx,
            ny: m.ny,
            nw: m.nw,
            nh: m.nh
          })),
          config: {
            dpi: r.dpi,
            fillColor: r.fillColor,
            paranoidMode: r.paranoidMode
          },
          fileName: `${src.name.replace(/\.pdf$/i, '')}_redacted.pdf`
        },
        { onProgress, onRequestId }
      )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    const burned = result.data?.burnedPages || 0;
    const copied = result.data?.copiedPages || 0;
    workspace.showNotice(
      'success',
      'Redacted PDF Saved',
      `Downloaded ${result.fileName} (${burned} raster-burned, ${copied} copied cleanly, ${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}

/**
 * Burns placed e-Signatures and native vector annotations into the target PDF (FEAT-02).
 */
export async function runSignAnnotateJob() {
  const s = workspace.tools.sign;
  const src = s.targetFileId ? workspace.sourceFiles.get(s.targetFileId) : null;
  if (!src || src.type !== 'pdf') {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload or select a PDF file to sign or annotate.');
    return;
  }
  if (s.overlays.length === 0) {
    workspace.showNotice(
      'warning',
      'No Overlays Placed',
      'Place at least one signature or annotation on a page first.'
    );
    return;
  }

  const serializedOverlays = s.overlays.map((o) => ({
    id: o.id,
    pageIndex: o.pageIndex,
    kind: o.kind,
    nx: o.nx,
    ny: o.ny,
    nw: o.nw,
    nh: o.nh,
    rotation: o.rotation || 0,
    color: o.color,
    opacity: o.opacity,
    strokeWidth: o.strokeWidth,
    text: o.text,
    fontSize: o.fontSize,
    fontFamily: o.fontFamily,
    imageBytes: o.imageBytes ? new Uint8Array(o.imageBytes) : undefined,
    imageFormat: o.imageFormat || 'png'
  }));

  const result = await runWithProgress('Embedding signatures & vector annotations...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'SIGN_ANNOTATE',
      {
        sourceFileId: src.id,
        overlays: serializedOverlays,
        fileName: `${src.name.replace(/\.pdf$/i, '')}_signed.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Signed PDF Exported',
      `Downloaded ${result.fileName} (${s.overlays.length} overlay${
        s.overlays.length === 1 ? '' : 's'
      }, ${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Loads a File into Original (fileA) or Revised (fileB) compare slot (FEAT-03).
 * @param {'A'|'B'} slot
 * @param {File} file
 */
export async function setCompareFile(slot, file) {
  if (!file) return;
  const buffer = await readFileAsArrayBuffer(file);
  const cmp = workspace.tools.compare;
  const entry = { name: file.name, byteSize: buffer.byteLength, buffer };
  if (slot === 'A') cmp.fileA = entry;
  else cmp.fileB = entry;
  compareUrlTracker.revokeAll();
  cmp.results = null;
  cmp.activePageIndex = 0;
  workspace.emit('tool');
}

/**
 * Copies an already-loaded workspace PDF into Compare slot A or B without re-uploading.
 * @param {'A'|'B'} slot
 * @param {string} sourceFileId
 */
export function useWorkspacePdfForCompare(slot, sourceFileId) {
  const src = workspace.sourceFiles.get(sourceFileId);
  if (!src || src.type !== 'pdf') return;
  const cmp = workspace.tools.compare;
  const entry = { name: src.name, byteSize: src.buffer.byteLength, buffer: src.buffer.slice(0) };
  if (slot === 'A') cmp.fileA = entry;
  else cmp.fileB = entry;
  compareUrlTracker.revokeAll();
  cmp.results = null;
  cmp.activePageIndex = 0;
  workspace.emit('tool');
}

/**
 * Clears Compare PDF results and revokes all visual diff ObjectURLs.
 */
export function clearCompareResults() {
  compareUrlTracker.revokeAll();
  const cmp = workspace.tools.compare;
  cmp.results = null;
  cmp.fileA = null;
  cmp.fileB = null;
  cmp.activePageIndex = 0;
  workspace.emit('tool');
}

/**
 * Runs OffscreenCanvas visual pixel diff + Myers text diff across two PDFs (FEAT-03).
 */
export async function runComparePdfJob() {
  const cmp = workspace.tools.compare;
  if (!cmp.fileA?.buffer || !cmp.fileB?.buffer) {
    workspace.showNotice(
      'warning',
      'Two PDFs Required',
      'Upload both Original (v1) and Revised (v2) PDF files to compare.'
    );
    return;
  }

  compareUrlTracker.revokeAll();
  cmp.results = null;

  const bufA = cmp.fileA.buffer.slice(0);
  const bufB = cmp.fileB.buffer.slice(0);

  const res = await runWithProgress('Comparing visual pixels & text layers...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'COMPARE_PDF',
      {
        bufferA: bufA,
        bufferB: bufB,
        nameA: cmp.fileA.name,
        nameB: cmp.fileB.name,
        scale: 1.5,
        sensitivity: cmp.sensitivity
      },
      { transfer: [bufA, bufB], onProgress, onRequestId }
    )
  );

  if (res?.data?.pages) {
    cmp.results = {
      pagesA: res.data.pagesA,
      pagesB: res.data.pagesB,
      totalPages: res.data.totalPages,
      pages: res.data.pages.map((p) => ({
        pageNumber: p.pageNumber,
        status: p.status,
        width: p.width,
        height: p.height,
        changePercent: p.changePercent,
        imageAUrl: p.imageABuffer
          ? compareUrlTracker.create(new Blob([p.imageABuffer], { type: 'image/webp' }))
          : null,
        imageBUrl: p.imageBBuffer
          ? compareUrlTracker.create(new Blob([p.imageBBuffer], { type: 'image/webp' }))
          : null,
        diffUrl: p.diffBuffer
          ? compareUrlTracker.create(new Blob([p.diffBuffer], { type: 'image/png' }))
          : null,
        diffBytes: p.diffBuffer ? new Uint8Array(p.diffBuffer) : null,
        linesA: p.linesA || [],
        linesB: p.linesB || [],
        textDiff: p.textDiff || []
      }))
    };
    cmp.activePageIndex = 0;
    workspace.emit('tool');

    const changedCount = cmp.results.pages.filter((p) => p.status !== 'unchanged').length;
    workspace.showNotice(
      'success',
      'Comparison Complete',
      `Analyzed ${cmp.results.totalPages} page${cmp.results.totalPages === 1 ? '' : 's'} (${changedCount} changed).`
    );
  }
}

/**
 * Exports a visual Diff Report PDF summarizing page changes (FEAT-03).
 */
export async function runExportDiffReportJob() {
  const cmp = workspace.tools.compare;
  if (!cmp.results?.pages?.length) return;

  const result = await runWithProgress('Generating PDF diff report...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'EXPORT_DIFF_REPORT',
      {
        nameA: cmp.fileA?.name || 'Original.pdf',
        nameB: cmp.fileB?.name || 'Revised.pdf',
        pages: cmp.results.pages.map((p) => ({
          pageNumber: p.pageNumber,
          status: p.status,
          changePercent: p.changePercent,
          diffPngBytes: p.diffBytes ? new Uint8Array(p.diffBytes) : null
        })),
        fileName: 'poffy_diff_report.pdf'
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Diff Report Exported',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Extracts readable TXT, Markdown, or JSON from the selected PDF (FEAT-08).
 */
export async function runExtractTextJob() {
  const et = workspace.tools.extractText;
  if (!et.targetFileId) {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload or select a PDF file to extract text.');
    return;
  }

  const res = await runWithProgress('Extracting text layout...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'EXTRACT_TEXT',
      {
        sourceFileId: et.targetFileId,
        config: {
          format: et.format,
          rangeExpression: et.rangeExpression,
          includePageMarkers: et.includePageMarkers
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (res?.data) {
    et.resultText = res.data.text || '';
    et.totalChars = res.data.totalChars || 0;
    et.pagesExtracted = res.data.pagesExtracted || 0;
    et.likelyScanned = Boolean(res.data.likelyScanned);
    workspace.emit('tool');
    if (et.likelyScanned) {
      workspace.showNotice(
        'warning',
        'Likely Scanned PDF',
        'Near-zero extractable text layer detected. This PDF appears to contain raster page images only.'
      );
    } else {
      workspace.showNotice(
        'success',
        'Text Extracted',
        `Extracted ${et.totalChars.toLocaleString()} characters across ${et.pagesExtracted} page(s).`
      );
    }
  }
}

/**
 * Downloads the currently extracted text preview as `.txt`, `.md`, or `.json`.
 */
export function downloadExtractedTextFile() {
  const et = workspace.tools.extractText;
  const src = et.targetFileId ? workspace.sourceFiles.get(et.targetFileId) : null;
  const stem = src ? src.name.replace(/\.pdf$/i, '') : 'poffy_text';
  const ext = et.format === 'md' ? 'md' : et.format === 'json' ? 'json' : 'txt';
  const mime =
    ext === 'json' ? 'application/json' : ext === 'md' ? 'text/markdown' : 'text/plain';
  const bytes = new TextEncoder().encode(et.resultText || '');
  triggerDownload(bytes, `${stem}.${ext}`, mime);
}

/**
 * Batch extracts text from all loaded PDFs and exports a `.zip` archive (FEAT-08).
 */
export async function runBatchExtractTextZipJob() {
  const pdfIds = [...workspace.sourceFiles.values()]
    .filter((s) => s.type === 'pdf')
    .map((s) => s.id);
  if (pdfIds.length === 0) return;

  const et = workspace.tools.extractText;
  const result = await runWithProgress('Batch extracting text to ZIP...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'BATCH_EXTRACT_TEXT_ZIP',
      {
        sourceIds: pdfIds,
        config: {
          format: et.format,
          rangeExpression: et.rangeExpression,
          includePageMarkers: et.includePageMarkers
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Batch Text ZIP Ready',
      `Exported ${result.data?.fileCount || pdfIds.length} files (${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}

/**
 * Extracts raw embedded images (JPG, JP2, Flate/CMYK/SMask PNG) from a PDF (FEAT-09).
 */
export async function runExtractImagesJob() {
  const ei = workspace.tools.extractImages;
  if (!ei.targetFileId) {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload or select a PDF to scan for embedded images.');
    return;
  }

  extractUrlTracker.revokeAll();
  ei.items = [];

  const res = await runWithProgress('Scanning embedded image streams...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'EXTRACT_IMAGES',
      {
        sourceFileId: ei.targetFileId,
        config: {
          minWidth: ei.minSize,
          minHeight: ei.minSize
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (res?.data?.images) {
    ei.items = res.data.images.map((img) => {
      const bytes = new Uint8Array(img.buffer);
      const previewUrl =
        img.format === 'jp2'
          ? null
          : extractUrlTracker.create(new Blob([bytes], { type: img.mimeType || 'image/png' }));
      return {
        id: img.id,
        fileName: img.fileName,
        format: img.format,
        mimeType: img.mimeType,
        width: img.width,
        height: img.height,
        hasAlpha: img.hasAlpha,
        bytes,
        previewUrl
      };
    });
    ei.skippedSmall = res.data.skippedSmall || 0;
    ei.skippedUnsupported = res.data.skippedUnsupported || 0;
    workspace.emit('tool');
    workspace.showNotice(
      ei.items.length > 0 ? 'success' : 'info',
      'Image Scan Complete',
      `Found ${ei.items.length} image(s) (skipped ${ei.skippedSmall} small spacers).`
    );
  }
}

/**
 * Downloads a single extracted embedded image file.
 * @param {{ fileName: string, bytes: Uint8Array, mimeType: string }} item
 */
export function downloadSingleExtractedImage(item) {
  triggerDownload(item.bytes, item.fileName, item.mimeType || 'application/octet-stream');
}

/**
 * Packages all extracted embedded images into a single `.zip` via `fflate` (FEAT-09).
 */
export async function runDownloadAllExtractedImagesZipJob() {
  const ei = workspace.tools.extractImages;
  if (!ei.items.length) return;
  const src = ei.targetFileId ? workspace.sourceFiles.get(ei.targetFileId) : null;

  const result = await runWithProgress('Packaging extracted images ZIP...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'PACKAGE_IMAGES_ZIP',
      {
        sourceName: src?.name || 'document',
        images: ei.items.map((it) => ({
          fileName: it.fileName,
          bytes: new Uint8Array(it.bytes)
        }))
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Images ZIP Ready',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Scans `/Names -> /EmbeddedFiles` in the selected PDF (FEAT-10).
 */
export async function runInspectAttachmentsJob() {
  const att = workspace.tools.attachments;
  if (!att.targetFileId) return;

  const res = await runWithProgress('Inspecting embedded PDF attachments...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'INSPECT_ATTACHMENTS',
      { sourceFileId: att.targetFileId },
      { onProgress, onRequestId }
    )
  );

  if (Array.isArray(res?.data)) {
    att.items = res.data.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description || '',
      mimeType: a.mimeType || 'application/octet-stream',
      size: a.size || 0,
      bytes: new Uint8Array(a.buffer)
    }));
    att.pendingRemove = [];
    att.loaded = true;
    workspace.emit('tool');
  }
}

/**
 * Downloads a single PDF attachment entry.
 * @param {{ name: string, bytes: Uint8Array, mimeType: string }} entry
 */
export function downloadSingleAttachment(entry) {
  triggerDownload(entry.bytes, entry.name, entry.mimeType || 'application/octet-stream');
}

/**
 * Bundles all inspected attachments into a `.zip` via `fflate` (FEAT-10).
 */
export async function runPackageAttachmentsZipJob() {
  const att = workspace.tools.attachments;
  if (!att.items.length) return;
  const src = att.targetFileId ? workspace.sourceFiles.get(att.targetFileId) : null;

  const result = await runWithProgress('Packaging attachments ZIP...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'PACKAGE_ATTACHMENTS_ZIP',
      {
        sourceName: src?.name || 'document',
        attachments: att.items.map((a) => ({
          name: a.name,
          bytes: new Uint8Array(a.bytes)
        }))
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Attachments ZIP Ready',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Saves attachment additions & removals cleanly onto the selected PDF (FEAT-10).
 */
export async function runUpdateAttachmentsJob() {
  const att = workspace.tools.attachments;
  const src = att.targetFileId ? workspace.sourceFiles.get(att.targetFileId) : null;
  if (!src || src.type !== 'pdf') return;

  const result = await runWithProgress('Updating embedded PDF attachments...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'UPDATE_ATTACHMENTS',
      {
        sourceFileId: src.id,
        removeNames: [...att.pendingRemove],
        addFiles: att.pendingAdd.map((f) => ({
          name: f.name,
          bytes: new Uint8Array(f.bytes),
          mimeType: f.mimeType,
          description: f.description || ''
        })),
        fileName: `${src.name.replace(/\.pdf$/i, '')}_attachments.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    if (Array.isArray(result.data?.attachments)) {
      att.items = result.data.attachments.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description || '',
        mimeType: a.mimeType || 'application/octet-stream',
        size: a.size || 0,
        bytes: new Uint8Array(a.buffer)
      }));
    }
    att.pendingAdd = [];
    att.pendingRemove = [];
    att.loaded = true;
    workspace.emit('tool');
    workspace.showNotice(
      'success',
      'PDF Attachments Saved',
      `Downloaded ${result.fileName} (${att.items.length} embedded file${
        att.items.length === 1 ? '' : 's'
      }).`
    );
  }
}

/**
 * Reads existing bookmark outlines from the target PDF via `pdfjs-dist` (FEAT-11).
 */
export async function runReadOutlinesJob() {
  const bm = workspace.tools.bookmarks;
  if (!bm.targetFileId) return;

  const res = await runWithProgress('Reading PDF outlines...', (onProgress, onRequestId) =>
    pdfOpsClient.run('READ_OUTLINES', { sourceFileId: bm.targetFileId }, { onProgress, onRequestId })
  );

  if (res?.data) {
    bm.tree = res.data.tree || [];
    bm.pageCount = res.data.pageCount || workspace.sourceFiles.get(bm.targetFileId)?.pageCount || 1;
    bm.selectedNodeId = bm.tree[0]?.id || null;
    bm.previewPageIndex = bm.tree[0]?.pageIndex || 0;
    bm.previewLoadedIdx = -1;
    workspace.emit('tool');
  }
}

/**
 * Renders the side-by-side target page preview inside the Bookmark Editor modal (FEAT-11).
 * @param {number} pageIndex
 */
export async function loadBookmarkPreviewPage(pageIndex) {
  const bm = workspace.tools.bookmarks;
  const src = bm.targetFileId ? workspace.sourceFiles.get(bm.targetFileId) : null;
  if (!src || src.type !== 'pdf') return;

  const safeIdx = Math.max(0, Math.min(src.pageCount - 1, Math.floor(Number(pageIndex) || 0)));
  bm.previewPageIndex = safeIdx;
  if (bm.previewLoadedIdx === safeIdx && bm.previewUrl) return;

  if (bm.previewUrl) {
    toolPreviewTracker.revoke(bm.previewUrl);
    bm.previewUrl = null;
  }

  bm.previewLoading = true;
  bm.previewLoadedIdx = safeIdx;
  workspace.emit('tool');

  try {
    await pdfRenderClient.ensureDocumentLoaded(src.id);
    const res = await pdfRenderClient.request('RENDER_PREVIEW', {
      sourceFileId: src.id,
      pageIndex: safeIdx,
      scale: 1.1,
      rotation: 0
    });
    if (bm.previewLoadedIdx === safeIdx) {
      bm.previewUrl = toolPreviewTracker.create(
        new Blob([res.resultBuffer], { type: res.mimeType || 'image/webp' })
      );
    }
  } catch {
    // Non-fatal preview error
  } finally {
    bm.previewLoading = false;
    workspace.emit('tool');
  }
}

/**
 * Serializes the bookmark tree into the target PDF via low-level `writeOutlines()` (FEAT-11).
 */
export async function runWriteOutlinesJob() {
  const bm = workspace.tools.bookmarks;
  const src = bm.targetFileId ? workspace.sourceFiles.get(bm.targetFileId) : null;
  if (!src || src.type !== 'pdf') return;

  const result = await runWithProgress('Serializing Unicode /Outlines tree...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'WRITE_OUTLINES',
      {
        sourceFileId: src.id,
        tree: bm.tree,
        fileName: `${src.name.replace(/\.pdf$/i, '')}_bookmarked.pdf`
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'Bookmarks Saved',
      `Downloaded ${result.fileName} (${formatBytes(result.resultBuffer.byteLength)}).`
    );
  }
}

/**
 * Loads and inspects a `.cbz` archive for sorted filename preview (FEAT-12).
 * @param {File} file
 */
export async function loadCbzArchiveFile(file) {
  if (!file) return;
  const buffer = await readFileAsArrayBuffer(file);
  const cbz = workspace.tools.cbz;
  cbz.cbzFile = { name: file.name, byteSize: buffer.byteLength, buffer };
  cbz.cbzEntries = [];
  cbz.mode = 'cbz-to-pdf';

  const copy = buffer.slice(0);
  const res = await runWithProgress('Inspecting CBZ comic archive...', (onProgress, onRequestId) =>
    pdfOpsClient.run('INSPECT_CBZ', { buffer: copy }, { transfer: [copy], onProgress, onRequestId })
  );

  if (res?.data?.fileNames) {
    cbz.cbzEntries = res.data.fileNames;
    workspace.emit('tool');
  }
}

/**
 * Converts a `.cbz` archive into a PDF document inside a Web Worker (FEAT-12).
 */
export async function runCbzToPdfJob() {
  const cbz = workspace.tools.cbz;
  if (!cbz.cbzFile?.buffer) {
    workspace.showNotice('warning', 'No CBZ Loaded', 'Select a .cbz comic archive first.');
    return;
  }

  const copy = cbz.cbzFile.buffer.slice(0);
  const result = await runWithProgress('Converting CBZ images to PDF...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'CBZ_TO_PDF',
      {
        buffer: copy,
        fileName: cbz.cbzFile.name,
        config: { uniformWidth: cbz.uniformWidth }
      },
      { transfer: [copy], onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'CBZ Converted to PDF',
      `Downloaded ${result.fileName} (${result.data?.pageCount || 0} pages, ${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}

/**
 * Converts a loaded workspace PDF into a store-mode `.cbz` comic archive (FEAT-12).
 */
export async function runPdfToCbzJob() {
  const cbz = workspace.tools.cbz;
  const src = cbz.targetFileId ? workspace.sourceFiles.get(cbz.targetFileId) : null;
  if (!src || src.type !== 'pdf') {
    workspace.showNotice('warning', 'No PDF Selected', 'Upload or select a PDF file to convert to CBZ.');
    return;
  }

  const result = await runWithProgress('Rendering PDF pages to CBZ archive...', (onProgress, onRequestId) =>
    pdfOpsClient.run(
      'PDF_TO_CBZ',
      {
        sourceFileId: src.id,
        fileName: src.name,
        config: {
          scale: cbz.pdfScale,
          format: cbz.imageFormat,
          quality: cbz.quality
        }
      },
      { onProgress, onRequestId }
    )
  );

  if (result?.resultBuffer) {
    triggerDownload(result.resultBuffer, result.fileName, result.mimeType);
    workspace.showNotice(
      'success',
      'PDF Exported as CBZ',
      `Downloaded ${result.fileName} (${result.data?.pageCount || 0} pages, ${formatBytes(
        result.resultBuffer.byteLength
      )}).`
    );
  }
}
