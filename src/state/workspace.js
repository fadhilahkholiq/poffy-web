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
 * @typedef {'organize'|'split'|'watermark'|'numbering'|'convert'|'metadata'|'forms'|'optimize'} ToolTabId
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
      blankSize: 'a4',
      cropTop: 0,
      cropRight: 0,
      cropBottom: 0,
      cropLeft: 0
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
      opacity: 0.85
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
      applyOnExport: false
    },
    forms: {
      targetFileId: '',
      fields: [],
      values: {},
      flatten: true,
      loading: false
    },
    optimize: {
      useObjectStreams: true,
      rebuildCleanCopy: true,
      stripMetadata: false
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
    /** @type {ToolTabId} */
    this.activeTool = 'organize';
    this.tools = createDefaultToolConfig();

    /** @type {{ active: boolean, requestId: string|null, percent: number, stage: string }} */
    this.job = {
      active: false,
      requestId: null,
      percent: 0,
      stage: ''
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
  }

  /**
   * Restores the previous virtual page layout.
   * @returns {boolean}
   */
  undo() {
    if (this.undoStack.length === 0) return false;
    this.pages = this.undoStack.pop();
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

    // Initialize metadata/forms target if none selected yet
    if (entry.type === 'pdf') {
      if (!this.tools.metadata.targetFileId) {
        this.tools.metadata.targetFileId = entry.id;
        this.hydrateMetadataFields(entry.metadata);
      }
      if (!this.tools.forms.targetFileId) {
        this.tools.forms.targetFileId = entry.id;
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

    if (this.tools.metadata.targetFileId === sourceFileId) {
      const nextPdf = [...this.sourceFiles.values()].find((s) => s.type === 'pdf');
      this.tools.metadata.targetFileId = nextPdf ? nextPdf.id : '';
      if (nextPdf) this.hydrateMetadataFields(nextPdf.metadata);
    }
    if (this.tools.forms.targetFileId === sourceFileId) {
      const nextPdf = [...this.sourceFiles.values()].find((s) => s.type === 'pdf');
      this.tools.forms.targetFileId = nextPdf ? nextPdf.id : '';
      this.tools.forms.fields = [];
      this.tools.forms.values = {};
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
   * Inserts a blank virtual page at the given index (or end of workspace).
   * @param {'a4'|'letter'|'legal'|'match'} preset
   * @param {number} [insertIndex=this.pages.length]
   */
  insertBlankPage(preset = 'a4', insertIndex = this.pages.length) {
    this.pushUndoSnapshot();
    const safeIdx = Math.max(0, Math.min(insertIndex, this.pages.length));
    /** @type {VirtualPage} */
    const blankPage = {
      id: createUuid(),
      sourceFileId: '__blank__',
      sourcePageIndex: 0,
      rotation: 0,
      selected: false,
      cropMargins: null,
      blankSpec: {
        preset: preset === 'match' ? 'a4' : preset
      }
    };
    this.pages.splice(safeIdx, 0, blankPage);
    this.emit('pages');
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
