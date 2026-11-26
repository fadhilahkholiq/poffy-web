import { readFileAsArrayBuffer } from '../../core/utils/file-io.js';
import { isWinAnsiCompatible } from '../../core/utils/winansi.js';
import { workspace } from '../../state/workspace.js';
import {
  exportWorkspacePdf,
  inspectFormsForTarget,
  runFormsJob,
  runImagesToPdfJob,
  runMetadataJob,
  runOptimizeJob,
  runPdfToImagesJob,
  runSplitJob
} from '../actions/export-runner.js';
import { el, mount } from '../utils/dom.js';

/**
 * Tool tab metadata matching DESIGN.md accent palette.
 * @type {{ id: import('../../state/workspace.js').ToolTabId, label: string, accent: string, accentText: string }[]}
 */
const TOOL_TABS = [
  { id: 'organize', label: 'Organize', accent: '#ff4d8b', accentText: '#ffffff' },
  { id: 'split', label: 'Split', accent: '#1a3a3a', accentText: '#ffffff' },
  { id: 'watermark', label: 'Watermark', accent: '#b8a4ed', accentText: '#0a0a0a' },
  { id: 'numbering', label: 'Numbers', accent: '#ffb084', accentText: '#0a0a0a' },
  { id: 'convert', label: 'Images ↔ PDF', accent: '#e8b94a', accentText: '#0a0a0a' },
  { id: 'metadata', label: 'Metadata', accent: '#a4d4c5', accentText: '#0a0a0a' },
  { id: 'forms', label: 'Forms', accent: '#ff6b5a', accentText: '#0a0a0a' },
  { id: 'optimize', label: 'Optimize', accent: '#f5f0e0', accentText: '#0a0a0a' }
];

/**
 * Helper to create a labeled input or select control safely.
 * @param {string} labelText
 * @param {HTMLElement} controlEl
 * @param {string} [labelClass='text-[12px] text-[#6a6a6a] block']
 * @returns {HTMLElement}
 */
function labeledField(labelText, controlEl, labelClass = 'text-[12px] text-[#6a6a6a] block') {
  return el('label', { className: labelClass }, labelText, controlEl);
}

/**
 * Helper to create a select dropdown safely from [value, label] pairs.
 * @param {string} id
 * @param {string} className
 * @param {string|number} currentValue
 * @param {[string|number, string][]} options
 * @param {(val: string) => void} onChange
 * @returns {HTMLSelectElement}
 */
function selectControl(id, className, currentValue, options, onChange) {
  const sel = /** @type {HTMLSelectElement} */ (
    el(
      'select',
      {
        id,
        className,
        onChange: (e) => onChange(/** @type {HTMLSelectElement} */ (e.target).value)
      },
      options.map(([val, label]) =>
        el('option', { value: String(val), selected: String(val) === String(currentValue) }, label)
      )
    )
  );
  sel.value = String(currentValue);
  return sel;
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
      { className: 'type-caption text-[#6a6a6a]' },
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
    el('label', { for: selectId, className: 'text-[13px] font-medium text-[#1a1a1a]' }, 'Target Source PDF'),
    sel
  );
}

/**
 * Renders the contextual Tool Inspector panel using safe DOM APIs only.
 * @param {HTMLElement} container
 */
