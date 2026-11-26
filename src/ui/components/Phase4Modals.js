import { formatBytes } from '../../core/utils/file-io.js';
import { createUuid, workspace } from '../../state/workspace.js';
import {
  loadBookmarkPreviewPage,
  loadCbzArchiveFile,
  runCbzToPdfJob,
  runPdfToCbzJob,
  runReadOutlinesJob,
  runWriteOutlinesJob
} from '../actions/export-runner.js';
import { el, sanitizeImageSrc } from '../utils/dom.js';

/**
 * Recursively finds a bookmark node along with its parent array and index.
 * @param {import('../../core/pdf/outlines.js').BookmarkNode[]} list
 * @param {string} targetId
 * @param {import('../../core/pdf/outlines.js').BookmarkNode|null} [parentNode=null]
 */
function findNodeLocation(list, targetId, parentNode = null) {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === targetId) {
      return { list, index: i, node: list[i], parentNode };
    }
    if (Array.isArray(list[i].children) && list[i].children.length > 0) {
      const deep = findNodeLocation(list[i].children, targetId, list[i]);
      if (deep) return deep;
    }
  }
  return null;
}

/**
 * Renders the interactive Nested Bookmark / Outline Editor Studio modal with side-by-side preview (FEAT-11).
 * @returns {HTMLElement|null}
 */
