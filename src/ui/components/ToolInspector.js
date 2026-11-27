import { formatBytes, readFileAsArrayBuffer } from '../../core/utils/file-io.js';
import { formatBatesLabel } from '../../core/utils/bates-format.js';
import { isWinAnsiCompatible } from '../../core/utils/winansi.js';
import { PAPER_PRESETS, fromPoints, toPoints } from '../../core/pdf/geometry.js';
import { computeImpositionPlan } from '../../core/pdf/imposition-plan.js';
import { workspace } from '../../state/workspace.js';
import {
  exportWorkspacePdf,
  inspectFormsForTarget,
  loadSpreadsPreview,
  requestColorFilterPreview,
  runBatchBatesJob,
  runBatchExtractTextZipJob,
  runCbzToPdfJob,
  runColorFiltersJob,
  runComparePdfJob,
  runDownloadAllExtractedImagesZipJob,
  runExtractImagesJob,
  runExtractTextJob,
  runFindRedactionMatchesJob,
  runFormsJob,
  runImagesToPdfJob,
  runImpositionJob,
  runInspectAttachmentsJob,
  runMetadataJob,
  runOptimizeJob,
  runPackageAttachmentsZipJob,
  runPdfToCbzJob,
  runPdfToImagesJob,
  runPrivacyAuditForTarget,
  runReadOutlinesJob,
  runRedactPdfJob,
  runResizePdfJob,
  runSignAnnotateJob,
  runSplitJob,
  runSplitSpreadsJob,
  runUpdateAttachmentsJob,
  runWriteOutlinesJob,
  downloadExtractedTextFile,
  downloadSingleAttachment,
  downloadSingleExtractedImage,
  loadCbzArchiveFile,
  setCompareFile,
  useWorkspacePdfForCompare
} from '../actions/export-runner.js';
import { el, mount, sanitizeImageSrc } from '../utils/dom.js';
import { getToolIcon } from '../utils/tool-icons.js';
import { getToolStyleBySlug } from '../utils/tool-styles.js';
import { createClaySelect } from './ClaySelect.js';

/**
 * Full 22-tool studio rail metadata mapped cleanly onto workspace ToolTabId panels.
 * @type {{ id: import('../../state/workspace.js').ToolTabId, slug: string, label: string, group: 'pages'|'edit'|'convert'|'docs' }[]}
 */
const TOOL_TABS = [
  { id: 'organize', slug: 'merge-pdf', label: 'Merge & Reorder', group: 'pages' },
  { id: 'split', slug: 'split-pdf', label: 'Split & Extract', group: 'pages' },
  { id: 'organize', slug: 'organize-pdf', label: 'Rotate & Crop', group: 'pages' },
  { id: 'resize', slug: 'resize-pdf', label: 'Resize Pages', group: 'pages' },
  { id: 'nup', slug: 'nup-booklet', label: 'Booklet & N-Up', group: 'pages' },
  { id: 'spreads', slug: 'split-spreads', label: 'Split Book Scans', group: 'pages' },
  { id: 'watermark', slug: 'watermark-pdf', label: 'Watermark & Stamp', group: 'edit' },
  { id: 'metadata', slug: 'metadata-scrubber', label: 'Privacy Scrubber', group: 'edit' },
  { id: 'redact', slug: 'redact-pdf', label: 'True Redact', group: 'edit' },
  { id: 'sign', slug: 'sign-annotate', label: 'Sign & Annotate', group: 'edit' },
  { id: 'forms', slug: 'flatten-pdf', label: 'Flatten Forms', group: 'edit' },
  { id: 'filters', slug: 'color-filters', label: 'Dark Mode & Cleanup', group: 'edit' },
  { id: 'convert', slug: 'images-to-pdf', label: 'Images to PDF', group: 'convert' },
  { id: 'convert', slug: 'pdf-to-images', label: 'PDF to Images', group: 'convert' },
  { id: 'cbz', slug: 'cbz-pdf', label: 'CBZ ↔ PDF', group: 'convert' },
  { id: 'extract-text', slug: 'extract-text', label: 'Extract Text', group: 'convert' },
  { id: 'extract-images', slug: 'extract-images', label: 'Extract Images', group: 'convert' },
  { id: 'optimize', slug: 'optimize-pdf', label: 'Compress PDF', group: 'docs' },
  { id: 'numbering', slug: 'page-numbers', label: 'Page Numbers', group: 'docs' },
  { id: 'compare', slug: 'compare-pdf', label: 'Compare Versions', group: 'docs' },
  { id: 'attachments', slug: 'pdf-attachments', label: 'Attachments', group: 'docs' },
  { id: 'bookmarks', slug: 'bookmark-editor', label: 'Bookmark Editor', group: 'docs' }
];

/** @type {'all'|'pages'|'edit'|'convert'|'docs'} */
let inspectorToolGroup = 'all';
let inspectorSearchQuery = '';
/** @type {string|null} */
let activeRailSlug = document.documentElement.dataset.feature || null;

/**
 * Selects a specific tool slug and switches the workspace active tool cleanly.
 * @param {import('../../state/workspace.js').ToolTabId} toolId
 * @param {string} slug
 */
export function selectStudioTool(toolId, slug) {
  activeRailSlug = slug || null;
  workspace.setActiveTool(toolId);
}

/**
 * Resolves the active 22-tool rail entry matching `workspace.activeTool`.
 */
function resolveActiveTab() {
  if (activeRailSlug) {
    const bySlug = TOOL_TABS.find((t) => t.slug === activeRailSlug && t.id === workspace.activeTool);
    if (bySlug) return bySlug;
  }
  return TOOL_TABS.find((t) => t.id === workspace.activeTool) || TOOL_TABS[0];
}

/**
 * Helper to create a labeled input or select control safely.
 * @param {string} labelText
 * @param {HTMLElement} controlEl
 * @param {string} [labelClass='text-[12px] text-[#6e6e73] block']
 * @returns {HTMLElement}
 */
function labeledField(labelText, controlEl, labelClass = 'text-[12px] text-[#6e6e73] block') {
  return el('label', { className: labelClass }, labelText, controlEl);
}

/**
 * Helper to create a crafted Clay dropdown from [value, label] pairs.
 * @param {string} id
 * @param {string} className
 * @param {string|number} currentValue
 * @param {[string|number, string][]} options
 * @param {(val: string) => void} onChange
 * @returns {HTMLElement}
 */
function selectControl(id, className, currentValue, options, onChange) {
  return createClaySelect({
    id,
    className,
    currentValue,
    options,
    onChange
  });
}

/**
 * Builds the PDF source selector dropdown for single-file tools (Metadata / Forms).
 * @param {string} selectId
 * @param {string} currentFileId
 * @param {(id: string) => void} onChange
 * @returns {HTMLElement}
 */
