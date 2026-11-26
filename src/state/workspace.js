import { globalUrlTracker } from '../core/utils/file-io.js';

/**
 * @typedef {Object} SourceFileEntry
 * @property {string} id - Unique UUID for the uploaded file
 * @property {string} name - Original filename
 * @property {'pdf'|'image'} type - Source asset type
 * @property {string} mimeType - File MIME type
 * @property {ArrayBuffer} buffer - Raw immutable file bytes
 * @property {number} pageCount - Total pages in source PDF (1 for images)
 * @property {Object} metadata - Extracted PDF info dictionary
 */

/**
 * @typedef {Object} VirtualPage
 * @property {string} id - Unique page instance UUID (supports duplication)
 * @property {string} sourceFileId - Reference to SourceFileEntry.id or '__blank__'
 * @property {number} sourcePageIndex - 0-based page index in source file
 * @property {0|90|180|270} rotation - Cumulative clockwise rotation in degrees
 * @property {boolean} selected - Selection state for batch split/rotate/delete
 * @property {{ top: number, right: number, bottom: number, left: number }|null} cropMargins
 * @property {{ width?: number, height?: number, preset?: 'a4'|'letter'|'legal' }|null} [blankSpec]
 */

/**
 * @typedef {'organize'|'split'|'watermark'|'numbering'|'convert'|'resize'|'nup'|'spreads'|'filters'|'redact'|'sign'|'compare'|'extract-text'|'extract-images'|'attachments'|'bookmarks'|'cbz'|'metadata'|'forms'|'optimize'} ToolTabId
 */

const DESKTOP_MEMORY_WARN_BYTES = 250 * 1024 * 1024;
const MOBILE_MEMORY_WARN_BYTES = 100 * 1024 * 1024;
const MAX_HISTORY_STEPS = 25;

/**
 * Generates a collision-free UUID using Web Crypto when available.
 * @returns {string}
 */
export function createUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Clones a VirtualPage[] list cleanly for immutable undo snapshots.
 * @param {VirtualPage[]} pages
 * @returns {VirtualPage[]}
 */
function cloneVirtualPages(pages) {
  return pages.map((p) => ({
    ...p,
    cropMargins: p.cropMargins ? { ...p.cropMargins } : null,
    blankSpec: p.blankSpec ? { ...p.blankSpec } : null
  }));
}

/**
 * Creates default tool configuration state.
 * @returns {Object}
 */