export function renderBookmarkStudioModal() {
  const bm = workspace.tools.bookmarks;
  if (!bm.modalOpen) return null;

  const src = bm.targetFileId ? workspace.sourceFiles.get(bm.targetFileId) : null;
  const maxPages = src?.pageCount || bm.pageCount || 1;

  if (src && bm.previewLoadedIdx !== bm.previewPageIndex && !bm.previewLoading) {
    queueMicrotask(() => {
      loadBookmarkPreviewPage(bm.previewPageIndex);
    });
  }

  const selLoc = bm.selectedNodeId ? findNodeLocation(bm.tree, bm.selectedNodeId) : null;

  const renderTreeRows = (nodes, depth = 0) => {
    const rows = [];
    for (const node of nodes) {
      const isSelected = node.id === bm.selectedNodeId;
      const titleInput = /** @type {HTMLInputElement} */ (
        el('input', {
          type: 'text',
          value: node.title,
          className:
            'flex-1 min-w-0 bg-transparent text-[12px] font-medium outline-none border-b border-transparent focus:border-[#0a0a0a]',
          onInput: (e) => {
            node.title = /** @type {HTMLInputElement} */ (e.target).value;
          }
        })
      );
      titleInput.value = node.title;

      const pageInput = /** @type {HTMLInputElement} */ (
        el('input', {
          type: 'number',
          min: '1',
          max: String(maxPages),
          value: String((node.pageIndex || 0) + 1),
          title: 'Target page number',
          className: 'w-14 h-7 rounded border border-[#e5e5e5] bg-white text-center text-[11px] shrink-0',
          onChange: (e) => {
            const p1 = Math.max(1, Math.min(maxPages, Number(/** @type {HTMLInputElement} */ (e.target).value) || 1));
            node.pageIndex = p1 - 1;
            bm.selectedNodeId = node.id;
            loadBookmarkPreviewPage(node.pageIndex);
          }
        })
      );
      pageInput.value = String((node.pageIndex || 0) + 1);

      rows.push(
        el(
          'div',
          {
            className: `flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] border transition-colors ${
              isSelected
                ? 'bg-[#faf5e8] border-[#0a0a0a]'
                : 'bg-white border-[#e5e5e5] hover:border-[#0a0a0a]/40'
            }`,
            style: { marginLeft: `${Math.min(depth, 5) * 16}px` },
            onClick: () => {
              if (bm.selectedNodeId !== node.id) {
                bm.selectedNodeId = node.id;
                loadBookmarkPreviewPage(node.pageIndex || 0);
              }
            }
          },
          el('span', { className: 'text-[11px] text-[#6a6a6a] shrink-0' }, depth > 0 ? '↳' : '•'),
          titleInput,
          el('span', { className: 'text-[10px] text-[#6a6a6a] shrink-0' }, 'p.'),
          pageInput,
          el(
            'button',
            {
              type: 'button',
              title: 'Delete bookmark',
              className: 'text-[#ef4444] font-bold text-[12px] px-1 shrink-0',
              onClick: (e) => {
                e.stopPropagation();
                const loc = findNodeLocation(bm.tree, node.id);
                if (loc) {
                  loc.list.splice(loc.index, 1);
                  if (bm.selectedNodeId === node.id) bm.selectedNodeId = null;
                  workspace.emit('tool');
                }
              }
            },
            '×'
          )
        )
      );
      if (Array.isArray(node.children) && node.children.length > 0) {
        rows.push(...renderTreeRows(node.children, depth + 1));
      }
    }
    return rows;
  };

  return el(
    'div',
    {
      id: 'bookmark-studio-backdrop',
      className: 'fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Bookmark and Outline Editor Studio',
      onClick: (e) => {
        if (e.target === e.currentTarget) {
          bm.modalOpen = false;
          workspace.emit('tool');
        }
      }
    },
    el(
      'div',
      {
        className:
          'w-full max-w-6xl max-h-[92vh] rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] shadow-2xl flex flex-col overflow-hidden'
      },
      el(
        'div',
        { className: 'px-5 py-3.5 border-b border-[#e5e5e5] flex flex-wrap items-center justify-between gap-3 bg-white' },
        el(
          'div',
          { className: 'flex items-center gap-2.5' },
          el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'Bookmark/Outline Editor'),
          src ? el('span', { className: 'badge-pill bg-[#ffb084] text-[#0a0a0a]' }, `${src.name} (${maxPages}p)`) : null
        ),
        el(
          'div',
          { className: 'flex items-center gap-2' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 !px-3 !text-[12px]',
              disabled: !bm.targetFileId,
              onClick: runReadOutlinesJob
            },
            'Load Existing'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'bookmark-save-pdf-btn',
              className: 'btn-primary !h-8 !px-3.5 !text-[12px]',
              disabled: !bm.targetFileId,
              onClick: runWriteOutlinesJob
            },
            'Save Bookmarks PDF'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'bookmark-modal-close',
              className: 'btn-compact',
              onClick: () => {
                bm.modalOpen = false;
                workspace.emit('tool');
              }
            },
            'Close'
          )
        )
      ),
      el(
        'div',
        { className: 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden' },
        el(
          'div',
          { className: 'lg:col-span-6 border-b lg:border-b-0 lg:border-r border-[#e5e5e5] p-4 flex flex-col gap-3 overflow-hidden' },
          el(
            'div',
            { className: 'flex flex-wrap gap-1.5' },
            el(
              'button',
              {
                type: 'button',
                id: 'bm-add-root-btn',
                className: 'btn-secondary !h-8 !px-2.5 !text-[11px]',
                onClick: () => {
                  const id = createUuid();
                  bm.tree.push({
                    id,
                    title: `Section ${bm.tree.length + 1}`,
                    pageIndex: bm.previewPageIndex || 0,
                    children: []
                  });
                  bm.selectedNodeId = id;
                  workspace.emit('tool');
                }
              },
              '+ Add Root'
            ),
            el(
              'button',
              {
                type: 'button',
                id: 'bm-add-child-btn',
                className: 'btn-secondary !h-8 !px-2.5 !text-[11px]',
                disabled: !selLoc,
                onClick: () => {
                  if (!selLoc) return;
                  const id = createUuid();
                  selLoc.node.children.push({
                    id,
                    title: 'Sub-section',
                    pageIndex: selLoc.node.pageIndex,
                    children: []
                  });
                  bm.selectedNodeId = id;
                  workspace.emit('tool');
                }
              },
              '+ Add Child'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-compact !h-8',
                disabled: !selLoc || selLoc.index === 0,
                title: 'Move Up',
                onClick: () => {
                  if (!selLoc || selLoc.index === 0) return;
                  const [moved] = selLoc.list.splice(selLoc.index, 1);
                  selLoc.list.splice(selLoc.index - 1, 0, moved);
                  workspace.emit('tool');
                }
              },
              '↑'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-compact !h-8',
                disabled: !selLoc || selLoc.index >= selLoc.list.length - 1,
                title: 'Move Down',
                onClick: () => {
                  if (!selLoc || selLoc.index >= selLoc.list.length - 1) return;
                  const [moved] = selLoc.list.splice(selLoc.index, 1);
                  selLoc.list.splice(selLoc.index + 1, 0, moved);
                  workspace.emit('tool');
                }
              },
              '↓'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-compact !h-8',
                disabled: !selLoc || selLoc.index === 0,
                title: 'Indent under previous sibling',
                onClick: () => {
                  if (!selLoc || selLoc.index === 0) return;
                  const prevSibling = selLoc.list[selLoc.index - 1];
                  const [moved] = selLoc.list.splice(selLoc.index, 1);
                  prevSibling.children.push(moved);
                  workspace.emit('tool');
                }
              },
              'Indent →'
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-compact !h-8',
                disabled: !selLoc || !selLoc.parentNode,
                title: 'Outdent to parent level',
                onClick: () => {
                  if (!selLoc || !selLoc.parentNode) return;
                  const parentLoc = findNodeLocation(bm.tree, selLoc.parentNode.id);
                  if (!parentLoc) return;
                  const [moved] = selLoc.list.splice(selLoc.index, 1);
                  parentLoc.list.splice(parentLoc.index + 1, 0, moved);
                  workspace.emit('tool');
                }
              },
              '← Outdent'
            )
          ),
          el(
            'div',
            { className: 'flex-1 overflow-y-auto space-y-1.5 pr-1' },
            bm.tree.length === 0
              ? el(
                  'p',
                  { className: 'p-4 rounded-[12px] border border-dashed border-[#d4d0c5] text-[12px] text-[#6a6a6a]' },
                  'No bookmarks yet. Click "+ Add Root" or "Load Existing" to inspect embedded outlines.'
                )
              : renderTreeRows(bm.tree, 0)
          )
        ),
        el(
          'div',
          { className: 'lg:col-span-6 bg-[#f5f0e0] p-4 overflow-auto flex flex-col items-center gap-3' },
          el(
            'div',
            { className: 'flex items-center gap-2' },
            el(
              'button',
              {
                type: 'button',
                className: 'btn-compact',
                disabled: bm.previewPageIndex <= 0,
                onClick: () => loadBookmarkPreviewPage(bm.previewPageIndex - 1)
              },
              '← Prev'
            ),
            el('span', { className: 'text-[12px] font-medium' }, `Page ${bm.previewPageIndex + 1} / ${maxPages}`),
            el(
              'button',
              {
                type: 'button',
                className: 'btn-compact',
                disabled: bm.previewPageIndex >= maxPages - 1,
                onClick: () => loadBookmarkPreviewPage(bm.previewPageIndex + 1)
              },
              'Next →'
            )
          ),
          bm.previewLoading
            ? el('p', { className: 'text-[12px] text-[#6a6a6a] p-8' }, 'Rendering page preview...')
            : sanitizeImageSrc(bm.previewUrl)
              ? el('img', {
                  src: sanitizeImageSrc(bm.previewUrl),
                  alt: `Bookmark destination page ${bm.previewPageIndex + 1}`,
                  className: 'max-h-[64vh] w-auto rounded-[8px] shadow bg-white'
                })
              : el('p', { className: 'text-[12px] text-[#6a6a6a] p-8' }, 'Select a PDF to preview destination pages.')
        )
      )
    )
  );
}