function buildPdfSourceSelect(selectId, currentFileId, onChange) {
  const pdfSources = [...workspace.sourceFiles.values()].filter((s) => s.type === 'pdf');
  if (pdfSources.length === 0) {
    return el(
      'p',
      { className: 'type-caption text-[#6e6e73]' },
      'Upload at least one PDF file to use this inspector.'
    );
  }
  const sel = selectControl(
    selectId,
    'input-clay',
    currentFileId,
    pdfSources.map((s) => [s.id, `${s.name} (${s.pageCount} pages)`]),
    onChange
  );
  return el(
    'div',
    { className: 'space-y-1.5' },
    el('label', { for: selectId, className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Target Source PDF'),
    sel
  );
}

/**
 * Mounts the live side-by-side Original vs Filtered comparison card into a target container.
 * @param {HTMLElement} slot
 */
function mountFilterPreviewInto(slot) {
  const flt = workspace.tools.filters;
  const origSrc = sanitizeImageSrc(flt.previewOriginalUrl);
  const filtSrc = sanitizeImageSrc(flt.previewFilteredUrl);

  const renderBox = (label, imgSrc, emptyText) =>
    el(
      'div',
      { className: 'space-y-1' },
      el('p', { className: 'text-[11px] font-medium text-[#6e6e73] text-center' }, label),
      el(
        'div',
        {
          className:
            'rounded-[8px] border border-[#e5e5ea] bg-white overflow-hidden min-h-[120px] flex items-center justify-center p-1'
        },
        imgSrc
          ? el('img', {
              src: imgSrc,
              alt: `${label} page preview`,
              className: 'w-full h-auto max-h-40 object-contain block'
            })
          : el('span', { className: 'text-[11px] text-[#6e6e73] text-center px-2' }, emptyText)
      )
    );

  mount(
    slot,
    el(
      'div',
      { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
      el(
        'div',
        { className: 'flex items-center justify-between gap-2' },
        el('span', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, 'Live Preview'),
        el(
          'div',
          { className: 'flex items-center gap-1.5' },
          flt.previewOtsuThreshold !== null
            ? el(
                'span',
                { className: 'px-2 py-0.5 rounded-full bg-white border border-[#e5e5ea] text-[10px] font-medium' },
                `Otsu T=${flt.previewOtsuThreshold}`
              )
            : null,
          flt.previewLoading
            ? el('span', { className: 'text-[11px] text-[#6e6e73]' }, 'Updating...')
            : null
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        renderBox('Original', origSrc, 'Waiting...'),
        renderBox('Filtered', filtSrc, flt.previewLoading ? 'Filtering...' : 'Pending')
      )
    )
  );
}

/**
 * Updates only the filter preview DOM slot without rebuilding slider controls.
 */
export function updateFilterPreviewDom() {
  const slot = document.getElementById('filter-preview-slot');
  if (slot) {
    mountFilterPreviewInto(slot);
  }
}

/**
 * Renders the Left Studio Tool Rail (grouped switcher + filter) using safe DOM APIs only.
 * @param {HTMLElement} container
 */
export function renderToolRail(container) {
  const activeTab = resolveActiveTab();

  const GROUP_FILTERS = /** @type {const} */ ([
    { id: 'all', label: `All (${TOOL_TABS.length})` },
    { id: 'pages', label: 'Pages' },
    { id: 'edit', label: 'Edit' },
    { id: 'convert', label: 'Convert' },
    { id: 'docs', label: 'Inspect' }
  ]);

  const tabList = el(
    'div',
    {
      className: 'flex flex-wrap lg:flex-col gap-1',
      role: 'tablist',
      'aria-label': 'Editor PDF tools'
    },
    TOOL_TABS.map((tab) => {
      const isActive = tab.slug === activeTab.slug;
      const st = getToolStyleBySlug(tab.slug);
      return el(
        'button',
        {
          type: 'button',
          role: 'tab',
          dataset: { tabLabel: tab.label.toLowerCase(), tabGroup: tab.group, toolId: tab.id, toolSlug: tab.slug },
          'aria-selected': String(isActive),
          className: `studio-rail-btn ${isActive ? 'is-active' : ''}`,
          onClick: () => {
            activeRailSlug = tab.slug;
            workspace.setActiveTool(
              /** @type {import('../../state/workspace.js').ToolTabId} */ (tab.id)
            );
          }
        },
        el(
          'span',
          {
            className: 'w-5 h-5 rounded-[6px] flex items-center justify-center shrink-0',
            style: isActive
              ? { backgroundColor: 'rgba(255,255,255,0.2)', color: '#ffffff' }
              : { backgroundColor: st.bg, color: st.fg },
            'aria-hidden': 'true'
          },
          getToolIcon(tab.slug, 12)
        ),
        el('span', { className: 'truncate' }, tab.label)
      );
    })
  );

  const visibleCountEl = el(
    'span',
    { className: 'text-[11px] font-medium text-[#86868b] shrink-0' },
    `${TOOL_TABS.length} tools`
  );

  const groupRow = el('div', { className: 'flex flex-wrap items-center gap-1' });

  const applyTabFilters = () => {
    const q = inspectorSearchQuery.trim().toLowerCase();
    let visibleCount = 0;
    for (const btn of tabList.children) {
      const node = /** @type {HTMLElement} */ (btn);
      const lbl = node.dataset.tabLabel || '';
      const grp = node.dataset.tabGroup || '';
      const isSel = node.getAttribute('aria-selected') === 'true';
      const matchesGroup = inspectorToolGroup === 'all' || grp === inspectorToolGroup;
      const matchesQuery = !q || lbl.includes(q);
      const show = (matchesGroup && matchesQuery) || (isSel && !q);
      node.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    }
    visibleCountEl.textContent = `${visibleCount} shown`;

    for (const pill of groupRow.children) {
      const btn = /** @type {HTMLButtonElement} */ (pill);
      const active = btn.dataset.group === inspectorToolGroup;
      btn.className = `inspector-group-pill ${active ? 'is-active' : ''}`;
      btn.setAttribute('aria-pressed', String(active));
    }
  };

  for (const g of GROUP_FILTERS) {
    groupRow.append(
      el(
        'button',
        {
          type: 'button',
          dataset: { group: g.id },
          'aria-pressed': String(g.id === inspectorToolGroup),
          className: `inspector-group-pill ${g.id === inspectorToolGroup ? 'is-active' : ''}`,
          onClick: () => {
            inspectorToolGroup = g.id;
            applyTabFilters();
          }
        },
        g.label
      )
    );
  }

  const tabFilterInput = el('input', {
    id: 'inspector-tool-search',
    type: 'search',
    value: inspectorSearchQuery,
    placeholder: 'Filter tools',
    'aria-label': 'Filter studio tools',
    className: 'input-clay !h-9 !rounded-[10px] !px-3 text-[12.5px] w-full',
    onInput: (e) => {
      inspectorSearchQuery = /** @type {HTMLInputElement} */ (e.target).value;
      applyTabFilters();
    }
  });

  applyTabFilters();

  const rail = el(
    'nav',
    { className: 'p-3.5 space-y-3', 'aria-label': 'Studio tools' },
    el(
      'div',
      { className: 'flex items-center justify-between gap-2 px-1' },
      el('span', { className: 'type-caption-upper text-[#86868b]' }, 'Tools'),
      visibleCountEl
    ),
    tabFilterInput,
    groupRow,
    tabList
  );

  mount(container, rail);
}

/**
 * Renders the contextual Right Tool Inspector panel using safe DOM APIs only.
 * @param {HTMLElement} container
 */
export function renderToolInspector(container) {
  const activeTab = resolveActiveTab();
  const st = getToolStyleBySlug(activeTab.slug);

  const headerCard = el(
    'div',
    {
      className:
        'pb-3.5 border-b border-black/[0.08] flex items-center justify-between gap-2.5'
    },
    el(
      'div',
      { className: 'flex items-center gap-2.5 min-w-0' },
      el(
        'span',
        {
          className: 'w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0',
          style: { backgroundColor: st.bg, color: st.fg }
        },
        getToolIcon(activeTab.slug, 18)
      ),
      el(
        'div',
        { className: 'min-w-0' },
        el(
          'span',
          { className: 'type-title-sm text-[#1d1d1f] block truncate' },
          activeTab.label
        ),
        el('span', { className: 'text-[11.5px] text-[#86868b] block' }, 'Local Web Worker')
      )
    )
  );

  const body = el('div', { id: 'tool-panel-body', className: 'space-y-4' }, buildToolBody(activeTab.id));

  const aside = el(
    'aside',
    { className: 'p-4 sm:p-5 space-y-4' },
    headerCard,
    body
  );

  mount(container, aside);
}

/**
 * Builds DOM children for the active tool tab.
 * @param {import('../../state/workspace.js').ToolTabId} tabId
 * @returns {HTMLElement}
 */
function buildToolBody(tabId) {
  const t = workspace.tools;
  const selectedCount = workspace.pages.filter((p) => p.selected).length;

  if (tabId === 'organize') {
    const o = t.organize;
    const cropTop = /** @type {HTMLInputElement} */ (
      el('input', {
        type: 'number',
        min: '0',
        max: '400',
        value: String(o.cropTop),
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          o.cropTop = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
        }
      })
    );
    const cropBottom = /** @type {HTMLInputElement} */ (
      el('input', {
        type: 'number',
        min: '0',
        max: '400',
        value: String(o.cropBottom),
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          o.cropBottom = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
        }
      })
    );
    const cropLeft = /** @type {HTMLInputElement} */ (
      el('input', {
        type: 'number',
        min: '0',
        max: '400',
        value: String(o.cropLeft),
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          o.cropLeft = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
        }
      })
    );
    const cropRight = /** @type {HTMLInputElement} */ (
      el('input', {
        type: 'number',
        min: '0',
        max: '400',
        value: String(o.cropRight),
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          o.cropRight = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
        }
      })
    );

    return el(
      'div',
      { className: 'space-y-4' },
      el(
        'div',
        { className: 'space-y-2' },
        el('p', { className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Multi-PDF Merge Order'),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-9 !px-2 !text-[12px] whitespace-nowrap',
              disabled: workspace.sourceFiles.size < 2,
              onClick: () => workspace.interleaveAllSources()
            },
            'Interleave Pages'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-primary !h-9 !px-2 !text-[12px] whitespace-nowrap',
              onClick: exportWorkspacePdf
            },
            'Export Merged PDF'
          )
        ),
        el(
          'label',
          { className: 'inline-flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer pt-1' },
          el('input', {
            id: 'org-auto-bookmarks',
            type: 'checkbox',
            checked: Boolean(o.autoBookmarks),
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              o.autoBookmarks = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          }),
          'Generate bookmarks from filenames (Auto-TOC)'
        ),
        el(
          'p',
          { className: 'type-caption text-[#6e6e73]' },
          'Drag any page card in the grid to reorder, or interleave pages 1-by-1 across uploaded PDFs.'
        )
      ),
      el('hr', { className: 'border-[#e5e5ea]' }),
      el(
        'div',
        { className: 'space-y-2.5' },
        el(
          'div',
          { className: 'flex flex-wrap items-center justify-between gap-2' },
          el('label', { for: 'org-blank-size', className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Insert Blank Pages'),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 !px-2.5 !text-[11.5px] shrink-0 whitespace-nowrap',
              onClick: () => {
                o.autoCropModalOpen = true;
                workspace.emit('tool');
              }
            },
            'Auto-Crop Whitespace'
          )
        ),
        el(
          'div',
          { className: 'flex gap-2' },
          selectControl(
            'org-blank-size',
            'input-clay !h-10 flex-1',
            o.blankSize,
            [
              ['match', 'Match Adjacent Page Size'],
              ['a4', 'A4 (595 × 842 pt)'],
              ['letter', 'Letter (612 × 792 pt)'],
              ['legal', 'Legal (612 × 1008 pt)']
            ],
            (val) => {
              o.blankSize = val;
            }
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-10 !px-3 shrink-0',
              title: 'Append blank page at end',
              onClick: () => workspace.insertBlankPage(o.blankSize)
            },
            '+ Append'
          )
        ),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-1.5' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 !px-2.5 !text-[12px]',
              onClick: () => workspace.insertBlankBeforeSelected(o.blankSize)
            },
            'Before Selected'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 !px-2.5 !text-[12px]',
              onClick: () => workspace.insertBlankAfterSelected(o.blankSize)
            },
            'After Selected'
          )
        ),
        el(
          'div',
          { className: 'flex flex-wrap items-center gap-1.5' },
          el('span', { className: 'text-[12px] text-[#6e6e73] shrink-0' }, 'Every'),
          el('input', {
            id: 'org-blank-every-n',
            type: 'number',
            min: '1',
            max: '100',
            value: String(o.blankEveryN || 1),
            className: 'input-clay !h-8 !w-14 !px-2 text-center text-[12px]',
            onInput: (e) => {
              o.blankEveryN = Math.max(1, Number(/** @type {HTMLInputElement} */ (e.target).value) || 1);
            }
          }),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 !px-2 !text-[11.5px] flex-1 whitespace-nowrap',
              onClick: () => workspace.insertBlankEveryN(o.blankEveryN || 1, o.blankSize)
            },
            'Insert Every N'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 !px-2 !text-[11.5px] shrink-0 whitespace-nowrap',
              title: 'Append 1 blank page if total count is odd',
              onClick: () => workspace.padToEvenPageCount(o.blankSize)
            },
            'Pad Even'
          )
        )
      ),
      el('hr', { className: 'border-[#e5e5ea]' }),
      el(
        'div',
        { className: 'space-y-2.5' },
        el(
          'p',
          { className: 'text-[13px] font-medium text-[#1d1d1f]' },
          `Crop Margins (pt) · ${selectedCount > 0 ? `${selectedCount} selected` : 'All pages'}`
        ),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          labeledField('Top', cropTop),
          labeledField('Bottom', cropBottom),
          labeledField('Left', cropLeft),
          labeledField('Right', cropRight)
        ),
        el(
          'div',
          { className: 'flex gap-2' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-10 flex-1',
              onClick: () => {
                const targetIds = workspace.getTargetPages(true).map((p) => p.id);
                workspace.applyCropMargins(targetIds, {
                  top: Number(cropTop.value) || 0,
                  right: Number(cropRight.value) || 0,
                  bottom: Number(cropBottom.value) || 0,
                  left: Number(cropLeft.value) || 0
                });
              }
            },
            'Apply Crop'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-compact !h-10',
              onClick: () => {
                o.cropTop = 0;
                o.cropRight = 0;
                o.cropBottom = 0;
                o.cropLeft = 0;
                const targetIds = workspace.getTargetPages(true).map((p) => p.id);
                workspace.applyCropMargins(targetIds, null);
                workspace.emit('tool');
              }
            },
            'Clear'
          )
        )
      )
    );
  }

  if (tabId === 'split') {
    const s = t.split;
    const rangeInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'split-range',
        type: 'text',
        value: s.rangeExpression,
        placeholder: 'e.g. 1-3, 5, 8-end',
        className: 'input-clay',
        onInput: (e) => {
          s.rangeExpression = /** @type {HTMLInputElement} */ (e.target).value;
        }
      })
    );
    rangeInput.value = s.rangeExpression;

    const everyNInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'split-every-n',
        type: 'number',
        min: '1',
        max: '500',
        value: String(s.everyN),
        className: 'input-clay',
        onInput: (e) => {
          s.everyN = Math.max(1, Number(/** @type {HTMLInputElement} */ (e.target).value) || 1);
        }
      })
    );

    return el(
      'div',
      { className: 'space-y-4' },
      el(
        'div',
        { className: 'space-y-1.5' },
        el('label', { for: 'split-mode', className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Split Strategy'),
        selectControl(
          'split-mode',
          'input-clay',
          s.mode,
          [
            ['ranges', 'Custom Page Ranges (ZIP)'],
            ['extract', 'Extract Selected/Range (Single PDF)'],
            ['every_n', 'Split Every N Pages (ZIP)'],
            ['burst', 'Burst Every Page (ZIP)']
          ],
          (val) => {
            s.mode = val;
            workspace.emit('tool');
          }
        )
      ),
      s.mode === 'ranges' || s.mode === 'extract'
        ? el(
            'div',
            { className: 'space-y-1.5' },
            el('label', { for: 'split-range', className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Page Range Expression'),
            rangeInput,
            el(
              'p',
              { className: 'type-caption text-[#6e6e73]' },
              s.mode === 'extract' && selectedCount > 0
                ? `${selectedCount} selected grid pages will be extracted (or deselect to use range).`
                : 'Comma-separated ranges create separate PDFs bundled into a .zip archive.'
            )
          )
        : null,
      s.mode === 'every_n'
        ? el(
            'div',
            { className: 'space-y-1.5' },
            el('label', { for: 'split-every-n', className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Pages per chunk (N)'),
            everyNInput
          )
        : null,
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: () => runSplitJob()
        },
        s.mode === 'extract' ? 'Extract PDF' : 'Split & Download'
      )
    );
  }

  if (tabId === 'watermark') {
    const w = t.watermark;
    const unicodeNeeded = w.kind === 'text' && !isWinAnsiCompatible(w.text);
    const enabledCheck = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'wm-enabled',
        type: 'checkbox',
        checked: w.enabled,
        className: 'w-4 h-4 accent-[#1d1d1f]',
        onChange: (e) => {
          w.enabled = /** @type {HTMLInputElement} */ (e.target).checked;
        }
      })
    );

    const unicodeBadge = el(
      'span',
      {
        id: 'wm-unicode-badge',
        className: `text-[11px] font-medium px-2 py-0.5 rounded-full ${
          unicodeNeeded ? 'bg-[#e8f2ff] text-[#1d1d1f]' : 'bg-[#f5f5f7] text-[#6e6e73]'
        }`
      },
      unicodeNeeded ? 'Unicode TTF Active' : 'WinAnsi/Standard'
    );

    const textInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'wm-text',
        type: 'text',
        value: w.text,
        placeholder: 'CONFIDENTIAL',
        className: 'input-clay',
        onInput: (e) => {
          w.text = /** @type {HTMLInputElement} */ (e.target).value;
          w.enabled = true;
          enabledCheck.checked = true;
          const needsUni = !isWinAnsiCompatible(w.text);
          unicodeBadge.textContent = needsUni ? 'Unicode TTF Active' : 'WinAnsi/Standard';
          unicodeBadge.className = `text-[11px] font-medium px-2 py-0.5 rounded-full ${
            needsUni ? 'bg-[#e8f2ff] text-[#1d1d1f]' : 'bg-[#f5f5f7] text-[#6e6e73]'
          }`;
        }
      })
    );
    textInput.value = w.text;

    const opacityLabel = el('span', { id: 'wm-opacity-val' }, `${Math.round(w.opacity * 100)}%`);
    const scaleLabel = el('span', { id: 'wm-scale-val' }, `${Math.round(w.scale * 100)}%`);

    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'label',
        {
          className:
            'flex items-center justify-between gap-3 p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] cursor-pointer'
        },
        el('span', { className: 'text-[14px] font-medium text-[#1d1d1f]' }, 'Include Watermark on Export'),
        enabledCheck
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        el(
          'button',
          {
            type: 'button',
            className: `btn-compact !h-9 ${
              w.kind === 'text' ? '!bg-[#1d1d1f] !text-white !border-[#1d1d1f]' : ''
            }`,
            onClick: () => {
              w.kind = 'text';
              workspace.emit('tool');
            }
          },
          'Text Stamp'
        ),
        el(
          'button',
          {
            type: 'button',
            className: `btn-compact !h-9 ${
              w.kind === 'image' ? '!bg-[#1d1d1f] !text-white !border-[#1d1d1f]' : ''
            }`,
            onClick: () => {
              w.kind = 'image';
              workspace.emit('tool');
            }
          },
          'Image Stamp'
        )
      ),
      w.kind === 'text'
        ? el(
            'div',
            { className: 'space-y-3' },
            el(
              'div',
              { className: 'space-y-1' },
              el(
                'div',
                { className: 'flex items-center justify-between' },
                el('label', { for: 'wm-text', className: 'text-[13px] font-medium' }, 'Watermark Text'),
                unicodeBadge
              ),
              textInput
            ),
            el(
              'div',
              { className: 'grid grid-cols-2 gap-2' },
              labeledField(
                'Font',
                selectControl(
                  'wm-font',
                  'input-clay !h-10 mt-1',
                  w.fontFamily,
                  [
                    ['HelveticaBold', 'Helvetica Bold'],
                    ['Helvetica', 'Helvetica'],
                    ['TimesRoman', 'Times Roman'],
                    ['Courier', 'Courier'],
                    ['Inter', 'Inter (Unicode TTF)']
                  ],
                  (val) => {
                    w.fontFamily = val;
                  }
                )
              ),
              labeledField(
                'Position',
                selectControl(
                  'wm-pos',
                  'input-clay !h-10 mt-1',
                  w.position,
                  [
                    ['center', 'Center'],
                    ['tiled', 'Diagonal Tiled Grid'],
                    ['top-left', 'Top Left'],
                    ['top-right', 'Top Right'],
                    ['bottom-left', 'Bottom Left'],
                    ['bottom-right', 'Bottom Right']
                  ],
                  (val) => {
                    w.position = val;
                  }
                )
              )
            ),
            el(
              'div',
              { className: 'grid grid-cols-3 gap-2' },
              labeledField(
                'Size (pt)',
                el('input', {
                  type: 'number',
                  min: '8',
                  max: '200',
                  value: String(w.fontSize),
                  className: 'input-clay !h-9 mt-1',
                  onInput: (e) => {
                    w.fontSize = Number(/** @type {HTMLInputElement} */ (e.target).value) || 48;
                  }
                })
              ),
              labeledField(
                'Angle (°)',
                el('input', {
                  type: 'number',
                  min: '-180',
                  max: '180',
                  value: String(w.rotation),
                  className: 'input-clay !h-9 mt-1',
                  onInput: (e) => {
                    w.rotation = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
                  }
                })
              ),
              labeledField(
                'Color',
                el('input', {
                  type: 'color',
                  value: w.color,
                  className: 'input-clay !h-9 !p-1 mt-1 cursor-pointer',
                  onInput: (e) => {
                    w.color = /** @type {HTMLInputElement} */ (e.target).value;
                  }
                })
              )
            )
          )
        : el(
            'div',
            { className: 'space-y-3' },
            el(
              'div',
              { className: 'space-y-1.5' },
              el('label', { className: 'text-[13px] font-medium block' }, 'Upload PNG/JPG Stamp'),
              el('input', {
                type: 'file',
                accept: 'image/png,image/jpeg',
                className:
                  'block w-full text-[13px] text-[#424245] file:mr-3 file:py-2 file:px-3 file:rounded-[8px] file:border file:border-[#e5e5ea] file:bg-[#f2f2f7] file:text-[#1d1d1f] file:font-medium cursor-pointer',
                onChange: async (e) => {
                  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
                  if (!file) return;
                  const buf = await readFileAsArrayBuffer(file);
                  w.imageBytes = buf;
                  w.imageFormat =
                    file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
                      ? 'png'
                      : 'jpg';
                  w.imageName = file.name;
                  w.enabled = true;
                  workspace.emit('tool');
                }
              }),
              w.imageName
                ? el('p', { className: 'type-caption text-[#0071e3]' }, `Loaded stamp: ${w.imageName}`)
                : null
            ),
            el(
              'div',
              { className: 'grid grid-cols-2 gap-2' },
              labeledField(
                'Position',
                selectControl(
                  'wm-img-pos',
                  'input-clay !h-10 mt-1',
                  w.position,
                  [
                    ['bottom-right', 'Bottom Right'],
                    ['bottom-left', 'Bottom Left'],
                    ['top-right', 'Top Right'],
                    ['top-left', 'Top Left'],
                    ['center', 'Center']
                  ],
                  (val) => {
                    w.position = val;
                  }
                )
              ),
              el(
                'label',
                { className: 'text-[12px] text-[#6e6e73]' },
                'Width Scale (',
                scaleLabel,
                ')',
                el('input', {
                  type: 'range',
                  min: '0.08',
                  max: '0.85',
                  step: '0.02',
                  value: String(w.scale),
                  className: 'w-full mt-2.5 accent-[#1d1d1f]',
                  onInput: (e) => {
                    w.scale = Number(/** @type {HTMLInputElement} */ (e.target).value);
                    scaleLabel.textContent = `${Math.round(w.scale * 100)}%`;
                  }
                })
              )
            )
          ),
      el(
        'label',
        { className: 'block text-[12px] text-[#6e6e73]' },
        'Opacity (',
        opacityLabel,
        ')',
        el('input', {
          type: 'range',
          min: '0.05',
          max: '1',
          step: '0.05',
          value: String(w.opacity),
          className: 'w-full mt-1.5 accent-[#1d1d1f]',
          onInput: (e) => {
            w.opacity = Number(/** @type {HTMLInputElement} */ (e.target).value);
            opacityLabel.textContent = `${Math.round(w.opacity * 100)}%`;
          }
        })
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: () => {
            w.enabled = true;
            exportWorkspacePdf();
          }
        },
        'Export PDF with Watermark'
      )
    );
  }

  if (tabId === 'numbering') {
    const n = t.numbering;
    const isBates = n.mode === 'bates';

    const modeTabs = el(
      'div',
      { className: 'grid grid-cols-2 gap-1.5 p-1 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea]' },
      el(
        'button',
        {
          type: 'button',
          className: `h-8 rounded-[9px] text-[12px] font-medium transition-colors ${
            !isBates ? 'bg-[#1d1d1f] text-white' : 'text-[#555] hover:text-[#1d1d1f]'
          }`,
          onClick: () => {
            n.mode = 'single';
            workspace.emit('tool');
          }
        },
        'Single File'
      ),
      el(
        'button',
        {
          type: 'button',
          className: `h-8 rounded-[9px] text-[12px] font-medium transition-colors ${
            isBates ? 'bg-[#1d1d1f] text-white' : 'text-[#555] hover:text-[#1d1d1f]'
          }`,
          onClick: () => {
            n.mode = 'bates';
            workspace.syncBatesQueueWithSources();
          }
        },
        'Batch Bates (ZIP)'
      )
    );

    if (isBates) {
      const validQueue = n.batesQueue.filter((id) => workspace.sourceFiles.get(id)?.type === 'pdf');
      const firstEntry = validQueue.length > 0 ? workspace.sourceFiles.get(validQueue[0]) : null;
      const previewEl = el('code', {
        className: 'text-[13px] font-semibold text-[#1d1d1f] break-all'
      });

      const updateLivePreview = () => {
        const sampleFile = firstEntry ? firstEntry.name.replace(/\.pdf$/i, '') : 'Exhibit_A';
        const sampleTotal = firstEntry?.pageCount || 12;
        const sample = formatBatesLabel(n.batesTemplate, {
          prefix: n.batesPrefix,
          suffix: n.batesSuffix,
          counter: n.batesStart,
          padding: n.batesPadding,
          filename: sampleFile,
          n: 1,
          total: sampleTotal
        });
        const sampleNext = formatBatesLabel(n.batesTemplate, {
          prefix: n.batesPrefix,
          suffix: n.batesSuffix,
          counter: (Number(n.batesStart) || 1) + 1,
          padding: n.batesPadding,
          filename: sampleFile,
          n: 2,
          total: sampleTotal
        });
        previewEl.textContent = `${sample}  →  ${sampleNext}`;
      };
      updateLivePreview();

      const prefixInput = /** @type {HTMLInputElement} */ (
        el('input', {
          id: 'bates-prefix',
          type: 'text',
          value: n.batesPrefix,
          className: 'input-clay !h-9 mt-1',
          onInput: (e) => {
            n.batesPrefix = /** @type {HTMLInputElement} */ (e.target).value;
            updateLivePreview();
          }
        })
      );
      prefixInput.value = n.batesPrefix;

      const suffixInput = /** @type {HTMLInputElement} */ (
        el('input', {
          id: 'bates-suffix',
          type: 'text',
          value: n.batesSuffix,
          className: 'input-clay !h-9 mt-1',
          onInput: (e) => {
            n.batesSuffix = /** @type {HTMLInputElement} */ (e.target).value;
            updateLivePreview();
          }
        })
      );
      suffixInput.value = n.batesSuffix;

      const batesTmplInput = /** @type {HTMLInputElement} */ (
        el('input', {
          id: 'bates-template',
          type: 'text',
          value: n.batesTemplate,
          className: 'input-clay !h-9 mt-1',
          onInput: (e) => {
            n.batesTemplate = /** @type {HTMLInputElement} */ (e.target).value;
            updateLivePreview();
          }
        })
      );
      batesTmplInput.value = n.batesTemplate;

      const queueContainer = el('div', { className: 'space-y-1.5 max-h-44 overflow-y-auto pr-0.5' });
      if (validQueue.length === 0) {
        queueContainer.appendChild(
          el(
            'div',
            { className: 'p-3 rounded-[10px] border border-dashed border-[#d4d0c5] text-[12px] text-[#6e6e73]' },
            'No PDFs in the Batch Bates queue. Upload PDFs or click Sync Loaded PDFs.'
          )
        );
      } else {
        let runningCounter = Number(n.batesStart) || 1;
        validQueue.forEach((id, idx) => {
          const src = workspace.sourceFiles.get(id);
          if (!src) return;
          const pagesInFile = src.pageCount || 1;
          const startLabel = formatBatesLabel(n.batesTemplate, {
            prefix: n.batesPrefix,
            suffix: n.batesSuffix,
            counter: runningCounter,
            padding: n.batesPadding,
            filename: src.name.replace(/\.pdf$/i, ''),
            n: 1,
            total: pagesInFile
          });
          runningCounter += pagesInFile;

          queueContainer.appendChild(
            el(
              'div',
              {
                className:
                  'flex items-center justify-between gap-2 px-2.5 py-2 rounded-[10px] bg-white border border-[#e5e5ea]'
              },
              el(
                'div',
                { className: 'min-w-0 flex-1' },
                el('p', { className: 'text-[12px] font-medium text-[#1d1d1f] truncate' }, `${idx + 1}. ${src.name}`),
                el('p', { className: 'text-[11px] text-[#6e6e73] truncate' }, `${pagesInFile}p • starts at ${startLabel}`)
              ),
              el(
                'div',
                { className: 'flex items-center gap-1 shrink-0' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'w-6 h-6 rounded border border-[#e5e5ea] text-[11px] hover:bg-[#f2f2f7] disabled:opacity-40',
                    disabled: idx === 0,
                    title: 'Move up',
                    onClick: () => workspace.moveBatesQueueItem(idx, idx - 1)
                  },
                  '↑'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'w-6 h-6 rounded border border-[#e5e5ea] text-[11px] hover:bg-[#f2f2f7] disabled:opacity-40',
                    disabled: idx === validQueue.length - 1,
                    title: 'Move down',
                    onClick: () => workspace.moveBatesQueueItem(idx, idx + 1)
                  },
                  '↓'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'w-6 h-6 rounded border border-[#e5e5ea] text-[11px] text-[#ff3b30] hover:bg-red-50',
                    title: 'Remove from queue',
                    onClick: () => workspace.removeBatesQueueItem(id)
                  },
                  '×'
                )
              )
            )
          );
        });
      }

      return el(
        'div',
        { className: 'space-y-3' },
        modeTabs,
        el(
          'div',
          { className: 'space-y-1.5' },
          el(
            'div',
            { className: 'flex items-center justify-between gap-2' },
            el('span', { className: 'text-[12px] font-medium text-[#1d1d1f]' }, `PDF Queue (${validQueue.length})`),
            el(
              'div',
              { className: 'flex items-center gap-1.5' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn-secondary !h-7 !px-2 !text-[11px]',
                  onClick: () => workspace.syncBatesQueueWithSources()
                },
                '+ Sync PDFs'
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'btn-secondary !h-7 !px-2 !text-[11px]',
                  onClick: () => {
                    /** @type {HTMLInputElement|null} */ (
                      document.querySelector('#global-file-input, input[type="file"][accept*="pdf"]')
                    )?.click();
                  }
                },
                '+ Upload'
              )
            )
          ),
          queueContainer
        ),
        el(
          'div',
          { className: 'p-2.5 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-1' },
          el('p', { className: 'text-[11px] font-medium text-[#6e6e73]' }, 'Live Formatted Preview'),
          previewEl
        ),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          labeledField('Prefix', prefixInput),
          labeledField('Suffix', suffixInput)
        ),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          labeledField(
            'Start Counter',
            el('input', {
              type: 'number',
              min: '0',
              value: String(n.batesStart),
              className: 'input-clay !h-9 mt-1',
              onInput: (e) => {
                n.batesStart = Math.max(0, Number(/** @type {HTMLInputElement} */ (e.target).value) || 0);
                updateLivePreview();
              }
            })
          ),
          labeledField(
            'Zero-Pad Digits',
            el('input', {
              type: 'number',
              min: '1',
              max: '12',
              value: String(n.batesPadding),
              className: 'input-clay !h-9 mt-1',
              onInput: (e) => {
                n.batesPadding = Math.max(1, Math.min(12, Number(/** @type {HTMLInputElement} */ (e.target).value) || 5));
                updateLivePreview();
              }
            })
          )
        ),
        el(
          'div',
          { className: 'space-y-1' },
          labeledField('Template ({prefix}, {counter:pad}, {suffix}, {filename}, {n}, {total}, {date})', batesTmplInput)
        ),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          labeledField(
            'Placement',
            selectControl(
              'bates-placement',
              'input-clay !h-9 mt-1',
              n.batesPlacement,
              [
                ['bottom', 'Footer (Bottom)'],
                ['top', 'Header (Top)']
              ],
              (val) => {
                n.batesPlacement = val;
              }
            )
          ),
          labeledField(
            'Alignment',
            selectControl(
              'bates-align',
              'input-clay !h-9 mt-1',
              n.batesAlignment,
              [
                ['left', 'Left'],
                ['center', 'Center'],
                ['right', 'Right']
              ],
              (val) => {
                n.batesAlignment = val;
              }
            )
          )
        ),
        el(
          'label',
          { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: n.batesIncludeCsv,
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              n.batesIncludeCsv = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          }),
          'Include CSV Manifest (bates_manifest.csv)'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn-primary w-full',
            disabled: validQueue.length === 0,
            onClick: runBatchBatesJob
          },
          'Stamp Bates & Export ZIP'
        )
      );
    }

    const tmplInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'num-template',
        type: 'text',
        value: n.template,
        className: 'input-clay',
        onInput: (e) => {
          n.template = /** @type {HTMLInputElement} */ (e.target).value;
        }
      })
    );
    tmplInput.value = n.template;

    return el(
      'div',
      { className: 'space-y-3.5' },
      modeTabs,
      el(
        'label',
        {
          className:
            'flex items-center justify-between gap-3 p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] cursor-pointer'
        },
        el('span', { className: 'text-[14px] font-medium text-[#1d1d1f]' }, 'Include Page Numbers on Export'),
        el('input', {
          type: 'checkbox',
          checked: n.enabled,
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            n.enabled = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        })
      ),
      el(
        'div',
        { className: 'space-y-1' },
        el('label', { for: 'num-template', className: 'text-[13px] font-medium' }, 'Template ({n}, {total})'),
        tmplInput
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Start Number',
          el('input', {
            type: 'number',
            min: '0',
            value: String(n.startNumber),
            className: 'input-clay !h-10 mt-1',
            onInput: (e) => {
              n.startNumber = Number(/** @type {HTMLInputElement} */ (e.target).value) || 1;
            }
          })
        ),
        labeledField(
          'Font Size (pt)',
          el('input', {
            type: 'number',
            min: '6',
            max: '48',
            value: String(n.fontSize),
            className: 'input-clay !h-10 mt-1',
            onInput: (e) => {
              n.fontSize = Number(/** @type {HTMLInputElement} */ (e.target).value) || 11;
            }
          })
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Placement',
          selectControl(
            'num-placement',
            'input-clay !h-10 mt-1',
            n.placement,
            [
              ['bottom', 'Footer (Bottom)'],
              ['top', 'Header (Top)']
            ],
            (val) => {
              n.placement = val;
            }
          )
        ),
        labeledField(
          'Alignment',
          selectControl(
            'num-align',
            'input-clay !h-10 mt-1',
            n.alignment,
            [
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right']
            ],
            (val) => {
              n.alignment = val;
            }
          )
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-3 gap-2' },
        labeledField(
          'X Margin',
          el('input', {
            type: 'number',
            min: '8',
            max: '200',
            value: String(n.marginX),
            className: 'input-clay !h-9 mt-1',
            onInput: (e) => {
              n.marginX = Number(/** @type {HTMLInputElement} */ (e.target).value) || 36;
            }
          })
        ),
        labeledField(
          'Y Margin',
          el('input', {
            type: 'number',
            min: '8',
            max: '200',
            value: String(n.marginY),
            className: 'input-clay !h-9 mt-1',
            onInput: (e) => {
              n.marginY = Number(/** @type {HTMLInputElement} */ (e.target).value) || 24;
            }
          })
        ),
        labeledField(
          'Color',
          el('input', {
            type: 'color',
            value: n.color,
            className: 'input-clay !h-9 !p-1 mt-1 cursor-pointer',
            onInput: (e) => {
              n.color = /** @type {HTMLInputElement} */ (e.target).value;
            }
          })
        )
      ),
      el(
        'label',
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: n.skipCover,
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            n.skipCover = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        }),
        'Skip cover page (start numbering on page 2)'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: () => {
            n.enabled = true;
            exportWorkspacePdf();
          }
        },
        'Export Numbered PDF'
      )
    );
  }

  if (tabId === 'convert') {
    const c = t.convert;
    const imageCount = [...workspace.sourceFiles.values()].filter((s) => s.type === 'image').length;
    return el(
      'div',
      { className: 'space-y-4' },
      el(
        'div',
        { className: 'space-y-2.5' },
        el('p', { className: 'text-[13px] font-semibold text-[#1d1d1f]' }, 'PDF → Images (OffscreenCanvas)'),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          labeledField(
            'Format',
            selectControl(
              'conv-format',
              'input-clay !h-10 mt-1',
              c.exportFormat,
              [
                ['png', 'PNG (Lossless)'],
                ['jpg', 'JPEG'],
                ['webp', 'WebP']
              ],
              (val) => {
                c.exportFormat = val;
                workspace.emit('tool');
              }
            )
          ),
          labeledField(
            'Render Scale',
            selectControl(
              'conv-scale',
              'input-clay !h-10 mt-1',
              c.exportScale,
              [
                ['1', '1× (72 DPI)'],
                ['2', '2× (144 DPI)'],
                ['3', '3× (216 DPI)']
              ],
              (val) => {
                c.exportScale = Number(val) || 2;
              }
            )
          )
        ),
        el(
          'label',
          { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: c.selectedOnly,
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              c.selectedOnly = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          }),
          `Export selected pages only (${selectedCount} selected)`
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn-primary w-full',
            onClick: runPdfToImagesJob
          },
          `Export Pages as ${c.exportFormat.toUpperCase()}`
        )
      ),
      el('hr', { className: 'border-[#e5e5ea]' }),
      el(
        'div',
        { className: 'space-y-2.5' },
        el(
          'p',
          { className: 'text-[13px] font-semibold text-[#1d1d1f]' },
          `Images → PDF (${imageCount} image file${imageCount === 1 ? '' : 's'} loaded)`
        ),
        labeledField(
          'Page Sizing',
          selectControl(
            'conv-page-fit',
            'input-clay !h-10 mt-1',
            c.pageFit,
            [
              ['a4', 'Fit to A4'],
              ['letter', 'Fit to US Letter'],
              ['original', 'Original Image Dimensions']
            ],
            (val) => {
              c.pageFit = val;
            }
          )
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn-secondary w-full',
            disabled: imageCount === 0,
            onClick: runImagesToPdfJob
          },
          'Convert Loaded Images to PDF'
        )
      )
    );
  }

  if (tabId === 'metadata') {
    const m = t.metadata;
    const selectedEntry = m.targetFileId ? workspace.sourceFiles.get(m.targetFileId) : null;
    const audit = m.audit || selectedEntry?.audit || null;

    const makeMetaInput = (label, key, heightClass = '!h-10') => {
      const inp = /** @type {HTMLInputElement} */ (
        el('input', {
          type: 'text',
          value: m[key] || '',
          className: `input-clay ${heightClass} mt-1`,
          onInput: (e) => {
            m[key] = /** @type {HTMLInputElement} */ (e.target).value;
          }
        })
      );
      inp.value = m[key] || '';
      return labeledField(label, inp);
    };

    const makeAuditRow = (label, valueText, flagged) =>
      el(
        'div',
        { className: 'flex items-center justify-between text-[12px]' },
        el('span', { className: 'text-[#6e6e73]' }, label),
        el(
          'span',
          {
            className: flagged
              ? 'font-semibold text-[#b91c1c]'
              : 'font-medium text-[#15803d]'
          },
          valueText
        )
      );

    const makeScrubToggle = (key, labelText) =>
      el(
        'label',
        { className: 'flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: Boolean(m.scrubOptions?.[key]),
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            if (!m.scrubOptions) {
              m.scrubOptions = {
                scrubInfo: true,
                purgeXmp: true,
                removeThumbnails: true,
                stripScriptsAndActions: true
              };
            }
            m.scrubOptions[key] = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        }),
        labelText
      );

    return el(
      'div',
      { className: 'space-y-3' },
      buildPdfSourceSelect('meta-target-select', m.targetFileId, (id) => {
        m.targetFileId = id;
        const entry = workspace.sourceFiles.get(id);
        if (entry) {
          workspace.hydrateMetadataFields(entry.metadata);
          m.audit = entry.audit || null;
          if (!entry.audit) {
            runPrivacyAuditForTarget();
          }
        }
        workspace.emit('tool');
      }),
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
        el(
          'div',
          { className: 'flex items-center justify-between gap-2' },
          el('span', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, 'Pre-Scrub Privacy Audit'),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-7 !px-2 !text-[11px]',
              disabled: !m.targetFileId || m.auditLoading,
              onClick: runPrivacyAuditForTarget
            },
            m.auditLoading ? 'Scanning...' : 'Re-scan Audit'
          )
        ),
        audit
          ? el(
              'div',
              { className: 'space-y-1 pt-0.5' },
              makeAuditRow('Info Fields', `${audit.infoFieldCount} populated`, audit.infoFieldCount > 0),
              makeAuditRow(
                'XMP Stream (/Metadata)',
                audit.xmpSizeBytes > 0 ? formatBytes(audit.xmpSizeBytes) : 'Clean (0 B)',
                audit.xmpSizeBytes > 0
              ),
              makeAuditRow(
                'Embedded Thumbs (/Thumb)',
                audit.thumbnailCount > 0 ? `${audit.thumbnailCount} found` : 'None',
                audit.thumbnailCount > 0
              ),
              makeAuditRow(
                'OpenAction',
                audit.openActionPresent ? 'Present' : 'None',
                audit.openActionPresent
              ),
              makeAuditRow(
                'Additional Actions (/AA)',
                audit.additionalActionsCount > 0 ? `${audit.additionalActionsCount} found` : 'None',
                audit.additionalActionsCount > 0
              ),
              makeAuditRow(
                'JavaScript (/Names)',
                audit.javascriptCount > 0 ? `${audit.javascriptCount} found` : 'None',
                audit.javascriptCount > 0
              )
            )
          : el(
              'p',
              { className: 'text-[11px] text-[#6e6e73]' },
              m.targetFileId
                ? m.auditLoading
                  ? 'Inspecting catalog metadata, XMP, thumbnails & scripts...'
                  : 'Click Re-scan Audit to inspect hidden privacy traces.'
                : 'Select or upload a PDF to run the privacy audit.'
            )
      ),
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-white border border-[#e5e5ea] space-y-2' },
        el('p', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, 'Granular Scrub Targets'),
        makeScrubToggle('scrubInfo', 'Strip Info Dictionary (Title, Author, Dates)'),
        makeScrubToggle('purgeXmp', 'Purge Catalog XMP XML Stream (/Metadata)'),
        makeScrubToggle('removeThumbnails', 'Remove Embedded Page Thumbnails (/Thumb)'),
        makeScrubToggle('stripScriptsAndActions', 'Delete /OpenAction, /AA & /JavaScript')
      ),
      el(
        'div',
        { className: 'space-y-2' },
        makeMetaInput('Title', 'title'),
        makeMetaInput('Author', 'author'),
        makeMetaInput('Subject', 'subject'),
        makeMetaInput('Keywords (comma-separated)', 'keywords'),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          makeMetaInput('Creator', 'creator', '!h-9'),
          makeMetaInput('Producer', 'producer', '!h-9')
        )
      ),
      el(
        'label',
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: m.applyOnExport,
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            m.applyOnExport = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        }),
        'Also apply these fields during Workspace Export'
      ),
      el(
        'div',
        { className: 'grid grid-cols-1 gap-2 pt-1' },
        el(
          'button',
          {
            type: 'button',
            className: 'btn-primary w-full',
            disabled: !m.targetFileId,
            onClick: () => runMetadataJob(false)
          },
          'Save Metadata to PDF'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn-secondary w-full',
            disabled: !m.targetFileId,
            onClick: () => runMetadataJob('scrub-selected')
          },
          'Run Selected Privacy Scrub'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn-secondary w-full !border-[#ff3b30] !text-[#ff3b30]',
            disabled: !m.targetFileId,
            onClick: () => runMetadataJob('scrub-all')
          },
          'Scrub All Traces (One-Click)'
        )
      )
    );
  }

  if (tabId === 'forms') {
    const f = t.forms;
    const fieldsList =
      f.fields.length > 0
        ? el(
            'div',
            { className: 'space-y-2.5 max-h-[280px] overflow-y-auto pr-1' },
            f.fields.map((field) => {
              const val = f.values[field.name];
              if (field.type === 'checkbox') {
                return el(
                  'label',
                  {
                    className:
                      'flex items-center justify-between gap-2 p-2.5 rounded-[10px] bg-[#f2f2f7] border border-[#e5e5ea] cursor-pointer'
                  },
                  el('span', { className: 'text-[13px] font-medium truncate' }, field.name),
                  el('input', {
                    type: 'checkbox',
                    checked: Boolean(val),
                    className: 'w-4 h-4 accent-[#1d1d1f]',
                    onChange: (e) => {
                      f.values[field.name] = /** @type {HTMLInputElement} */ (e.target).checked;
                    }
                  })
                );
              }
              if (field.type === 'dropdown' || field.type === 'radio') {
                const sel = selectControl(
                  '',
                  'input-clay !h-9 mt-1',
                  typeof val === 'string' ? val : '',
                  [['', '-- Select --'], ...field.options.map((opt) => [opt, opt])],
                  (nextVal) => {
                    f.values[field.name] = nextVal;
                  }
                );
                return labeledField(field.name, sel);
              }
              const inp = /** @type {HTMLInputElement} */ (
                el('input', {
                  type: 'text',
                  value: val == null ? '' : String(val),
                  className: 'input-clay !h-9 mt-1',
                  onInput: (e) => {
                    f.values[field.name] = /** @type {HTMLInputElement} */ (e.target).value;
                  }
                })
              );
              inp.value = val == null ? '' : String(val);
              return labeledField(field.name, inp);
            })
          )
        : el(
            'p',
            { className: 'type-caption text-[#6e6e73]' },
            'Click "Inspect AcroForm Fields" to list editable text inputs, checkboxes, dropdowns, and radio groups.'
          );

    return el(
      'div',
      { className: 'space-y-3.5' },
      buildPdfSourceSelect('forms-target-select', f.targetFileId, (id) => {
        f.targetFileId = id;
        f.fields = [];
        f.values = {};
        workspace.emit('tool');
      }),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-secondary w-full',
          disabled: !f.targetFileId || f.loading,
          onClick: inspectFormsForTarget
        },
        f.loading ? 'Scanning AcroForm...' : 'Inspect AcroForm Fields'
      ),
      fieldsList,
      el(
        'label',
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: f.flatten,
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            f.flatten = /** @type {HTMLInputElement} */ (e.target).checked;
            workspace.emit('tool');
          }
        }),
        'Flatten interactive form fields into static page content'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          disabled: !f.targetFileId,
          onClick: runFormsJob
        },
        f.flatten ? 'Fill & Flatten PDF' : 'Save Form Values'
      )
    );
  }

  if (tabId === 'resize') {
    const r = t.resize;
    const isCustom = r.preset === 'custom';
    const currentPreset = PAPER_PRESETS[r.preset] || PAPER_PRESETS.a4;
    const summaryW = isCustom ? toPoints(r.customWidth, r.customUnit) : currentPreset.width;
    const summaryH = isCustom ? toPoints(r.customHeight, r.customUnit) : currentPreset.height;

    const widthInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'resize-custom-w',
        type: 'number',
        step: '0.1',
        min: '1',
        value: String(r.customWidth),
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          r.customWidth = Number(/** @type {HTMLInputElement} */ (e.target).value) || 1;
        }
      })
    );
    widthInput.value = String(r.customWidth);

    const heightInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'resize-custom-h',
        type: 'number',
        step: '0.1',
        min: '1',
        value: String(r.customHeight),
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          r.customHeight = Number(/** @type {HTMLInputElement} */ (e.target).value) || 1;
        }
      })
    );
    heightInput.value = String(r.customHeight);

    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'p',
        { className: 'type-body-sm' },
        'Standardize mixed page sizes onto uniform dimensions using vector embedPage() without rasterizing text.'
      ),
      el(
        'div',
        { className: 'space-y-1.5' },
        el('label', { for: 'resize-preset', className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Target Paper Size'),
        selectControl(
          'resize-preset',
          'input-clay !h-10',
          r.preset,
          [
            ['a4', PAPER_PRESETS.a4.label],
            ['a3', PAPER_PRESETS.a3.label],
            ['a5', PAPER_PRESETS.a5.label],
            ['letter', PAPER_PRESETS.letter.label],
            ['legal', PAPER_PRESETS.legal.label],
            ['f4_id', PAPER_PRESETS.f4_id.label],
            ['f4_us', PAPER_PRESETS.f4_us.label],
            ['custom', 'Custom Dimensions...']
          ],
          (val) => {
            r.preset = val;
            workspace.emit('tool');
          }
        )
      ),
      isCustom
        ? el(
            'div',
            { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2.5' },
            el(
              'div',
              { className: 'grid grid-cols-3 gap-2' },
              labeledField('Width', widthInput),
              labeledField('Height', heightInput),
              labeledField(
                'Unit',
                selectControl(
                  'resize-unit',
                  'input-clay !h-9 mt-1',
                  r.customUnit,
                  [
                    ['mm', 'mm'],
                    ['cm', 'cm'],
                    ['in', 'in'],
                    ['pt', 'pt']
                  ],
                  (nextUnit) => {
                    const prevUnit = r.customUnit;
                    const wPt = toPoints(r.customWidth, prevUnit);
                    const hPt = toPoints(r.customHeight, prevUnit);
                    r.customUnit = /** @type {'pt'|'mm'|'cm'|'in'} */ (nextUnit);
                    r.customWidth = Math.round(fromPoints(wPt, r.customUnit) * 100) / 100;
                    r.customHeight = Math.round(fromPoints(hPt, r.customUnit) * 100) / 100;
                    workspace.emit('tool');
                  }
                )
              )
            ),
            el(
              'p',
              { className: 'text-[11px] text-[#6e6e73]' },
              `PDF Points: ${Math.round(summaryW * 10) / 10} × ${Math.round(summaryH * 10) / 10} pt`
            )
          )
        : null,
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Fit Mode',
          selectControl(
            'resize-fit-mode',
            'input-clay !h-10 mt-1',
            r.fitMode,
            [
              ['fit', 'Fit (Preserve Aspect)'],
              ['fill', 'Fill (Cover & Clip)'],
              ['original', 'Original Center']
            ],
            (val) => {
              r.fitMode = val;
              workspace.emit('tool');
            }
          )
        ),
        labeledField(
          'Orientation',
          selectControl(
            'resize-orientation',
            'input-clay !h-10 mt-1',
            r.orientation,
            [
              ['auto', 'Auto (Match Source)'],
              ['portrait', 'Force Portrait'],
              ['landscape', 'Force Landscape']
            ],
            (val) => {
              r.orientation = val;
            }
          )
        )
      ),
      r.fitMode === 'fit'
        ? labeledField(
            'Inner Padding Margin (pt)',
            el('input', {
              id: 'resize-margin',
              type: 'number',
              min: '0',
              max: '180',
              value: String(r.marginPt ?? 0),
              className: 'input-clay !h-9 mt-1',
              onInput: (e) => {
                r.marginPt = Math.max(0, Number(/** @type {HTMLInputElement} */ (e.target).value) || 0);
              }
            })
          )
        : null,
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: runResizePdfJob
        },
        'Resize & Download PDF'
      )
    );
  }

  if (tabId === 'nup') {
    const nup = t.nup;
    const isBooklet = nup.mode === 'booklet';
    const totalPages = workspace.pages.length;
    const plan = computeImpositionPlan(totalPages, nup);
    const previewSheets = plan.sheets.slice(0, 6);
    const blankPadCount = Math.max(0, plan.paddedPageCount - totalPages);

    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'div',
        { className: 'grid grid-cols-2 gap-1.5 p-1 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea]' },
        el(
          'button',
          {
            type: 'button',
            className: `h-8 rounded-[9px] text-[12px] font-medium transition-colors ${
              !isBooklet ? 'bg-[#1d1d1f] text-white' : 'text-[#555] hover:text-[#1d1d1f]'
            }`,
            onClick: () => {
              nup.mode = 'nup';
              workspace.emit('tool');
            }
          },
          'N-Up Grid'
        ),
        el(
          'button',
          {
            type: 'button',
            className: `h-8 rounded-[9px] text-[12px] font-medium transition-colors ${
              isBooklet ? 'bg-[#1d1d1f] text-white' : 'text-[#555] hover:text-[#1d1d1f]'
            }`,
            onClick: () => {
              nup.mode = 'booklet';
              nup.sheetOrientation = 'landscape';
              workspace.emit('tool');
            }
          },
          'Booklet Maker'
        )
      ),
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
        el(
          'div',
          { className: 'flex items-center justify-between gap-2' },
          el('span', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, 'Sheet Imposition Diagram'),
          el(
            'span',
            { className: 'text-[11px] text-[#6e6e73]' },
            isBooklet
              ? `${totalPages}p${blankPadCount > 0 ? ` (+${blankPadCount} blank)` : ''} → ${plan.sheets.length} sheets`
              : `${totalPages}p → ${plan.sheets.length} sheet${plan.sheets.length === 1 ? '' : 's'}`
          )
        ),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-0.5' },
          previewSheets.map((sheet) => {
            const cellGrid = el('div', {
              className: 'grid gap-1',
              style: {
                gridTemplateColumns: `repeat(${plan.cols}, minmax(0, 1fr))`
              }
            });
            const orderedSlots = [...sheet.slots].sort((a, b) =>
              a.row !== b.row ? a.row - b.row : a.col - b.col
            );
            for (const slot of orderedSlots) {
              cellGrid.appendChild(
                el(
                  'div',
                  {
                    className: `h-8 rounded-[6px] border text-[11px] font-medium flex items-center justify-center ${
                      slot.pageNumber === null
                        ? 'bg-[#f5f5f7] border-dashed border-[#d1d1d6] text-[#6e6e73]'
                        : 'bg-white border-[#1d1d1f]/20 text-[#1d1d1f]'
                    }`
                  },
                  slot.pageNumber === null
                    ? 'Blank'
                    : `${slot.pageNumber}${slot.extraRotation ? '↻' : ''}`
                )
              );
            }
            return el(
              'div',
              { className: 'p-2 rounded-[10px] bg-white/80 border border-[#e5e5ea] space-y-1' },
              el(
                'div',
                { className: 'flex items-center justify-between text-[10px] text-[#6e6e73]' },
                el(
                  'span',
                  {},
                  isBooklet
                    ? `S${Math.ceil(sheet.sheetIndex / 2)} ${sheet.side === 'front' ? 'Front' : 'Back'}`
                    : `Sheet ${sheet.sheetIndex}`
                ),
                sheet.flipped180 ? el('span', { className: 'font-semibold text-[#1d1d1f]' }, '180°') : null
              ),
              cellGrid
            );
          })
        ),
        plan.sheets.length > 6
          ? el(
              'p',
              { className: 'text-[11px] text-[#6e6e73]' },
              `Showing first 6 of ${plan.sheets.length} imposed sheets.`
            )
          : null
      ),
      !isBooklet
        ? el(
            'div',
            { className: 'grid grid-cols-2 gap-2' },
            labeledField(
              'Pages per Sheet',
              selectControl(
                'nup-count',
                'input-clay !h-9 mt-1',
                nup.nUp,
                [
                  [2, '2-Up'],
                  [4, '4-Up (2×2)'],
                  [6, '6-Up'],
                  [9, '9-Up (3×3)']
                ],
                (val) => {
                  nup.nUp = /** @type {2|4|6|9} */ (Number(val) || 2);
                  workspace.emit('tool');
                }
              )
            ),
            labeledField(
              'Reading Order',
              selectControl(
                'nup-order',
                'input-clay !h-9 mt-1',
                nup.nUpOrder,
                [
                  ['ltr', 'Left → Right'],
                  ['rtl', 'Right → Left'],
                  ['ttb', 'Top → Bottom']
                ],
                (val) => {
                  nup.nUpOrder = val;
                  workspace.emit('tool');
                }
              )
            )
          )
        : el(
            'div',
            { className: 'space-y-2' },
            labeledField(
              'Binding Edge/Direction',
              selectControl(
                'booklet-binding',
                'input-clay !h-9 mt-1',
                nup.bindingEdge,
                [
                  ['left', 'Left Binding (Standard LTR)'],
                  ['right', 'Right Binding (Manga/RTL)']
                ],
                (val) => {
                  nup.bindingEdge = val;
                  workspace.emit('tool');
                }
              )
            ),
            el(
              'label',
              { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(nup.flipBackSide),
                className: 'w-4 h-4 accent-[#1d1d1f]',
                onChange: (e) => {
                  nup.flipBackSide = /** @type {HTMLInputElement} */ (e.target).checked;
                  workspace.emit('tool');
                }
              }),
              'Flip back-side sheets 180° (Duplex flip)'
            )
          ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Target Sheet',
          selectControl(
            'nup-sheet-preset',
            'input-clay !h-9 mt-1',
            nup.sheetPreset,
            [
              ['a4', 'A4'],
              ['a3', 'A3'],
              ['a5', 'A5'],
              ['letter', 'US Letter'],
              ['legal', 'US Legal'],
              ['f4_id', 'F4 (210×330mm)']
            ],
            (val) => {
              nup.sheetPreset = val;
              workspace.emit('tool');
            }
          )
        ),
        !isBooklet
          ? labeledField(
              'Orientation',
              selectControl(
                'nup-orientation',
                'input-clay !h-9 mt-1',
                nup.sheetOrientation,
                [
                  ['landscape', 'Landscape'],
                  ['portrait', 'Portrait']
                ],
                (val) => {
                  nup.sheetOrientation = val;
                  workspace.emit('tool');
                }
              )
            )
          : labeledField(
              'Sheet Layout',
              el('input', {
                type: 'text',
                value: 'Landscape (Folded)',
                disabled: true,
                className: 'input-clay !h-9 mt-1 opacity-75'
              })
            )
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Outer Margin (pt)',
          el('input', {
            type: 'number',
            min: '0',
            max: '120',
            value: String(nup.outerMarginPt),
            className: 'input-clay !h-9 mt-1',
            onInput: (e) => {
              nup.outerMarginPt = Math.max(0, Number(/** @type {HTMLInputElement} */ (e.target).value) || 0);
            }
          })
        ),
        labeledField(
          isBooklet ? 'Spine Gutter (pt)' : 'Cell Gutter (pt)',
          el('input', {
            type: 'number',
            min: '0',
            max: '100',
            value: String(nup.gutterPt),
            className: 'input-clay !h-9 mt-1',
            onInput: (e) => {
              nup.gutterPt = Math.max(0, Number(/** @type {HTMLInputElement} */ (e.target).value) || 0);
            }
          })
        )
      ),
      el(
        'label',
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1d1d1f] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: Boolean(nup.drawBorders),
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            nup.drawBorders = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        }),
        'Draw subtle cut/cell border lines'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: runImpositionJob
        },
        isBooklet ? 'Impose Booklet PDF' : `Create ${nup.nUp}-Up PDF`
      )
    );
  }

  if (tabId === 'spreads') {
    const sp = t.spreads;
    const pages = workspace.pages;
    const safeIdx = Math.max(0, Math.min(Math.max(0, pages.length - 1), Number(sp.previewPageIndex) || 0));
    const currentPage = pages[safeIdx];
    const desiredKey = currentPage ? `${currentPage.id}:${currentPage.rotation}` : '';
    if (currentPage && sp.previewKey !== desiredKey && !sp.previewLoading) {
      queueMicrotask(() => {
        loadSpreadsPreview();
      });
    }

    const pct = Math.round((Number(sp.splitRatio) || 0.5) * 100);
    const ratioBadge = el('span', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, `${pct}% / ${100 - pct}%`);
    const rangeSlider = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'spread-ratio-slider',
        type: 'range',
        min: '15',
        max: '85',
        step: '1',
        value: String(pct),
        className: 'w-full accent-[#1d1d1f] cursor-pointer'
      })
    );
    rangeSlider.value = String(pct);

    const dividerLine = el(
      'div',
      {
        className:
          sp.axis === 'horizontal'
            ? 'absolute left-0 right-0 h-0.5 bg-[#0071e3] shadow-[0_0_0_2px_rgba(255,255,255,0.85)] cursor-ns-resize'
            : 'absolute top-0 bottom-0 w-0.5 bg-[#0071e3] shadow-[0_0_0_2px_rgba(255,255,255,0.85)] cursor-ew-resize',
        style:
          sp.axis === 'horizontal'
            ? { top: `${pct}%`, transform: 'translateY(-50%)' }
            : { left: `${pct}%`, transform: 'translateX(-50%)' }
      },
      el(
        'span',
        {
          className:
            'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-[#0071e3] text-white text-[10px] font-semibold whitespace-nowrap shadow'
        },
        `${pct}%`
      )
    );

    const applyRatioVisual = (nextRatio) => {
      const clamped = Math.max(0.15, Math.min(0.85, nextRatio));
      sp.splitRatio = Math.round(clamped * 1000) / 1000;
      const p = Math.round(sp.splitRatio * 100);
      ratioBadge.textContent = `${p}% / ${100 - p}%`;
      rangeSlider.value = String(p);
      const pill = dividerLine.querySelector('span');
      if (pill) pill.textContent = `${p}%`;
      if (sp.axis === 'horizontal') {
        dividerLine.style.top = `${p}%`;
      } else {
        dividerLine.style.left = `${p}%`;
      }
    };

    rangeSlider.addEventListener('input', () => {
      applyRatioVisual((Number(rangeSlider.value) || 50) / 100);
    });

    const previewFrame = el(
      'div',
      {
        className:
          'relative select-none touch-none rounded-[10px] border border-[#e5e5ea] bg-white overflow-hidden flex items-center justify-center min-h-[160px]',
        onPointerdown: (e) => {
          const boxEl = /** @type {HTMLElement} */ (e.currentTarget);
          boxEl.setPointerCapture?.(e.pointerId);
          const updateFromEvent = (ev) => {
            const rect = boxEl.getBoundingClientRect();
            const frac =
              sp.axis === 'horizontal'
                ? (ev.clientY - rect.top) / Math.max(1, rect.height)
                : (ev.clientX - rect.left) / Math.max(1, rect.width);
            applyRatioVisual(frac);
          };
          updateFromEvent(e);
          const onMove = (ev) => updateFromEvent(ev);
          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        }
      },
      sp.previewLoading
        ? el('p', { className: 'text-[12px] text-[#6e6e73] p-6' }, 'Rendering spread preview...')
        : sanitizeImageSrc(sp.previewUrl)
          ? el('img', {
              src: sanitizeImageSrc(sp.previewUrl),
              alt: 'Spread split divider preview',
              draggable: false,
              className: 'w-full h-auto max-h-56 object-contain pointer-events-none block'
            })
          : el('p', { className: 'text-[12px] text-[#6e6e73] p-6' }, 'Blank or pending page'),
      dividerLine
    );

    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
        el(
          'div',
          { className: 'flex items-center justify-between gap-2' },
          el('span', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, 'Drag Split Divider'),
          ratioBadge
        ),
        previewFrame,
        rangeSlider,
        pages.length > 1
          ? selectControl(
              'spread-preview-page',
              'input-clay !h-8 text-[12px]',
              safeIdx,
              pages.map((_, idx) => [idx, `Preview Page ${idx + 1} of ${pages.length}`]),
              (val) => {
                sp.previewPageIndex = Number(val) || 0;
                loadSpreadsPreview();
              }
            )
          : null
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Split Axis',
          selectControl(
            'spread-axis',
            'input-clay !h-9 mt-1',
            sp.axis,
            [
              ['vertical', 'Vertical (Left | Right)'],
              ['horizontal', 'Horizontal (Top/Bottom)']
            ],
            (val) => {
              sp.axis = val;
              workspace.emit('tool');
            }
          )
        ),
        labeledField(
          'Reading Order',
          selectControl(
            'spread-reading-order',
            'input-clay !h-9 mt-1',
            sp.readingOrder,
            [
              ['ltr', 'Left → Right (LTR)'],
              ['rtl', 'Right → Left (RTL)']
            ],
            (val) => {
              sp.readingOrder = val;
            }
          )
        )
      ),
      el(
        'div',
        { className: 'space-y-1.5' },
        el(
          'label',
          { className: 'flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: Boolean(sp.skipFirstPage),
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              sp.skipFirstPage = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          }),
          'Skip first page (keep front cover intact)'
        ),
        el(
          'label',
          { className: 'flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: Boolean(sp.skipLastPage),
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              sp.skipLastPage = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          }),
          'Skip last page (keep back cover intact)'
        ),
        el(
          'label',
          { className: 'flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: Boolean(sp.landscapeOnly),
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              sp.landscapeOnly = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          }),
          'Split landscape pages only'
        )
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: runSplitSpreadsJob
        },
        'Split Spreads & Download PDF'
      )
    );
  }

  if (tabId === 'filters') {
    const flt = t.filters;
    const pages = workspace.pages;
    const safeIdx = Math.max(0, Math.min(Math.max(0, pages.length - 1), Number(flt.previewPageIndex) || 0));
    flt.previewPageIndex = safeIdx;

    if (pages.length > 0 && !flt.previewFilteredUrl && !flt.previewLoading) {
      queueMicrotask(() => {
        requestColorFilterPreview();
      });
    }

    let debounceTimer = null;
    const schedulePreview = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        requestColorFilterPreview();
      }, 90);
    };

    const contrastLabel = el(
      'span',
      { className: 'text-[12px] font-medium text-[#1d1d1f]' },
      `${Number(flt.contrast ?? 1.2).toFixed(2)}×`
    );
    const thresholdLabel = el(
      'span',
      { className: 'text-[12px] font-medium text-[#1d1d1f]' },
      String(flt.threshold ?? 185)
    );

    const previewSlot = el('div', { id: 'filter-preview-slot' });
    mountFilterPreviewInto(previewSlot);

    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'div',
        { className: 'grid grid-cols-3 gap-1.5' },
        ...[
          ['grayscale', 'Grayscale'],
          ['invert', 'Dark Mode'],
          ['cleanup', 'Scan Clean']
        ].map(([id, label]) =>
          el(
            'button',
            {
              type: 'button',
              className: `h-9 rounded-[10px] text-[12px] font-medium border transition-colors ${
                flt.preset === id
                  ? 'bg-[#1d1d1f] text-white border-[#1d1d1f]'
                  : 'bg-white text-[#1d1d1f] border-[#e5e5ea] hover:border-[#1d1d1f]/40'
              }`,
              onClick: () => {
                flt.preset = /** @type {'grayscale'|'invert'|'cleanup'} */ (id);
                workspace.emit('tool');
                requestColorFilterPreview();
              }
            },
            label
          )
        )
      ),
      flt.preset === 'invert'
        ? labeledField(
            'Dark Mode Tone',
            selectControl(
              'filter-invert-variant',
              'input-clay !h-9 mt-1',
              flt.invertVariant,
              [
                ['slate', 'Soft Dark Slate (#161B22)'],
                ['sepia', 'Warm Dark Sepia'],
                ['pure', 'Pure RGB Invert (255 - C)']
              ],
              (val) => {
                flt.invertVariant = val;
                requestColorFilterPreview();
              }
            )
          )
        : null,
      flt.preset === 'cleanup'
        ? el(
            'div',
            { className: 'space-y-2' },
            el(
              'label',
              { className: 'flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(flt.binarize),
                className: 'w-4 h-4 accent-[#1d1d1f]',
                onChange: (e) => {
                  flt.binarize = /** @type {HTMLInputElement} */ (e.target).checked;
                  workspace.emit('tool');
                  requestColorFilterPreview();
                }
              }),
              'B&W Binarization (crisp 2-tone PNG output)'
            ),
            flt.binarize
              ? el(
                  'label',
                  { className: 'flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
                  el('input', {
                    type: 'checkbox',
                    checked: flt.autoOtsu !== false,
                    className: 'w-4 h-4 accent-[#1d1d1f]',
                    onChange: (e) => {
                      flt.autoOtsu = /** @type {HTMLInputElement} */ (e.target).checked;
                      workspace.emit('tool');
                      requestColorFilterPreview();
                    }
                  }),
                  'Use Automatic Otsu Threshold'
                )
              : null
          )
        : null,
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2.5' },
        el(
          'div',
          { className: 'space-y-1' },
          el(
            'div',
            { className: 'flex items-center justify-between' },
            el('label', { for: 'filter-contrast', className: 'text-[12px] font-medium text-[#1d1d1f]' }, 'Contrast Boost'),
            contrastLabel
          ),
          el('input', {
            id: 'filter-contrast',
            type: 'range',
            min: '0.5',
            max: '2.5',
            step: '0.05',
            value: String(flt.contrast ?? 1.2),
            className: 'w-full accent-[#1d1d1f] cursor-pointer',
            onInput: (e) => {
              const val = Number(/** @type {HTMLInputElement} */ (e.target).value) || 1.2;
              flt.contrast = val;
              contrastLabel.textContent = `${val.toFixed(2)}×`;
              schedulePreview();
            }
          })
        ),
        flt.preset === 'cleanup' && !(flt.binarize && flt.autoOtsu !== false)
          ? el(
              'div',
              { className: 'space-y-1' },
              el(
                'div',
                { className: 'flex items-center justify-between' },
                el(
                  'label',
                  { for: 'filter-threshold', className: 'text-[12px] font-medium text-[#1d1d1f]' },
                  flt.binarize ? 'B&W Threshold' : 'Background Whiten Cutoff'
                ),
                thresholdLabel
              ),
              el('input', {
                id: 'filter-threshold',
                type: 'range',
                min: '80',
                max: '248',
                step: '2',
                value: String(flt.threshold ?? 185),
                className: 'w-full accent-[#1d1d1f] cursor-pointer',
                onInput: (e) => {
                  const val = Number(/** @type {HTMLInputElement} */ (e.target).value) || 185;
                  flt.threshold = val;
                  thresholdLabel.textContent = String(val);
                  schedulePreview();
                }
              })
            )
          : null
      ),
      el(
        'div',
        { className: 'space-y-1.5' },
        el('span', { className: 'text-[12px] font-medium text-[#1d1d1f] block' }, 'Export Resolution (DPI)'),
        el(
          'div',
          { className: 'grid grid-cols-3 gap-1.5' },
          ...[150, 200, 300].map((dpi) =>
            el(
              'button',
              {
                type: 'button',
                className: `h-8 rounded-[9px] text-[12px] font-medium border transition-colors ${
                  Number(flt.dpi) === dpi
                    ? 'bg-[#1d1d1f] text-white border-[#1d1d1f]'
                    : 'bg-white text-[#1d1d1f] border-[#e5e5ea] hover:border-[#1d1d1f]/40'
                }`,
                onClick: () => {
                  flt.dpi = dpi;
                  workspace.emit('tool');
                }
              },
              `${dpi} DPI`
            )
          )
        )
      ),
      pages.length > 1
        ? selectControl(
            'filter-preview-page',
            'input-clay !h-8 text-[12px]',
            safeIdx,
            pages.map((_, idx) => [idx, `Preview Page ${idx + 1} of ${pages.length}`]),
            (val) => {
              flt.previewPageIndex = Number(val) || 0;
              requestColorFilterPreview();
            }
          )
        : null,
      previewSlot,
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          onClick: runColorFiltersJob
        },
        `Apply ${flt.preset === 'invert' ? 'Dark Mode' : flt.preset === 'cleanup' ? 'Scan Cleanup' : 'Grayscale'} & Download`
      )
    );
  }

  if (tabId === 'redact') {
    const r = t.redact;
    const queryInput = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'redact-query-input',
        type: 'text',
        placeholder: r.searchMode === 'regex' ? 'Regex e.g. \\b\\d{4}\\b' : 'Keyword to redact...',
        value: r.searchQuery,
        className: 'input-clay !h-9',
        onInput: (e) => {
          r.searchQuery = /** @type {HTMLInputElement} */ (e.target).value;
        }
      })
    );
    queryInput.value = r.searchQuery;

    return el(
      'div',
      { className: 'space-y-3.5' },
      buildPdfSourceSelect('redact-target-select', r.targetFileId, (id) => {
        r.targetFileId = id;
        r.activePageIndex = 0;
        r.previewPageIndex = -1;
        r.marks = [];
        workspace.emit('tool');
      }),
      el(
        'button',
        {
          type: 'button',
          id: 'open-redact-studio-btn',
          className: 'btn-secondary w-full !border-[#0071e3] !text-[#0071e3]',
          disabled: !r.targetFileId,
          onClick: () => {
            r.modalOpen = true;
            workspace.emit('tool');
          }
        },
        `Open Interactive Redaction Studio (${r.marks.length} marks)`
      ),
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
        el('p', { className: 'text-[12px] font-semibold text-[#1d1d1f]' }, 'Search & Auto-Mark Text'),
        selectControl(
          'redact-search-mode',
          'input-clay !h-9',
          r.searchMode,
          [
            ['keyword', 'Keyword Match'],
            ['regex', 'Regular Expression'],
            ['email', 'Emails Preset'],
            ['phone', 'Phone Numbers Preset'],
            ['ssn', 'SSN/ID Preset']
          ],
          (val) => {
            r.searchMode = val;
            workspace.emit('tool');
          }
        ),
        r.searchMode === 'keyword' || r.searchMode === 'regex' ? queryInput : null,
        el(
          'button',
          {
            type: 'button',
            className: 'btn-secondary w-full !h-9 !text-[12px]',
            disabled: !r.targetFileId,
            onClick: runFindRedactionMatchesJob
          },
          'Find & Mark Matches Across PDF'
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Burn DPI',
          selectControl(
            'redact-dpi',
            'input-clay !h-9 mt-1',
            r.dpi,
            [
              [200, '200 DPI'],
              [250, '250 DPI'],
              [300, '300 DPI']
            ],
            (val) => {
              r.dpi = Number(val) || 220;
            }
          )
        ),
        labeledField(
          'Mask Color',
          el('input', {
            type: 'color',
            value: r.fillColor,
            className: 'input-clay !h-9 !p-1 mt-1 cursor-pointer',
            onInput: (e) => {
              r.fillColor = /** @type {HTMLInputElement} */ (e.target).value;
            }
          })
        )
      ),
      el(
        'label',
        { className: 'flex items-start gap-2 p-2.5 rounded-[12px] bg-[#fef2f2] border border-[#ff3b30]/30 cursor-pointer text-[12px]' },
        el('input', {
          type: 'checkbox',
          checked: Boolean(r.paranoidMode),
          className: 'w-4 h-4 accent-[#ff3b30] mt-0.5',
          onChange: (e) => {
            r.paranoidMode = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        }),
        el(
          'span',
          {},
          el('strong', { className: 'block text-[#991b1b]' }, 'Paranoid Mode'),
          el('span', { className: 'text-[#7f1d1d]' }, 'Raster-burn every page & strip XMP/Info/scripts.')
        )
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          disabled: !r.targetFileId,
          onClick: runRedactPdfJob
        },
        'Burn Redactions & Download PDF'
      )
    );
  }

  if (tabId === 'sign') {
    const s = t.sign;
    return el(
      'div',
      { className: 'space-y-3.5' },
      buildPdfSourceSelect('sign-target-select', s.targetFileId, (id) => {
        s.targetFileId = id;
        s.activePageIndex = 0;
        s.previewPageIndex = -1;
        s.overlays = [];
        s.selectedOverlayId = null;
        workspace.emit('tool');
      }),
      el(
        'p',
        { className: 'type-body-sm' },
        'Draw, type, or upload transparent signatures and place native pdf-lib highlights, shapes, arrows, and callouts.'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'open-sign-studio-btn',
          className: 'btn-secondary w-full !border-[#0071e3] !text-[#1d1d1f]',
          disabled: !s.targetFileId,
          onClick: () => {
            s.modalOpen = true;
            workspace.emit('tool');
          }
        },
        `Open Signature & Annotator Studio (${s.overlays.length} placed)`
      ),
      s.overlays.length > 0
        ? el(
            'div',
            { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-1.5 max-h-40 overflow-y-auto' },
            s.overlays.map((ov, idx) =>
              el(
                'div',
                { className: 'flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-[#e5e5ea] text-[12px]' },
                el('span', { className: 'truncate' }, `${idx + 1}. P${ov.pageIndex + 1} • ${ov.kind}`),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'text-[#ff3b30] font-bold',
                    onClick: () => {
                      s.overlays = s.overlays.filter((item) => item.id !== ov.id);
                      workspace.emit('tool');
                    }
                  },
                  '×'
                )
              )
            )
          )
        : null,
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          disabled: !s.targetFileId || s.overlays.length === 0,
          onClick: runSignAnnotateJob
        },
        'Apply Overlays & Download PDF'
      )
    );
  }

  if (tabId === 'compare') {
    const cmp = t.compare;
    const pdfSources = [...workspace.sourceFiles.values()].filter((s) => s.type === 'pdf');
    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'p',
        { className: 'type-body-sm' },
        'Compare two PDF revisions side by side with OffscreenCanvas pixel diffing and Myers word/line diff.'
      ),
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
        el('p', { className: 'text-[12px] font-semibold' }, `v1: ${cmp.fileA ? cmp.fileA.name : 'Not selected'}`),
        el(
          'div',
          { className: 'flex flex-wrap gap-1.5' },
          el(
            'label',
            { className: 'btn-secondary !h-8 !px-2.5 !text-[11px] cursor-pointer inline-flex items-center' },
            'Upload v1',
            el('input', {
              type: 'file',
              accept: '.pdf,application/pdf',
              className: 'hidden',
              onChange: async (e) => {
                const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
                if (f) await setCompareFile('A', f);
              }
            })
          ),
          pdfSources[0]
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn-compact !h-8',
                  onClick: () => useWorkspacePdfForCompare('A', pdfSources[0].id)
                },
                `Use ${pdfSources[0].name.slice(0, 14)}`
              )
            : null
        )
      ),
      el(
        'div',
        { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-2' },
        el('p', { className: 'text-[12px] font-semibold' }, `v2: ${cmp.fileB ? cmp.fileB.name : 'Not selected'}`),
        el(
          'div',
          { className: 'flex flex-wrap gap-1.5' },
          el(
            'label',
            { className: 'btn-secondary !h-8 !px-2.5 !text-[11px] cursor-pointer inline-flex items-center' },
            'Upload v2',
            el('input', {
              type: 'file',
              accept: '.pdf,application/pdf',
              className: 'hidden',
              onChange: async (e) => {
                const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
                if (f) await setCompareFile('B', f);
              }
            })
          ),
          pdfSources.length > 1
            ? el(
                'button',
                {
                  type: 'button',
                  className: 'btn-compact !h-8',
                  onClick: () => useWorkspacePdfForCompare('B', pdfSources[1].id)
                },
                `Use ${pdfSources[1].name.slice(0, 14)}`
              )
            : null
        )
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'open-compare-studio-btn',
          className: 'btn-secondary w-full',
          onClick: () => {
            cmp.modalOpen = true;
            workspace.emit('tool');
          }
        },
        'Open Visual & Text Diff Studio'
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          disabled: !cmp.fileA || !cmp.fileB,
          onClick: async () => {
            cmp.modalOpen = true;
            await runComparePdfJob();
          }
        },
        'Compare PDFs Now'
      )
    );
  }

  if (tabId === 'extract-text') {
    const et = t.extractText;
    const pdfCount = [...workspace.sourceFiles.values()].filter((s) => s.type === 'pdf').length;
    const rangeInp = /** @type {HTMLInputElement} */ (
      el('input', {
        id: 'extract-text-range',
        type: 'text',
        value: et.rangeExpression,
        placeholder: 'all or e.g. 1-3, 5',
        className: 'input-clay !h-9 mt-1',
        onInput: (e) => {
          et.rangeExpression = /** @type {HTMLInputElement} */ (e.target).value;
        }
      })
    );
    rangeInp.value = et.rangeExpression;

    return el(
      'div',
      { className: 'space-y-3' },
      buildPdfSourceSelect('extract-text-target', et.targetFileId, (id) => {
        et.targetFileId = id;
        et.resultText = '';
        workspace.emit('tool');
      }),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        labeledField(
          'Output Format',
          selectControl(
            'extract-text-format',
            'input-clay !h-9 mt-1',
            et.format,
            [
              ['txt', 'Plain Text (.txt)'],
              ['md', 'Markdown (.md)'],
              ['json', 'Structured (.json)']
            ],
            (val) => {
              et.format = val;
            }
          )
        ),
        labeledField('Page Range', rangeInp)
      ),
      el(
        'label',
        { className: 'inline-flex items-center gap-2 text-[12px] text-[#1d1d1f] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: Boolean(et.includePageMarkers),
          className: 'w-4 h-4 accent-[#1d1d1f]',
          onChange: (e) => {
            et.includePageMarkers = /** @type {HTMLInputElement} */ (e.target).checked;
          }
        }),
        'Include page markers'
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        el(
          'button',
          {
            type: 'button',
            id: 'extract-text-run-btn',
            className: 'btn-primary !h-9 !text-[12px]',
            disabled: !et.targetFileId,
            onClick: runExtractTextJob
          },
          'Extract Text'
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'btn-secondary !h-9 !text-[12px]',
            disabled: pdfCount < 1,
            onClick: runBatchExtractTextZipJob
          },
          `Batch ZIP (${pdfCount})`
        )
      ),
      et.likelyScanned && et.resultText !== undefined
        ? el(
            'div',
            { className: 'p-2.5 rounded-[10px] bg-[#fffbeb] border border-[#ff9500]/40 text-[11px] text-[#92400e]' },
            'Warning: Scanned/image-only PDF detected: no embedded vector text layer found.'
          )
        : null,
      et.resultText
        ? el(
            'div',
            { className: 'space-y-2' },
            el(
              'div',
              { className: 'flex items-center justify-between gap-2' },
              el('span', { className: 'text-[11px] font-medium text-[#6e6e73]' }, `${et.totalChars} chars (${et.pagesExtracted}p)`),
              el(
                'div',
                { className: 'flex gap-1.5' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'btn-compact !h-7',
                    onClick: async () => {
                      await navigator.clipboard?.writeText(et.resultText);
                      workspace.showNotice('success', 'Copied', 'Extracted text copied to clipboard.');
                    }
                  },
                  'Copy'
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'btn-compact !h-7',
                    onClick: downloadExtractedTextFile
                  },
                  'Download'
                )
              )
            ),
            el(
              'pre',
              {
                className:
                  'p-2.5 rounded-[10px] bg-[#f2f2f7] border border-[#e5e5ea] max-h-48 overflow-auto text-[11px] font-mono whitespace-pre-wrap break-words'
              },
              et.resultText.slice(0, 6000)
            )
          )
        : null
    );
  }

  if (tabId === 'extract-images') {
    const ei = t.extractImages;
    return el(
      'div',
      { className: 'space-y-3' },
      buildPdfSourceSelect('extract-img-target', ei.targetFileId, (id) => {
        ei.targetFileId = id;
        ei.items = [];
        workspace.emit('tool');
      }),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2 items-end' },
        labeledField(
          'Min Dimension (px)',
          el('input', {
            id: 'extract-img-minsize',
            type: 'number',
            min: '1',
            max: '1024',
            value: String(ei.minSize || 32),
            className: 'input-clay !h-9 mt-1',
            onInput: (e) => {
              ei.minSize = Math.max(1, Number(/** @type {HTMLInputElement} */ (e.target).value) || 32);
            }
          })
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'extract-img-scan-btn',
            className: 'btn-primary !h-9 !text-[12px]',
            disabled: !ei.targetFileId,
            onClick: runExtractImagesJob
          },
          'Scan Images'
        )
      ),
      ei.items.length > 0
        ? el(
            'div',
            { className: 'space-y-2' },
            el(
              'div',
              { className: 'flex items-center justify-between text-[11px] text-[#6e6e73]' },
              el('span', {}, `${ei.items.length} asset(s) • skipped ${ei.skippedSmall} small`),
              el(
                'button',
                {
                  type: 'button',
                  id: 'extract-img-zip-btn',
                  className: 'btn-compact !h-7',
                  onClick: runDownloadAllExtractedImagesZipJob
                },
                'Download All ZIP'
              )
            ),
            el(
              'div',
              { className: 'grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-0.5' },
              ei.items.map((img) =>
                el(
                  'div',
                  { className: 'p-2 rounded-[10px] bg-white border border-[#e5e5ea] space-y-1.5' },
                  sanitizeImageSrc(img.previewUrl)
                    ? el('img', {
                        src: sanitizeImageSrc(img.previewUrl),
                        alt: img.fileName,
                        className: 'w-full h-20 object-contain rounded bg-[#f2f2f7]'
                      })
                    : el('div', { className: 'w-full h-20 flex items-center justify-center bg-[#f2f2f7] text-[10px]' }, img.format.toUpperCase()),
                  el(
                    'div',
                    { className: 'flex items-center justify-between gap-1 text-[10px]' },
                    el('span', { className: 'font-semibold uppercase' }, `${img.format}${img.hasAlpha ? ' α' : ''} • ${img.width}×${img.height}`),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'text-[#1d1d1f] underline font-medium',
                        onClick: () => downloadSingleExtractedImage(img)
                      },
                      'Save'
                    )
                  )
                )
              )
            )
          )
        : null
    );
  }

  if (tabId === 'attachments') {
    const att = t.attachments;
    const removeSet = new Set(att.pendingRemove);

    return el(
      'div',
      { className: 'space-y-3' },
      buildPdfSourceSelect('att-target-select', att.targetFileId, (id) => {
        att.targetFileId = id;
        att.items = [];
        att.pendingAdd = [];
        att.pendingRemove = [];
        att.loaded = false;
        workspace.emit('tool');
        runInspectAttachmentsJob();
      }),
      el(
        'div',
        { className: 'flex gap-2' },
        el(
          'button',
          {
            type: 'button',
            id: 'att-scan-btn',
            className: 'btn-secondary !h-9 flex-1 !text-[12px]',
            disabled: !att.targetFileId,
            onClick: runInspectAttachmentsJob
          },
          att.loaded ? `Refresh (${att.items.length})` : 'Scan Attachments'
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'att-zip-btn',
            className: 'btn-compact !h-9',
            disabled: att.items.length === 0,
            onClick: runPackageAttachmentsZipJob
          },
          'Extract ZIP'
        )
      ),
      el(
        'label',
        { className: 'block p-3 rounded-[12px] border border-dashed border-[#d1d1d6] bg-[#f2f2f7] text-center cursor-pointer text-[12px]' },
        '+ Attach Files (CSV, XML, ZIP, etc.)',
        el('input', {
          id: 'att-add-input',
          type: 'file',
          multiple: true,
          className: 'hidden',
          onChange: async (e) => {
            const files = /** @type {HTMLInputElement} */ (e.target).files;
            if (!files?.length) return;
            for (const f of files) {
              const buf = await readFileAsArrayBuffer(f);
              att.pendingAdd.push({
                name: f.name,
                bytes: new Uint8Array(buf),
                mimeType: f.type || 'application/octet-stream',
                description: ''
              });
            }
            workspace.emit('tool');
          }
        })
      ),
      att.pendingAdd.length > 0
        ? el(
            'div',
            { className: 'p-2 rounded-[10px] bg-[#f0fdf4] border border-[#34c759]/30 space-y-1 text-[11px]' },
            el('p', { className: 'font-semibold text-[#166534]' }, `Queued to Attach (${att.pendingAdd.length})`),
            att.pendingAdd.map((f, idx) =>
              el(
                'div',
                { className: 'flex items-center justify-between' },
                el('span', { className: 'truncate' }, `${f.name} (${formatBytes(f.bytes.byteLength)})`),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'text-[#ff3b30] font-bold',
                    onClick: () => {
                      att.pendingAdd.splice(idx, 1);
                      workspace.emit('tool');
                    }
                  },
                  '×'
                )
              )
            )
          )
        : null,
      att.items.length > 0
        ? el(
            'div',
            { className: 'space-y-1.5 max-h-44 overflow-y-auto' },
            att.items.map((item) => {
              const markedRemove = removeSet.has(item.name);
              return el(
                'div',
                {
                  className: `flex items-center justify-between gap-2 px-2.5 py-2 rounded-[10px] border text-[11px] ${
                    markedRemove ? 'bg-[#fef2f2] border-[#ff3b30]/40 line-through' : 'bg-white border-[#e5e5ea]'
                  }`
                },
                el(
                  'div',
                  { className: 'min-w-0 flex-1' },
                  el('p', { className: 'font-medium truncate' }, item.name),
                  el('p', { className: 'text-[#6e6e73] truncate' }, `${formatBytes(item.size)} • ${item.mimeType}`)
                ),
                el(
                  'div',
                  { className: 'flex items-center gap-1.5 shrink-0' },
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'underline font-medium',
                      onClick: () => downloadSingleAttachment(item)
                    },
                    'Save'
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'text-[#ff3b30] font-semibold',
                      onClick: () => {
                        if (markedRemove) {
                          att.pendingRemove = att.pendingRemove.filter((n) => n !== item.name);
                        } else {
                          att.pendingRemove.push(item.name);
                        }
                        workspace.emit('tool');
                      }
                    },
                    markedRemove ? 'Undo' : 'Remove'
                  )
                )
              );
            })
          )
        : el('p', { className: 'text-[11px] text-[#6e6e73]' }, att.loaded ? 'No embedded attachments found.' : 'Click Scan Attachments to list embedded files.'),
      el(
        'button',
        {
          type: 'button',
          id: 'att-save-pdf-btn',
          className: 'btn-primary w-full',
          disabled: !att.targetFileId || (att.pendingAdd.length === 0 && att.pendingRemove.length === 0),
          onClick: runUpdateAttachmentsJob
        },
        'Save Updated PDF'
      )
    );
  }

  if (tabId === 'bookmarks') {
    const bm = t.bookmarks;
    return el(
      'div',
      { className: 'space-y-3.5' },
      buildPdfSourceSelect('bm-target-select', bm.targetFileId, (id) => {
        bm.targetFileId = id;
        bm.tree = [];
        bm.selectedNodeId = null;
        bm.previewPageIndex = 0;
        bm.previewLoadedIdx = -1;
        workspace.emit('tool');
      }),
      el(
        'p',
        { className: 'type-body-sm' },
        'Inspect, nest, reorder, and serialize Unicode Table of Contents (/Outlines) trees with side-by-side page jumping.'
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-2' },
        el(
          'button',
          {
            type: 'button',
            className: 'btn-secondary !h-9 !text-[12px]',
            disabled: !bm.targetFileId,
            onClick: runReadOutlinesJob
          },
          'Load Outlines'
        ),
        el(
          'button',
          {
            type: 'button',
            id: 'open-bookmark-studio-btn',
            className: 'btn-secondary !h-9 !text-[12px]',
            disabled: !bm.targetFileId,
            onClick: () => {
              bm.modalOpen = true;
              workspace.emit('tool');
            }
          },
          `Tree Editor (${bm.tree.length})`
        )
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'btn-primary w-full',
          disabled: !bm.targetFileId,
          onClick: runWriteOutlinesJob
        },
        'Save Bookmarks to PDF'
      )
    );
  }

  if (tabId === 'cbz') {
    const cbz = t.cbz;
    const isCbzToPdf = cbz.mode !== 'pdf-to-cbz';
    return el(
      'div',
      { className: 'space-y-3.5' },
      el(
        'div',
        { className: 'grid grid-cols-2 gap-1.5 p-1 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea]' },
        el(
          'button',
          {
            type: 'button',
            className: `h-8 rounded-[9px] text-[12px] font-medium ${isCbzToPdf ? 'bg-[#1d1d1f] text-white' : 'text-[#555]'}`,
            onClick: () => {
              cbz.mode = 'cbz-to-pdf';
              workspace.emit('tool');
            }
          },
          'CBZ → PDF'
        ),
        el(
          'button',
          {
            type: 'button',
            className: `h-8 rounded-[9px] text-[12px] font-medium ${!isCbzToPdf ? 'bg-[#1d1d1f] text-white' : 'text-[#555]'}`,
            onClick: () => {
              cbz.mode = 'pdf-to-cbz';
              workspace.emit('tool');
            }
          },
          'PDF → CBZ'
        )
      ),
      isCbzToPdf
        ? el(
            'div',
            { className: 'space-y-3' },
            el(
              'label',
              { className: 'btn-secondary w-full cursor-pointer inline-flex items-center justify-center' },
              cbz.cbzFile ? `${cbz.cbzFile.name} (${formatBytes(cbz.cbzFile.byteSize)})` : 'Select .cbz Archive',
              el('input', {
                id: 'cbz-inspector-file-input',
                type: 'file',
                accept: '.cbz,application/vnd.comicbook+zip,application/zip',
                className: 'hidden',
                onChange: async (e) => {
                  const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
                  if (f) await loadCbzArchiveFile(f);
                }
              })
            ),
            cbz.cbzEntries.length > 0
              ? el(
                  'div',
                  { className: 'p-2.5 rounded-[10px] bg-[#f2f2f7] border border-[#e5e5ea] max-h-32 overflow-y-auto space-y-0.5 text-[11px] font-mono' },
                  cbz.cbzEntries.map((name, idx) => el('div', { className: 'truncate' }, `${idx + 1}. ${name}`))
                )
              : null,
            el(
              'label',
              { className: 'inline-flex items-center gap-2 text-[12px] cursor-pointer' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(cbz.uniformWidth),
                className: 'w-4 h-4 accent-[#1d1d1f]',
                onChange: (e) => {
                  cbz.uniformWidth = /** @type {HTMLInputElement} */ (e.target).checked;
                }
              }),
              'Uniform A4 page width normalization'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-primary w-full',
                disabled: !cbz.cbzFile,
                onClick: runCbzToPdfJob
              },
              'Convert CBZ to PDF'
            )
          )
        : el(
            'div',
            { className: 'space-y-3' },
            buildPdfSourceSelect('cbz-pdf-target', cbz.targetFileId, (id) => {
              cbz.targetFileId = id;
              workspace.emit('tool');
            }),
            el(
              'div',
              { className: 'grid grid-cols-2 gap-2' },
              labeledField(
                'Image Format',
                selectControl(
                  'cbz-img-fmt',
                  'input-clay !h-9 mt-1',
                  cbz.imageFormat,
                  [
                    ['webp', 'WebP (Compact)'],
                    ['jpeg', 'JPEG'],
                    ['png', 'PNG (Lossless)']
                  ],
                  (val) => {
                    cbz.imageFormat = val;
                  }
                )
              ),
              labeledField(
                'Scale',
                selectControl(
                  'cbz-scale',
                  'input-clay !h-9 mt-1',
                  cbz.pdfScale,
                  [
                    [1.5, '1.5× (Standard)'],
                    [2, '2.0× (Crisp)'],
                    [3, '3.0× (High-DPI)']
                  ],
                  (val) => {
                    cbz.pdfScale = Number(val) || 2.0;
                  }
                )
              )
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-primary w-full',
                disabled: !cbz.targetFileId,
                onClick: runPdfToCbzJob
              },
              'Export Store-Mode CBZ'
            )
          )
    );
  }

  // Optimize tab
  const opt = t.optimize;
  const preset = opt.preset || 'lossless';
  const qualityValueLabel = el(
    'span',
    { className: 'text-[12px] font-medium text-[#1d1d1f]' },
    `${Math.round((Number(opt.jpegQuality) || 0.75) * 100)}%`
  );

  return el(
    'div',
    { className: 'space-y-3.5' },
    el(
      'div',
      { className: 'space-y-1.5' },
      el('label', { for: 'opt-preset', className: 'text-[13px] font-medium text-[#1d1d1f]' }, 'Compression Preset'),
      selectControl(
        'opt-preset',
        'input-clay !h-10',
        preset,
        [
          ['lossless', 'Lossless (Object Streams & Pruning)'],
          ['balanced', 'Balanced (Smart XObject Recompression)'],
          ['maximum', 'Maximum (Raster Optimization)']
        ],
        (val) => {
          opt.preset = val;
          if (val === 'maximum' && ![72, 110, 150].includes(Number(opt.targetDpi))) {
            opt.targetDpi = 110;
          }
          workspace.emit('tool');
        }
      )
    ),
    preset === 'lossless'
      ? el(
          'p',
          { className: 'type-body-sm' },
          'Rebuilds the document in a Web Worker using compressed PDF object streams while keeping text, vectors, and images 100% lossless.'
        )
      : preset === 'balanced'
        ? el(
            'p',
            { className: 'type-body-sm' },
            'Keeps selectable text and vectors intact while safely downsampling and JPEG-recompressing compatible embedded images (skipping masked/CMYK/indexed streams).'
          )
        : el(
            'div',
            { className: 'p-3 rounded-[12px] bg-[#fffbeb] border border-[#ff9500]/40 space-y-1' },
            el('p', { className: 'text-[12px] font-semibold text-[#92400e]' }, 'Raster Mode Warning'),
            el(
              'p',
              { className: 'text-[12px] text-[#92400e]' },
              'Pages are rasterized to JPEG via pdfjs-dist. Selectable and searchable text will be removed in exchange for maximum size reduction.'
            )
          ),
    preset !== 'lossless'
      ? el(
          'div',
          { className: 'p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] space-y-3' },
          el(
            'div',
            { className: 'space-y-1.5' },
            el('span', { className: 'text-[12px] font-medium text-[#1d1d1f] block' }, 'Target DPI'),
            el(
              'div',
              { className: 'grid grid-cols-3 gap-1.5' },
              ...[72, 110, 150].map((dpi) =>
                el(
                  'button',
                  {
                    type: 'button',
                    className: `h-8 rounded-[9px] text-[12px] font-medium border transition-colors ${
                      Number(opt.targetDpi) === dpi
                        ? 'bg-[#1d1d1f] text-white border-[#1d1d1f]'
                        : 'bg-white text-[#1d1d1f] border-[#e5e5ea] hover:border-[#1d1d1f]/40'
                    }`,
                    onClick: () => {
                      opt.targetDpi = dpi;
                      workspace.emit('tool');
                    }
                  },
                  `${dpi} DPI`
                )
              )
            )
          ),
          el(
            'div',
            { className: 'space-y-1' },
            el(
              'div',
              { className: 'flex items-center justify-between' },
              el('label', { for: 'opt-jpeg-quality', className: 'text-[12px] font-medium text-[#1d1d1f]' }, 'JPEG Quality'),
              qualityValueLabel
            ),
            el('input', {
              id: 'opt-jpeg-quality',
              type: 'range',
              min: '0.4',
              max: '0.9',
              step: '0.05',
              value: String(opt.jpegQuality ?? 0.75),
              className: 'w-full accent-[#1d1d1f] cursor-pointer',
              onInput: (e) => {
                const val = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0.75;
                opt.jpegQuality = val;
                qualityValueLabel.textContent = `${Math.round(val * 100)}%`;
              }
            })
          )
        )
      : null,
    preset !== 'maximum'
      ? el(
          'label',
          {
            className:
              'flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] cursor-pointer'
          },
          el('span', { className: 'text-[13px] font-medium' }, 'Use PDF Object Streams'),
          el('input', {
            type: 'checkbox',
            checked: opt.useObjectStreams,
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              opt.useObjectStreams = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          })
        )
      : null,
    preset !== 'maximum'
      ? el(
          'label',
          {
            className:
              'flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] cursor-pointer'
          },
          el('span', { className: 'text-[13px] font-medium' }, 'Prune Orphan/Unused Objects'),
          el('input', {
            type: 'checkbox',
            checked: opt.rebuildCleanCopy,
            className: 'w-4 h-4 accent-[#1d1d1f]',
            onChange: (e) => {
              opt.rebuildCleanCopy = /** @type {HTMLInputElement} */ (e.target).checked;
            }
          })
        )
      : null,
    el(
      'label',
      {
        className:
          'flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[#f2f2f7] border border-[#e5e5ea] cursor-pointer'
      },
      el('span', { className: 'text-[13px] font-medium' }, 'Strip All Metadata'),
      el('input', {
        type: 'checkbox',
        checked: opt.stripMetadata,
        className: 'w-4 h-4 accent-[#1d1d1f]',
        onChange: (e) => {
          opt.stripMetadata = /** @type {HTMLInputElement} */ (e.target).checked;
        }
      })
    ),
    opt.lastStats
      ? el(
          'div',
          { className: 'p-3 rounded-[12px] bg-white border border-[#e5e5ea] space-y-1.5' },
          el(
            'div',
            { className: 'flex items-center justify-between gap-2' },
            el('span', { className: 'text-[12px] font-medium text-[#6e6e73]' }, 'Last Result'),
            el(
              'span',
              {
                className: `px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  opt.lastStats.pctSaved > 0
                    ? 'bg-[#dcfce7] text-[#166534]'
                    : 'bg-[#f3f4f6] text-[#374151]'
                }`
              },
              opt.lastStats.pctSaved > 0
                ? `${opt.lastStats.pctSaved}% smaller`
                : opt.lastStats.pctSaved === 0
                  ? '0% change'
                  : `+${Math.abs(opt.lastStats.pctSaved)}% larger`
            )
          ),
          el(
            'p',
            { className: 'text-[13px] font-semibold text-[#1d1d1f]' },
            `${formatBytes(opt.lastStats.originalSize)} → ${formatBytes(opt.lastStats.optimizedSize)}`
          ),
          opt.lastStats.preset === 'balanced'
            ? el(
                'p',
                { className: 'text-[11px] text-[#6e6e73]' },
                `Images recompressed: ${opt.lastStats.recompressedImages} • Skipped: ${opt.lastStats.skippedImages}`
              )
            : null
        )
      : null,
    el(
      'button',
      {
        type: 'button',
        className: 'btn-primary w-full',
        onClick: runOptimizeJob
      },
      'Optimize & Download PDF'
    )
  );
}