function createDefaultToolConfig() {
  return {
    organize: {
      mergeMode: 'sequential',
      autoBookmarks: false,
      blankSize: 'a4',
      blankEveryN: 1,
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0,
      autoCropModalOpen: false,
      autoCropPadding: 12,
      autoCropUnit: 'pt',
      autoCropThreshold: 245,
      autoCropMode: 'uniform',
      autoCropScope: 'all'
    },
    split: {
      mode: 'ranges',
      rangeExpression: '1-2',
      everyN: 2,
      targetScope: 'workspace'
    },
    watermark: {
      enabled: false,
      kind: 'text',
      text: 'CONFIDENTIAL',
      opacity: 0.22,
      fontFamily: 'HelveticaBold',
      fontSize: 48,
      color: '#0a0a0a',
      rotation: -35,
      position: 'center',
      tileGap: 140,
      imageBytes: null,
      imageFormat: 'png',
      imageName: '',
      scale: 0.28,
      margin: 36
    },
    numbering: {
      mode: 'single',
      enabled: false,
      template: 'Page {n} of {total}',
      startNumber: 1,
      skipCover: false,
      placement: 'bottom',
      alignment: 'center',
      marginX: 36,
      marginY: 24,
      fontSize: 11,
      fontFamily: 'Helvetica',
      color: '#3a3a3a',
      opacity: 0.85,
      batesQueue: [],
      batesPrefix: 'CASE-',
      batesSuffix: '',
      batesPadding: 5,
      batesStart: 1,
      batesTemplate: '{prefix}{counter:pad}{suffix}',
      batesPlacement: 'bottom',
      batesAlignment: 'right',
      batesIncludeCsv: true
    },
    convert: {
      pageFit: 'a4',
      margin: 24,
      exportFormat: 'png',
      exportQuality: 0.9,
      exportScale: 2,
      selectedOnly: false
    },
    metadata: {
      targetFileId: '',
      title: '',
      author: '',
      subject: '',
      keywords: '',
      creator: '',
      producer: '',
      creationDate: '',
      modificationDate: '',
      stripAll: false,
      applyOnExport: false,
      audit: null,
      auditLoading: false,
      scrubOptions: {
        scrubInfo: true,
        purgeXmp: true,
        removeThumbnails: true,
        stripScriptsAndActions: true
      }
    },
    forms: {
      targetFileId: '',
      fields: [],
      values: {},
      flatten: true,
      loading: false
    },
    optimize: {
      preset: 'lossless',
      useObjectStreams: true,
      rebuildCleanCopy: true,
      stripMetadata: false,
      targetDpi: 150,
      jpegQuality: 0.75,
      lastStats: null
    },
    resize: {
      preset: 'a4',
      customWidth: 210,
      customHeight: 297,
      customUnit: 'mm',
      orientation: 'auto',
      fitMode: 'fit',
      marginPt: 0
    },
    nup: {
      mode: 'nup',
      nUp: 2,
      nUpOrder: 'ltr',
      sheetPreset: 'a4',
      sheetOrientation: 'landscape',
      outerMarginPt: 18,
      gutterPt: 10,
      drawBorders: false,
      bindingEdge: 'left',
      flipBackSide: false
    },
    spreads: {
      axis: 'vertical',
      splitRatio: 0.5,
      readingOrder: 'ltr',
      skipFirstPage: false,
      skipLastPage: false,
      landscapeOnly: false,
      previewPageIndex: 0,
      previewUrl: null,
      previewLoading: false,
      previewKey: ''
    },
    filters: {
      preset: 'grayscale',
      invertVariant: 'slate',
      contrast: 1.2,
      threshold: 185,
      autoOtsu: true,
      binarize: false,
      dpi: 150,
      jpegQuality: 0.84,
      previewPageIndex: 0,
      previewOriginalUrl: null,
      previewFilteredUrl: null,
      previewLoading: false,
      previewOtsuThreshold: null
    },
    redact: {
      targetFileId: '',
      activePageIndex: 0,
      marks: [],
      dpi: 220,
      fillColor: '#000000',
      paranoidMode: false,
      searchMode: 'keyword',
      searchQuery: '',
      caseSensitive: false,
      modalOpen: false,
      previewUrl: null,
      previewPageIndex: -1,
      previewLoading: false,
      previewWidth: 0,
      previewHeight: 0
    },
    sign: {
      targetFileId: '',
      activePageIndex: 0,
      activeKind: 'signature',
      sigMode: 'draw',
      typedText: 'Jane Doe',
      typedStyle: 'script',
      color: '#0a0a0a',
      strokeWidth: 2.5,
      opacity: 1,
      fontSize: 16,
      textValue: 'Approved',
      activeSigBytes: null,
      activeSigPreviewUrl: null,
      activeSigAspect: 2.5,
      overlays: [],
      selectedOverlayId: null,
      modalOpen: false,
      previewUrl: null,
      previewPageIndex: -1,
      previewLoading: false,
      previewWidth: 0,
      previewHeight: 0
    },
    compare: {
      fileA: null,
      fileB: null,
      viewMode: 'side-by-side',
      sensitivity: 24,
      changedOnly: false,
      activePageIndex: 0,
      splitPercent: 50,
      results: null,
      modalOpen: false
    },
    extractText: {
      targetFileId: '',
      format: 'txt',
      rangeExpression: 'all',
      includePageMarkers: true,
      resultText: '',
      totalChars: 0,
      pagesExtracted: 0,
      likelyScanned: false
    },
    extractImages: {
      targetFileId: '',
      minSize: 32,
      items: [],
      skippedSmall: 0,
      skippedUnsupported: 0
    },
    attachments: {
      targetFileId: '',
      items: [],
      pendingAdd: [],
      pendingRemove: [],
      loaded: false
    },
    bookmarks: {
      targetFileId: '',
      tree: [],
      pageCount: 0,
      selectedNodeId: null,
      modalOpen: false,
      previewPageIndex: 0,
      previewUrl: null,
      previewLoadedIdx: -1,
      previewLoading: false
    },
    cbz: {
      mode: 'cbz-to-pdf',
      targetFileId: '',
      cbzFile: null,
      cbzEntries: [],
      uniformWidth: false,
      pdfScale: 2.0,
      imageFormat: 'webp',
      quality: 0.88,
      modalOpen: false
    }
  };
}