/**
 * Renders the standalone CBZ <-> PDF Converter modal (FEAT-12) for direct hero launch.
 * @returns {HTMLElement|null}
 */
export function renderCbzStudioModal() {
  const cbz = workspace.tools.cbz;
  if (!cbz.modalOpen) return null;

  const isCbzToPdf = cbz.mode !== 'pdf-to-cbz';
  const pdfSources = [...workspace.sourceFiles.values()].filter((s) => s.type === 'pdf');

  return el(
    'div',
    {
      id: 'cbz-studio-backdrop',
      className: 'fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'CBZ and PDF Converter',
      onClick: (e) => {
        if (e.target === e.currentTarget) {
          cbz.modalOpen = false;
          workspace.emit('tool');
        }
      }
    },
    el(
      'div',
      { className: 'w-full max-w-lg rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] p-6 shadow-2xl space-y-4' },
      el(
        'div',
        { className: 'flex items-center justify-between gap-2' },
        el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'CBZ ↔ PDF Converter'),
        el(
          'button',
          {
            type: 'button',
            id: 'cbz-modal-close',
            className: 'btn-compact',
            onClick: () => {
              cbz.modalOpen = false;
              workspace.emit('tool');
            }
          },
          'Close'
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-2 gap-1.5 p-1 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5]' },
        el(
          'button',
          {
            type: 'button',
            className: `h-8 rounded-[9px] text-[12px] font-medium ${isCbzToPdf ? 'bg-[#0a0a0a] text-white' : 'text-[#555]'}`,
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
            className: `h-8 rounded-[9px] text-[12px] font-medium ${!isCbzToPdf ? 'bg-[#0a0a0a] text-white' : 'text-[#555]'}`,
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
              cbz.cbzFile ? `Selected: ${cbz.cbzFile.name} (${formatBytes(cbz.cbzFile.byteSize)})` : 'Choose .cbz Archive',
              el('input', {
                id: 'cbz-modal-file-input',
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
                  { className: 'p-2.5 rounded-[10px] bg-white border border-[#e5e5e5] max-h-36 overflow-y-auto space-y-0.5 text-[11px] font-mono' },
                  cbz.cbzEntries.map((name, idx) => el('div', { className: 'truncate' }, `${idx + 1}. ${name}`))
                )
              : null,
            el(
              'label',
              { className: 'flex items-center gap-2 text-[13px] cursor-pointer' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(cbz.uniformWidth),
                className: 'w-4 h-4 accent-[#0a0a0a]',
                onChange: (e) => {
                  cbz.uniformWidth = /** @type {HTMLInputElement} */ (e.target).checked;
                }
              }),
              'Normalize all pages to uniform width (A4)'
            ),
            el(
              'button',
              {
                type: 'button',
                id: 'cbz-modal-convert-btn',
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
            pdfSources.length === 0
              ? el('p', { className: 'text-[13px] text-[#6a6a6a]' }, 'Close this dialog and drop a PDF into the workspace first.')
              : el(
                  'div',
                  { className: 'space-y-3' },
                  el(
                    'p',
                    { className: 'text-[12px] text-[#1a1a1a]' },
                    `Target PDF: ${workspace.sourceFiles.get(cbz.targetFileId)?.name || pdfSources[0].name}`
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn-primary w-full',
                      onClick: runPdfToCbzJob
                    },
                    'Export PDF as Store-Mode CBZ'
                  )
                )
          )
    )
  );
}