export function renderToolInspector(container) {
  const activeTab = TOOL_TABS.find((t) => t.id === workspace.activeTool) || TOOL_TABS[0];

  const tabList = el(
    'div',
    { className: 'flex flex-wrap gap-1.5 pb-3 border-b border-[#e5e5e5]', role: 'tablist' },
    TOOL_TABS.map((tab) =>
      el(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': String(tab.id === activeTab.id),
          className: `category-tab ${tab.id === activeTab.id ? 'is-active' : ''}`,
          onClick: () =>
            workspace.setActiveTool(
              /** @type {import('../../state/workspace.js').ToolTabId} */ (tab.id)
            )
        },
        tab.label
      )
    )
  );

  const headerCard = el(
    'div',
    {
      className: 'rounded-[16px] px-4 py-3 flex items-center justify-between gap-2',
      style: { backgroundColor: activeTab.accent, color: activeTab.accentText }
    },
    el(
      'span',
      { className: 'type-title-sm', style: { color: activeTab.accentText } },
      `${activeTab.label} Studio`
    ),
    el('span', { className: 'text-[12px] font-medium opacity-85' }, 'Offline Worker')
  );

  const body = el('div', { id: 'tool-panel-body', className: 'space-y-4' }, buildToolBody(activeTab.id));

  const aside = el(
    'aside',
    { className: 'clay-card p-5 space-y-5 lg:sticky lg:top-[74px]' },
    tabList,
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
        el('p', { className: 'text-[13px] font-medium text-[#1a1a1a]' }, 'Multi-PDF Merge Order'),
        el(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-10 !px-3',
              disabled: workspace.sourceFiles.size < 2,
              onClick: () => workspace.interleaveAllSources()
            },
            'Interleave Pages'
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-primary !h-10 !px-3',
              onClick: exportWorkspacePdf
            },
            'Export Merged PDF'
          )
        ),
        el(
          'p',
          { className: 'type-caption text-[#6a6a6a]' },
          'Drag any page card in the grid to reorder, or interleave pages 1-by-1 across uploaded PDFs.'
        )
      ),
      el('hr', { className: 'border-[#e5e5e5]' }),
      el(
        'div',
        { className: 'space-y-2' },
        el('label', { for: 'org-blank-size', className: 'text-[13px] font-medium text-[#1a1a1a]' }, 'Insert Blank Page'),
        el(
          'div',
          { className: 'flex gap-2' },
          selectControl(
            'org-blank-size',
            'input-clay !h-10 flex-1',
            o.blankSize,
            [
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
              className: 'btn-secondary !h-10 !px-3.5 shrink-0',
              onClick: () => workspace.insertBlankPage(o.blankSize)
            },
            '+ Insert'
          )
        )
      ),
      el('hr', { className: 'border-[#e5e5e5]' }),
      el(
        'div',
        { className: 'space-y-2.5' },
        el(
          'p',
          { className: 'text-[13px] font-medium text-[#1a1a1a]' },
          `Crop Margins (pt) — ${selectedCount > 0 ? `${selectedCount} selected` : 'All pages'}`
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
        el('label', { for: 'split-mode', className: 'text-[13px] font-medium text-[#1a1a1a]' }, 'Split Strategy'),
        selectControl(
          'split-mode',
          'input-clay',
          s.mode,
          [
            ['ranges', 'Custom Page Ranges (ZIP)'],
            ['extract', 'Extract Selected / Range (Single PDF)'],
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
            el('label', { for: 'split-range', className: 'text-[13px] font-medium text-[#1a1a1a]' }, 'Page Range Expression'),
            rangeInput,
            el(
              'p',
              { className: 'type-caption text-[#6a6a6a]' },
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
            el('label', { for: 'split-every-n', className: 'text-[13px] font-medium text-[#1a1a1a]' }, 'Pages per chunk (N)'),
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
        className: 'w-4 h-4 accent-[#0a0a0a]',
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
          unicodeNeeded ? 'bg-[#b8a4ed] text-[#0a0a0a]' : 'bg-[#f5f0e0] text-[#6a6a6a]'
        }`
      },
      unicodeNeeded ? 'Unicode TTF Active' : 'WinAnsi / Standard'
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
          unicodeBadge.textContent = needsUni ? 'Unicode TTF Active' : 'WinAnsi / Standard';
          unicodeBadge.className = `text-[11px] font-medium px-2 py-0.5 rounded-full ${
            needsUni ? 'bg-[#b8a4ed] text-[#0a0a0a]' : 'bg-[#f5f0e0] text-[#6a6a6a]'
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
            'flex items-center justify-between gap-3 p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] cursor-pointer'
        },
        el('span', { className: 'text-[14px] font-medium text-[#0a0a0a]' }, 'Include Watermark on Export'),
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
              w.kind === 'text' ? '!bg-[#0a0a0a] !text-white !border-[#0a0a0a]' : ''
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
              w.kind === 'image' ? '!bg-[#0a0a0a] !text-white !border-[#0a0a0a]' : ''
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
              el('label', { className: 'text-[13px] font-medium block' }, 'Upload PNG / JPG Stamp'),
              el('input', {
                type: 'file',
                accept: 'image/png,image/jpeg',
                className:
                  'block w-full text-[13px] text-[#3a3a3a] file:mr-3 file:py-2 file:px-3 file:rounded-[8px] file:border file:border-[#e5e5e5] file:bg-[#faf5e8] file:text-[#0a0a0a] file:font-medium cursor-pointer',
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
                ? el('p', { className: 'type-caption text-[#1a3a3a]' }, `Loaded stamp: ${w.imageName}`)
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
                { className: 'text-[12px] text-[#6a6a6a]' },
                'Width Scale (',
                scaleLabel,
                ')',
                el('input', {
                  type: 'range',
                  min: '0.08',
                  max: '0.85',
                  step: '0.02',
                  value: String(w.scale),
                  className: 'w-full mt-2.5 accent-[#0a0a0a]',
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
        { className: 'block text-[12px] text-[#6a6a6a]' },
        'Opacity (',
        opacityLabel,
        ')',
        el('input', {
          type: 'range',
          min: '0.05',
          max: '1',
          step: '0.05',
          value: String(w.opacity),
          className: 'w-full mt-1.5 accent-[#0a0a0a]',
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
      el(
        'label',
        {
          className:
            'flex items-center justify-between gap-3 p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] cursor-pointer'
        },
        el('span', { className: 'text-[14px] font-medium text-[#0a0a0a]' }, 'Include Page Numbers on Export'),
        el('input', {
          type: 'checkbox',
          checked: n.enabled,
          className: 'w-4 h-4 accent-[#0a0a0a]',
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
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1a1a1a] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: n.skipCover,
          className: 'w-4 h-4 accent-[#0a0a0a]',
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
        el('p', { className: 'text-[13px] font-semibold text-[#0a0a0a]' }, 'PDF → Images (OffscreenCanvas)'),
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
          { className: 'inline-flex items-center gap-2 text-[13px] text-[#1a1a1a] cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: c.selectedOnly,
            className: 'w-4 h-4 accent-[#0a0a0a]',
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
      el('hr', { className: 'border-[#e5e5e5]' }),
      el(
        'div',
        { className: 'space-y-2.5' },
        el(
          'p',
          { className: 'text-[13px] font-semibold text-[#0a0a0a]' },
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

    return el(
      'div',
      { className: 'space-y-3' },
      buildPdfSourceSelect('meta-target-select', m.targetFileId, (id) => {
        m.targetFileId = id;
        const entry = workspace.sourceFiles.get(id);
        if (entry) workspace.hydrateMetadataFields(entry.metadata);
        workspace.emit('tool');
      }),
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
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1a1a1a] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: m.applyOnExport,
          className: 'w-4 h-4 accent-[#0a0a0a]',
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
            className: 'btn-secondary w-full !border-[#ef4444] !text-[#ef4444]',
            disabled: !m.targetFileId,
            onClick: () => runMetadataJob(true)
          },
          'Strip All Metadata (Privacy Scrub)'
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
                      'flex items-center justify-between gap-2 p-2.5 rounded-[10px] bg-[#faf5e8] border border-[#e5e5e5] cursor-pointer'
                  },
                  el('span', { className: 'text-[13px] font-medium truncate' }, field.name),
                  el('input', {
                    type: 'checkbox',
                    checked: Boolean(val),
                    className: 'w-4 h-4 accent-[#0a0a0a]',
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
            { className: 'type-caption text-[#6a6a6a]' },
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
        { className: 'inline-flex items-center gap-2 text-[13px] text-[#1a1a1a] cursor-pointer' },
        el('input', {
          type: 'checkbox',
          checked: f.flatten,
          className: 'w-4 h-4 accent-[#0a0a0a]',
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

  // Optimize tab
  const opt = t.optimize;
  return el(
    'div',
    { className: 'space-y-3.5' },
    el(
      'p',
      { className: 'type-body-sm' },
      'Re-builds the document cleanly in a Web Worker using compressed PDF object streams and removes unreferenced objects.'
    ),
    el(
      'label',
      {
        className:
          'flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] cursor-pointer'
      },
      el('span', { className: 'text-[13px] font-medium' }, 'Use PDF Object Streams'),
      el('input', {
        type: 'checkbox',
        checked: opt.useObjectStreams,
        className: 'w-4 h-4 accent-[#0a0a0a]',
        onChange: (e) => {
          opt.useObjectStreams = /** @type {HTMLInputElement} */ (e.target).checked;
        }
      })
    ),
    el(
      'label',
      {
        className:
          'flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] cursor-pointer'
      },
      el('span', { className: 'text-[13px] font-medium' }, 'Prune Orphan / Unused Objects'),
      el('input', {
        type: 'checkbox',
        checked: opt.rebuildCleanCopy,
        className: 'w-4 h-4 accent-[#0a0a0a]',
        onChange: (e) => {
          opt.rebuildCleanCopy = /** @type {HTMLInputElement} */ (e.target).checked;
        }
      })
    ),
    el(
      'label',
      {
        className:
          'flex items-center justify-between gap-2 p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] cursor-pointer'
      },
      el('span', { className: 'text-[13px] font-medium' }, 'Strip All Metadata'),
      el('input', {
        type: 'checkbox',
        checked: opt.stripMetadata,
        className: 'w-4 h-4 accent-[#0a0a0a]',
        onChange: (e) => {
          opt.stripMetadata = /** @type {HTMLInputElement} */ (e.target).checked;
        }
      })
    ),
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