/**
 * Reactive Virtual Page Graph & Source File Registry.
 */
class WorkspaceStore {
  constructor() {
    /** @type {Map<string, SourceFileEntry>} */
    this.sourceFiles = new Map();
    /** @type {VirtualPage[]} */
    this.pages = [];
    /** @type {VirtualPage[][]} */
    this.undoStack = [];
    /** @type {VirtualPage[][]} */
    this.redoStack = [];
    /** @type {ToolTabId} */
    this.activeTool = 'organize';
    this.tools = createDefaultToolConfig();

    /** @type {{ active: boolean, requestId: string|null, percent: number, stage: string, current?: number, total?: number }} */
    this.job = {
      active: false,
      requestId: null,
      percent: 0,
      stage: '',
      current: 0,
      total: 0
    };

    /** @type {{ pageId: string|null, loading: boolean, imageUrl: string|null }} */
    this.preview = {
      pageId: null,
      loading: false,
      imageUrl: null
    };

    /** @type {{ id: string, type: 'error'|'warning'|'success'|'info', title: string, message: string }|null} */
    this.notice = null;

    /** @type {Set<(topic: string, store: WorkspaceStore) => void>} */
    this.listeners = new Set();
    /** @type {Set<(sourceFileId: string) => void>} */
    this.sourceEvictHooks = new Set();
    /** @type {Set<() => void>} */
    this.clearHooks = new Set();
  }

  /**
   * Subscribes to workspace state changes.
   * @param {(topic: string, store: WorkspaceStore) => void} listener
   * @returns {() => void} Unsubscribe callback
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Registers a hook invoked when a source file is removed.
   * @param {(sourceFileId: string) => void} hook
   */
  onSourceEvict(hook) {
    this.sourceEvictHooks.add(hook);
  }

  /**
   * Registers a hook invoked when the workspace is completely cleared.
   * @param {() => void} hook
   */
  onWorkspaceClear(hook) {
    this.clearHooks.add(hook);
  }

  /**
   * Emits an update notification.
   * @param {string} [topic='all']
   */
  emit(topic = 'all') {
    for (const listener of this.listeners) {
      listener(topic, this);
    }
  }

  /**
   * Pushes a virtual page snapshot onto the undo stack before mutating `pages`.
   */
  pushUndoSnapshot() {
    this.undoStack.push(cloneVirtualPages(this.pages));
    if (this.undoStack.length > MAX_HISTORY_STEPS) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  /**
   * Restores the previous virtual page layout.
   * @returns {boolean}
   */
  undo() {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(cloneVirtualPages(this.pages));
    this.pages = this.undoStack.pop();
    this.emit('pages');
    return true;
  }

  /**
   * Re-applies the most recently undone virtual page layout.
   * @returns {boolean}
   */
  redo() {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(cloneVirtualPages(this.pages));
    this.pages = this.redoStack.pop();
    this.emit('pages');
    return true;
  }

  /**
   * Returns total memory held by loaded ArrayBuffers (source files + watermark stamp).
   * @returns {number}
   */
  getTotalMemoryBytes() {
    let total = 0;
    for (const entry of this.sourceFiles.values()) {
      total += entry.buffer?.byteLength || 0;
    }
    if (this.tools.watermark.imageBytes) {
      total += this.tools.watermark.imageBytes.byteLength || 0;
    }
    return total;
  }

  /**
   * Determines whether current browser RAM usage crosses desktop (250 MB) or mobile (100 MB) threshold.
   * @returns {{ warned: boolean, totalBytes: number, thresholdBytes: number }}
   */
  getMemoryStatus() {
    const isMobile =
      typeof window !== 'undefined' &&
      (window.innerWidth < 768 || (navigator.maxTouchPoints || 0) > 1);
    const thresholdBytes = isMobile ? MOBILE_MEMORY_WARN_BYTES : DESKTOP_MEMORY_WARN_BYTES;
    const totalBytes = this.getTotalMemoryBytes();
    return {
      warned: totalBytes > thresholdBytes,
      totalBytes,
      thresholdBytes
    };
  }

  /**
   * Adds a parsed SourceFileEntry and appends its VirtualPages to the workspace.
   * @param {SourceFileEntry} entry
   */
  addSourceFile(entry) {
    this.pushUndoSnapshot();
    this.sourceFiles.set(entry.id, entry);

    const newPages = Array.from({ length: entry.pageCount }, (_, idx) => ({
      id: createUuid(),
      sourceFileId: entry.id,
      sourcePageIndex: idx,
      rotation: 0,
      selected: false,
      cropMargins: null,
      blankSpec: null
    }));

    this.pages.push(...newPages);

    // Initialize metadata/forms/Bates/redact/sign targets if PDF
    if (entry.type === 'pdf') {
      if (!this.tools.metadata.targetFileId) {
        this.tools.metadata.targetFileId = entry.id;
        this.hydrateMetadataFields(entry.metadata);
        this.tools.metadata.audit = entry.audit || null;
      }
      if (!this.tools.forms.targetFileId) {
        this.tools.forms.targetFileId = entry.id;
      }
      if (!this.tools.redact.targetFileId) {
        this.tools.redact.targetFileId = entry.id;
      }
      if (!this.tools.sign.targetFileId) {
        this.tools.sign.targetFileId = entry.id;
      }
      if (!this.tools.extractText.targetFileId) {
        this.tools.extractText.targetFileId = entry.id;
      }
      if (!this.tools.extractImages.targetFileId) {
        this.tools.extractImages.targetFileId = entry.id;
      }
      if (!this.tools.attachments.targetFileId) {
        this.tools.attachments.targetFileId = entry.id;
      }
      if (!this.tools.bookmarks.targetFileId) {
        this.tools.bookmarks.targetFileId = entry.id;
      }
      if (!this.tools.cbz.targetFileId) {
        this.tools.cbz.targetFileId = entry.id;
      }
      if (!this.tools.numbering.batesQueue.includes(entry.id)) {
        this.tools.numbering.batesQueue.push(entry.id);
      }
    }

    this.emit('files');
    this.emit('pages');
  }

  /**
   * Populates metadata inspector fields from an extracted metadata dictionary.
   * @param {Object} [meta]
   */
  hydrateMetadataFields(meta) {
    if (!meta) return;
    this.tools.metadata.title = meta.title ?? '';
    this.tools.metadata.author = meta.author ?? '';
    this.tools.metadata.subject = meta.subject ?? '';
    this.tools.metadata.keywords = meta.keywords ?? '';
    this.tools.metadata.creator = meta.creator ?? '';
    this.tools.metadata.producer = meta.producer ?? '';
    this.tools.metadata.creationDate = meta.creationDate ?? '';
    this.tools.metadata.modificationDate = meta.modificationDate ?? '';
  }

  /**
   * Removes a source file and all virtual pages referencing it, reclaiming memory.
   * @param {string} sourceFileId
   */
  removeSourceFile(sourceFileId) {
    const entry = this.sourceFiles.get(sourceFileId);
    if (!entry) return;

    this.pushUndoSnapshot();
    this.pages = this.pages.filter((p) => p.sourceFileId !== sourceFileId);
    this.sourceFiles.delete(sourceFileId);
    entry.buffer = new ArrayBuffer(0);
    entry.metadata = {};

    for (const hook of this.sourceEvictHooks) {
      hook(sourceFileId);
    }

    this.tools.numbering.batesQueue = this.tools.numbering.batesQueue.filter(
      (id) => id !== sourceFileId
    );

    if (this.tools.metadata.targetFileId === sourceFileId) {
      const nextPdf = [...this.sourceFiles.values()].find((s) => s.type === 'pdf');
      this.tools.metadata.targetFileId = nextPdf ? nextPdf.id : '';
      this.tools.metadata.audit = nextPdf?.audit || null;
      if (nextPdf) this.hydrateMetadataFields(nextPdf.metadata);
    }
    if (this.tools.forms.targetFileId === sourceFileId) {
      const nextPdf = [...this.sourceFiles.values()].find((s) => s.type === 'pdf');
      this.tools.forms.targetFileId = nextPdf ? nextPdf.id : '';
      this.tools.forms.fields = [];
      this.tools.forms.values = {};
    }
    if (this.tools.redact.targetFileId === sourceFileId) {
      const nextPdf = [...this.sourceFiles.values()].find((s) => s.type === 'pdf');
      this.tools.redact.targetFileId = nextPdf ? nextPdf.id : '';
      this.tools.redact.marks = [];
      this.tools.redact.activePageIndex = 0;
    }
    if (this.tools.sign.targetFileId === sourceFileId) {
      const nextPdf = [...this.sourceFiles.values()].find((s) => s.type === 'pdf');
      this.tools.sign.targetFileId = nextPdf ? nextPdf.id : '';
      this.tools.sign.overlays = [];
      this.tools.sign.selectedOverlayId = null;
      this.tools.sign.activePageIndex = 0;
    }
    const nextPdfId = [...this.sourceFiles.values()].find((s) => s.type === 'pdf')?.id || '';
    if (this.tools.extractText.targetFileId === sourceFileId) {
      this.tools.extractText.targetFileId = nextPdfId;
      this.tools.extractText.resultText = '';
    }
    if (this.tools.extractImages.targetFileId === sourceFileId) {
      this.tools.extractImages.targetFileId = nextPdfId;
      this.tools.extractImages.items = [];
    }
    if (this.tools.attachments.targetFileId === sourceFileId) {
      this.tools.attachments.targetFileId = nextPdfId;
      this.tools.attachments.items = [];
      this.tools.attachments.pendingAdd = [];
      this.tools.attachments.pendingRemove = [];
      this.tools.attachments.loaded = false;
    }
    if (this.tools.bookmarks.targetFileId === sourceFileId) {
      this.tools.bookmarks.targetFileId = nextPdfId;
      this.tools.bookmarks.tree = [];
      this.tools.bookmarks.selectedNodeId = null;
    }
    if (this.tools.cbz.targetFileId === sourceFileId) {
      this.tools.cbz.targetFileId = nextPdfId;
    }

    this.emit('files');
    this.emit('pages');
  }

  /**
   * Clears all files, virtual pages, undo history, preview state, and ObjectURLs.
   */
  clearWorkspace() {
    const ids = [...this.sourceFiles.keys()];
    for (const entry of this.sourceFiles.values()) {
      entry.buffer = new ArrayBuffer(0);
      entry.metadata = {};
    }
    this.sourceFiles.clear();
    this.pages = [];
    this.undoStack = [];
    this.redoStack = [];
    this.tools.watermark.imageBytes = null;
    this.tools = createDefaultToolConfig();
    this.closePreview();

    for (const id of ids) {
      for (const hook of this.sourceEvictHooks) {
        hook(id);
      }
    }
    for (const hook of this.clearHooks) {
      hook();
    }
    globalUrlTracker.revokeAll();
    this.emit('files');
    this.emit('pages');
    this.emit('tool');
  }

  /**
   * Returns currently selected VirtualPages (or all if none selected when fallbackAll=true).
   * @param {boolean} [fallbackAll=false]
   * @returns {VirtualPage[]}
   */
  getTargetPages(fallbackAll = false) {
    const selected = this.pages.filter((p) => p.selected);
    if (selected.length > 0) return selected;
    return fallbackAll ? this.pages : [];
  }

  /**
   * Toggles selection on a virtual page.
   * @param {string} pageId
   * @param {boolean} [force]
   */
  toggleSelectPage(pageId, force) {
    const page = this.pages.find((p) => p.id === pageId);
    if (!page) return;
    page.selected = typeof force === 'boolean' ? force : !page.selected;
    this.emit('pages');
  }

  /**
   * Selects or deselects all pages.
   * @param {boolean} selected
   */
  setAllSelected(selected) {
    for (const page of this.pages) {
      page.selected = selected;
    }
    this.emit('pages');
  }

  /**
   * Rotates target pages by delta degrees (e.g. 90, -90, 180) without touching pdf-lib.
   * @param {string[]} pageIds
   * @param {number} deltaDegrees
   */
  rotatePages(pageIds, deltaDegrees) {
    if (pageIds.length === 0) return;
    this.pushUndoSnapshot();
    const set = new Set(pageIds);
    for (const page of this.pages) {
      if (set.has(page.id)) {
        page.rotation = /** @type {0|90|180|270} */ (((page.rotation + deltaDegrees) % 360 + 360) % 360);
      }
    }
    this.emit('pages');
  }

  /**
   * Moves a virtual page from one index to another (drag-and-drop reorder).
   * @param {number} fromIndex
   * @param {number} toIndex
   */
  reorderPage(fromIndex, toIndex) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.pages.length ||
      toIndex >= this.pages.length
    ) {
      return;
    }
    this.pushUndoSnapshot();
    const [moved] = this.pages.splice(fromIndex, 1);
    this.pages.splice(toIndex, 0, moved);
    this.emit('pages');
  }

  /**
   * Interleaves pages across loaded source files in round-robin order.
   */
  interleaveAllSources() {
    if (this.sourceFiles.size < 2) return;
    this.pushUndoSnapshot();
    /** @type {Map<string, VirtualPage[]>} */
    const grouped = new Map();
    for (const page of this.pages) {
      if (!grouped.has(page.sourceFileId)) grouped.set(page.sourceFileId, []);
      grouped.get(page.sourceFileId).push(page);
    }
    const buckets = [...grouped.values()];
    const maxLen = Math.max(...buckets.map((b) => b.length), 0);
    /** @type {VirtualPage[]} */
    const next = [];
    for (let i = 0; i < maxLen; i += 1) {
      for (const bucket of buckets) {
        if (bucket[i]) next.push(bucket[i]);
      }
    }
    this.pages = next;
    this.emit('pages');
  }

  /**
   * Duplicates the specified virtual pages right after each original.
   * @param {string[]} pageIds
   */
  duplicatePages(pageIds) {
    if (pageIds.length === 0) return;
    this.pushUndoSnapshot();
    const set = new Set(pageIds);
    /** @type {VirtualPage[]} */
    const next = [];
    for (const page of this.pages) {
      next.push(page);
      if (set.has(page.id)) {
        next.push({
          ...page,
          id: createUuid(),
          selected: false,
          cropMargins: page.cropMargins ? { ...page.cropMargins } : null,
          blankSpec: page.blankSpec ? { ...page.blankSpec } : null
        });
      }
    }
    this.pages = next;
    this.emit('pages');
  }

  /**
   * Deletes the specified virtual pages from the workspace.
   * @param {string[]} pageIds
   */
  deletePages(pageIds) {
    if (pageIds.length === 0) return;
    this.pushUndoSnapshot();
    const set = new Set(pageIds);
    this.pages = this.pages.filter((p) => !set.has(p.id));
    this.emit('pages');
  }

  /**
   * Builds a fresh blank VirtualPage descriptor.
   * @param {'a4'|'letter'|'legal'|'match'} preset
   * @param {'prev'|'next'} [matchHint='prev']
   * @returns {VirtualPage}
   */
  _createBlankPageDescriptor(preset = 'a4', matchHint = 'prev') {
    return {
      id: createUuid(),
      sourceFileId: '__blank__',
      sourcePageIndex: 0,
      rotation: 0,
      selected: false,
      cropMargins: null,
      blankSpec: {
        preset: preset || 'a4',
        matchHint
      }
    };
  }

  /**
   * Inserts a blank virtual page at the given index (or end of workspace).
   * @param {'a4'|'letter'|'legal'|'match'} preset
   * @param {number} [insertIndex=this.pages.length]
   */
  insertBlankPage(preset = 'a4', insertIndex = this.pages.length) {
    this.pushUndoSnapshot();
    const safeIdx = Math.max(0, Math.min(insertIndex, this.pages.length));
    this.pages.splice(safeIdx, 0, this._createBlankPageDescriptor(preset, 'prev'));
    this.emit('pages');
  }

  /**
   * Inserts a blank page before each selected page (or at index 0 if none selected).
   * @param {'a4'|'letter'|'legal'|'match'} [preset='match']
   */
  insertBlankBeforeSelected(preset = 'match') {
    this.pushUndoSnapshot();
    const hasSelected = this.pages.some((p) => p.selected);
    if (!hasSelected) {
      this.pages.unshift(this._createBlankPageDescriptor(preset, 'next'));
    } else {
      /** @type {VirtualPage[]} */
      const next = [];
      for (const page of this.pages) {
        if (page.selected) {
          next.push(this._createBlankPageDescriptor(preset, 'next'));
        }
        next.push(page);
      }
      this.pages = next;
    }
    this.emit('pages');
  }

  /**
   * Inserts a blank page after each selected page (or at the end if none selected).
   * @param {'a4'|'letter'|'legal'|'match'} [preset='match']
   */
  insertBlankAfterSelected(preset = 'match') {
    this.pushUndoSnapshot();
    const hasSelected = this.pages.some((p) => p.selected);
    if (!hasSelected) {
      this.pages.push(this._createBlankPageDescriptor(preset, 'prev'));
    } else {
      /** @type {VirtualPage[]} */
      const next = [];
      for (const page of this.pages) {
        next.push(page);
        if (page.selected) {
          next.push(this._createBlankPageDescriptor(preset, 'prev'));
        }
      }
      this.pages = next;
    }
    this.emit('pages');
  }

  /**
   * Inserts a blank page after every N pages across the current workspace.
   * @param {number} everyN
   * @param {'a4'|'letter'|'legal'|'match'} [preset='match']
   */
  insertBlankEveryN(everyN = 1, preset = 'match') {
    if (this.pages.length === 0) return;
    const step = Math.max(1, Math.floor(Number(everyN) || 1));
    this.pushUndoSnapshot();
    /** @type {VirtualPage[]} */
    const next = [];
    for (let i = 0; i < this.pages.length; i += 1) {
      next.push(this.pages[i]);
      if ((i + 1) % step === 0) {
        next.push(this._createBlankPageDescriptor(preset, 'prev'));
      }
    }
    this.pages = next;
    this.emit('pages');
  }

  /**
   * Pads the workspace with one trailing blank page if total page count is odd.
   * @param {'a4'|'letter'|'legal'|'match'} [preset='match']
   */
  padToEvenPageCount(preset = 'match') {
    if (this.pages.length === 0 || this.pages.length % 2 === 0) return;
    this.pushUndoSnapshot();
    this.pages.push(this._createBlankPageDescriptor(preset, 'prev'));
    this.emit('pages');
  }

  /**
   * Applies computed auto-crop margins per page ID in a single undoable step.
   * @param {Record<string, { top: number, right: number, bottom: number, left: number }|null>} marginsByPageId
   */
  applyAutoCropResult(marginsByPageId) {
    if (!marginsByPageId) return;
    this.pushUndoSnapshot();
    for (const page of this.pages) {
      if (page.id in marginsByPageId) {
        const m = marginsByPageId[page.id];
        const hasNonZero = m && (m.top > 0 || m.right > 0 || m.bottom > 0 || m.left > 0);
        page.cropMargins = hasNonZero ? { ...m } : null;
      }
    }
    this.emit('pages');
  }

  /**
   * Reorders an entry in the Batch Bates PDF queue.
   * @param {number} fromIdx
   * @param {number} toIdx
   */
  moveBatesQueueItem(fromIdx, toIdx) {
    const q = this.tools.numbering.batesQueue;
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= q.length || toIdx >= q.length) {
      return;
    }
    const [moved] = q.splice(fromIdx, 1);
    q.splice(toIdx, 0, moved);
    this.emit('tool');
  }

  /**
   * Removes an entry from the Batch Bates PDF queue (without deleting the source file).
   * @param {string} sourceFileId
   */
  removeBatesQueueItem(sourceFileId) {
    this.tools.numbering.batesQueue = this.tools.numbering.batesQueue.filter(
      (id) => id !== sourceFileId
    );
    this.emit('tool');
  }

  /**
   * Syncs any loaded PDF files back into the Bates queue.
   */
  syncBatesQueueWithSources() {
    const pdfIds = [...this.sourceFiles.values()]
      .filter((s) => s.type === 'pdf')
      .map((s) => s.id);
    const existing = new Set(this.tools.numbering.batesQueue);
    for (const id of pdfIds) {
      if (!existing.has(id)) {
        this.tools.numbering.batesQueue.push(id);
      }
    }
    this.emit('tool');
  }

  /**
   * Applies crop margin insets (in points) to target virtual pages.
   * @param {string[]} pageIds
   * @param {{ top: number, right: number, bottom: number, left: number }|null} margins
   */
  applyCropMargins(pageIds, margins) {
    if (pageIds.length === 0) return;
    this.pushUndoSnapshot();
    const set = new Set(pageIds);
    const hasNonZero =
      margins &&
      (margins.top > 0 || margins.right > 0 || margins.bottom > 0 || margins.left > 0);
    for (const page of this.pages) {
      if (set.has(page.id)) {
        page.cropMargins = hasNonZero ? { ...margins } : null;
      }
    }
    this.emit('pages');
  }

  /**
   * Sets active inspector tool tab.
   * @param {ToolTabId} toolId
   */
  setActiveTool(toolId) {
    this.activeTool = toolId;
    this.emit('tool');
  }

  /**
   * Updates background job status.
   * @param {Partial<{ active: boolean, requestId: string|null, percent: number, stage: string }>} patch
   */
  setJobStatus(patch) {
    Object.assign(this.job, patch);
    this.emit('job');
  }

  /**
   * Displays a toast/modal notice.
   * @param {'error'|'warning'|'success'|'info'} type
   * @param {string} title
   * @param {string} message
   */
  showNotice(type, title, message) {
    this.notice = {
      id: createUuid(),
      type,
      title,
      message
    };
    this.emit('notice');
  }

  /**
   * Dismisses the current notice.
   */
  clearNotice() {
    this.notice = null;
    this.emit('notice');
  }

  /**
   * Closes the high-res preview modal and revokes its temporary ObjectURL.
   */
  closePreview() {
    if (this.preview.imageUrl) {
      globalUrlTracker.revoke(this.preview.imageUrl);
    }
    this.preview = {
      pageId: null,
      loading: false,
      imageUrl: null
    };
    this.emit('preview');
  }
}

export const workspace = new WorkspaceStore();
