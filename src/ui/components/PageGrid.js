import { pdfRenderClient } from '../../core/render/pdfjs-client.js';
import { formatBytes } from '../../core/utils/file-io.js';
import { workspace } from '../../state/workspace.js';
import { bindFileDropzone } from '../interactions/file-ingestion.js';
import { bindSortablePageGrid } from '../interactions/sortable-grid.js';
import { el, mount, sanitizeImageSrc } from '../utils/dom.js';

/**
 * Opens the high-resolution page preview modal for a VirtualPage.
 * @param {import('../../state/workspace.js').VirtualPage} page
 */
async function openPagePreview(page) {
  workspace.closePreview();
  workspace.preview = {
    pageId: page.id,
    loading: page.sourceFileId !== '__blank__',
    imageUrl: null
  };
  workspace.emit('preview');

  if (page.sourceFileId === '__blank__') return;
  const source = workspace.sourceFiles.get(page.sourceFileId);
  if (!source) return;

  try {
    const url = await pdfRenderClient.renderHighResPreview(source, page.sourcePageIndex, 0);
    if (workspace.preview.pageId === page.id) {
      workspace.preview = {
        pageId: page.id,
        loading: false,
        imageUrl: url
      };
      workspace.emit('preview');
    }
  } catch (err) {
    workspace.closePreview();
    workspace.showNotice('error', 'Preview Failed', err?.message || 'Unable to render page preview.');
  }
}

/**
 * Renders the workspace source chips, batch action bar, and lazy thumbnail grid using safe DOM APIs.
 * @param {HTMLElement} container
 * @returns {() => void} Cleanup callback
 */
export function renderPageGrid(container) {
  const pages = workspace.pages;
  const selectedIds = pages.filter((p) => p.selected).map((p) => p.id);
  const targetIds = selectedIds.length > 0 ? selectedIds : pages.map((p) => p.id);
  const allSelected = pages.length > 0 && selectedIds.length === pages.length;

  const sourcesStrip = el(
    'div',
    { className: 'clay-card p-3 flex flex-wrap items-center gap-2' },
    el(
      'span',
      { className: 'type-caption-upper text-[#86868b] mr-1' },
      `Sources (${workspace.sourceFiles.size})`
    ),
    ...[...workspace.sourceFiles.values()].map((src) =>
      el(
        'div',
        { className: 'badge-pill bg-[#f2f2f7] border border-black/[0.06] max-w-full' },
        el('span', { className: 'truncate max-w-[180px] font-medium text-[#1d1d1f]' }, src.name),
        el(
          'span',
          { className: 'text-[#6e6e73] text-[12px]' },
          `${src.pageCount}p • ${formatBytes(src.buffer.byteLength)}`
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'ml-1 text-[#86868b] hover:text-[#ff3b30] font-bold cursor-pointer leading-none',
            title: `Remove ${src.name} from workspace`,
            'aria-label': `Remove ${src.name}`,
            onClick: () => workspace.removeSourceFile(src.id)
          },
          '×'
        )
      )
    ),
    workspace.sourceFiles.size === 0
      ? el(
          'span',
          { className: 'type-caption text-[#6e6e73]' },
          'Blank workspace, drop PDFs or images anywhere on this grid!'
        )
      : null,
    el(
      'button',
      {
        type: 'button',
        className: 'sm:hidden ml-auto btn-compact !h-7 !px-2.5 text-[12px]',
        onClick: () => workspace.clearWorkspace()
      },
      'Clear All'
    )
  );

  const batchBar = el(
    'div',
    {
      className:
        'clay-card p-2.5 md:sticky md:top-[64px] z-20 flex flex-wrap items-center justify-between gap-2 bg-white/90 backdrop-blur-[12px]'
    },
    el(
      'div',
      { className: 'flex flex-wrap items-center gap-2' },
      el(
        'button',
        {
          type: 'button',
          id: 'batch-select-toggle',
          className: 'btn-compact',
          onClick: () => workspace.setAllSelected(!allSelected)
        },
        allSelected ? 'Deselect All' : 'Select All'
      ),
      el(
        'span',
        { className: 'badge-pill' },
        selectedIds.length > 0
          ? `${selectedIds.length} of ${pages.length} selected`
          : `${pages.length} page${pages.length === 1 ? '' : 's'}`
      )
    ),
    el(
      'div',
      { className: 'flex flex-wrap items-center gap-1.5' },
      el(
        'button',
        {
          type: 'button',
          id: 'batch-rotate-left',
          className: 'btn-compact',
          title: 'Rotate left 90°',
          disabled: targetIds.length === 0,
          onClick: () => workspace.rotatePages(targetIds, -90)
        },
        '↺ -90°'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-rotate-right',
          className: 'btn-compact',
          title: 'Rotate right 90°',
          disabled: targetIds.length === 0,
          onClick: () => workspace.rotatePages(targetIds, 90)
        },
        '↻ +90°'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-duplicate',
          className: 'btn-compact',
          disabled: targetIds.length === 0,
          onClick: () =>
            workspace.duplicatePages(
              selectedIds.length > 0 ? selectedIds : pages.slice(-1).map((p) => p.id)
            )
        },
        'Duplicate'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-blank',
          className: 'btn-compact',
          onClick: () => workspace.insertBlankPage(workspace.tools.organize.blankSize)
        },
        '+ Blank Page'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-delete',
          className: 'btn-compact hover:!border-[#ef4444] hover:!text-[#ef4444]',
          disabled: selectedIds.length === 0,
          onClick: () => workspace.deletePages(selectedIds)
        },
        `Delete (${selectedIds.length})`
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-auto-crop',
          className: 'btn-compact',
          disabled: pages.length === 0,
          onClick: () => {
            workspace.tools.organize.autoCropModalOpen = true;
            workspace.emit('tool');
          }
        },
        'Auto-Crop'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-undo',
          className: 'btn-compact',
          disabled: workspace.undoStack.length === 0,
          onClick: () => workspace.undo()
        },
        'Undo'
      ),
      el(
        'button',
        {
          type: 'button',
          id: 'batch-redo',
          className: 'btn-compact',
          disabled: workspace.redoStack.length === 0,
          onClick: () => workspace.redo()
        },
        'Redo'
      )
    )
  );

  const gridEl = el('div', {
    id: 'sortable-page-grid',
    className: 'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-4'
  });

  for (let idx = 0; idx < pages.length; idx += 1) {
    const page = pages[idx];
    const src = workspace.sourceFiles.get(page.sourceFileId);
    const isBlank = page.sourceFileId === '__blank__';
    const sourceLabel = isBlank
      ? `Blank (${(page.blankSpec?.preset || 'a4').toUpperCase()})`
      : `${src?.name || 'Source'} • p${page.sourcePageIndex + 1}`;
    const hasCrop = Boolean(page.cropMargins);

    const thumbSlot = el(
      'div',
      {
        className:
          'relative w-full aspect-[3/4] rounded-[8px] bg-[#f2f2f7]/80 border border-black/[0.05] overflow-hidden flex items-center justify-center'
      },
      isBlank
        ? el(
            'div',
            {
              className:
                'w-[78%] h-[88%] bg-white border border-black/[0.08] rounded-[4px] shadow-xs flex flex-col items-center justify-center text-[#86868b] text-[12px] transition-transform duration-150',
              style: { transform: `rotate(${page.rotation}deg)` }
            },
            el('span', {}, 'Blank Page'),
            el(
              'span',
              { className: 'text-[11px]' },
              (page.blankSpec?.preset || 'a4').toUpperCase()
            )
          )
        : el('div', { className: 'text-[12px] text-[#86868b]' }, 'Loading preview...')
    );

    if (!isBlank && src) {
      const mountImage = ({ url }) => {
        if (!thumbSlot.isConnected) return;
        const safeUrl = sanitizeImageSrc(url);
        if (!safeUrl) {
          mount(thumbSlot, el('span', { className: 'text-[11px] text-[#ff3b30]' }, 'Blocked preview URL'));
          return;
        }
        mount(
          thumbSlot,
          el('img', {
            src: safeUrl,
            alt: `Page ${idx + 1} preview`,
            className:
              'max-w-[92%] max-h-[92%] object-contain rounded-[4px] shadow-xs bg-white transition-transform duration-150 pointer-events-none',
            style: { transform: `rotate(${page.rotation}deg)` },
            draggable: false
          })
        );
      };

      const cacheKey = `${src.id}:${page.sourcePageIndex}`;
      const cached = pdfRenderClient.thumbnailCache.get(cacheKey);
      if (cached) {
        queueMicrotask(() => mountImage(cached));
      } else {
        pdfRenderClient.observeElement(thumbSlot, () => {
          pdfRenderClient
            .getThumbnail(src, page.sourcePageIndex)
            .then(mountImage)
            .catch(() => {
              if (thumbSlot.isConnected) {
                mount(
                  thumbSlot,
                  el('span', { className: 'text-[11px] text-[#ff3b30]' }, 'Preview error')
                );
              }
            });
        });
      }
    }

    const quickDock = el(
      'div',
      {
        className:
          'page-quick-dock absolute bottom-2 inset-x-2 z-10 flex items-center justify-center pointer-events-none'
      },
      el(
        'div',
        {
          className:
            'pointer-events-auto inline-flex items-center gap-0.5 px-1.5 py-1 rounded-[10px] bg-white/95 backdrop-blur-[8px] border border-black/[0.08] shadow-[0_6px_16px_rgba(0,0,0,0.1)]'
        },
        el(
          'button',
          {
            type: 'button',
            className:
              'w-7 h-7 rounded-[6px] hover:bg-[#f2f2f7] text-[#1d1d1f] text-[12px] font-medium cursor-pointer flex items-center justify-center',
            title: 'Rotate Left (-90°)',
            'aria-label': `Rotate page ${idx + 1} left`,
            onClick: (e) => {
              e.stopPropagation();
              workspace.rotatePages([page.id], -90);
            }
          },
          '↺'
        ),
        el(
          'button',
          {
            type: 'button',
            className:
              'w-7 h-7 rounded-[6px] hover:bg-[#f2f2f7] text-[#1d1d1f] text-[12px] font-medium cursor-pointer flex items-center justify-center',
            title: 'Rotate Right (+90°)',
            'aria-label': `Rotate page ${idx + 1} right`,
            onClick: (e) => {
              e.stopPropagation();
              workspace.rotatePages([page.id], 90);
            }
          },
          '↻'
        ),
        el(
          'button',
          {
            type: 'button',
            className:
              'w-7 h-7 rounded-[6px] hover:bg-[#f2f2f7] text-[#1d1d1f] text-[12px] font-medium cursor-pointer flex items-center justify-center',
            title: 'Duplicate Page',
            'aria-label': `Duplicate page ${idx + 1}`,
            onClick: (e) => {
              e.stopPropagation();
              workspace.duplicatePages([page.id]);
            }
          },
          '⧉'
        ),
        el(
          'button',
          {
            type: 'button',
            className:
              'w-7 h-7 rounded-[6px] hover:bg-[#f2f2f7] text-[#1d1d1f] text-[12px] font-medium cursor-pointer flex items-center justify-center',
            title: 'High-res Zoom',
            'aria-label': `Zoom page ${idx + 1}`,
            onClick: (e) => {
              e.stopPropagation();
              openPagePreview(page);
            }
          },
          '⤢'
        ),
        el(
          'button',
          {
            type: 'button',
            className:
              'w-7 h-7 rounded-[6px] hover:bg-[#ff3b30]/10 hover:text-[#ff3b30] text-[#86868b] text-[13px] font-semibold cursor-pointer flex items-center justify-center',
            title: 'Delete Page',
            'aria-label': `Delete page ${idx + 1}`,
            onClick: (e) => {
              e.stopPropagation();
              workspace.deletePages([page.id]);
            }
          },
          '×'
        )
      )
    );

    const thumbStage = el('div', { className: 'relative' }, thumbSlot, quickDock);

    const card = el(
      'article',
      {
        className: `page-thumb-card p-3 flex flex-col gap-2 cursor-grab active:cursor-grabbing select-none ${
          page.selected ? 'is-selected' : ''
        }`,
        draggable: true,
        dataset: { pageId: page.id, pageIndex: String(idx) }
      },
      el(
        'div',
        { className: 'flex items-center justify-between gap-2' },
        el(
          'label',
          { className: 'inline-flex items-center gap-2 cursor-pointer' },
          el('input', {
            type: 'checkbox',
            checked: page.selected,
            className: 'w-4 h-4 accent-[#0071e3] cursor-pointer',
            onChange: (e) =>
              workspace.toggleSelectPage(page.id, /** @type {HTMLInputElement} */ (e.target).checked)
          }),
          el('span', { className: 'text-[13px] font-semibold text-[#1d1d1f]' }, `Page ${idx + 1}`)
        ),
        el(
          'div',
          { className: 'flex items-center gap-1' },
          page.rotation
            ? el(
                'span',
                {
                  className:
                    'text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#f2f2f7] text-[#1d1d1f]'
                },
                `${page.rotation}°`
              )
            : null,
          hasCrop
            ? el(
                'span',
                {
                  className:
                    'text-[11px] font-medium px-1.5 py-0.5 rounded bg-[#f3ebff] text-[#af52de]'
                },
                'Crop'
              )
            : null
        )
      ),
      thumbStage,
      el(
        'div',
        { className: 'flex items-center justify-between gap-2 pt-0.5' },
        el('span', { className: 'text-[11px] text-[#6e6e73] truncate', title: sourceLabel }, sourceLabel),
        el('span', { className: 'text-[11px] text-[#86868b] shrink-0' }, `#${idx + 1}`)
      )
    );

    gridEl.appendChild(card);
  }

  const dropArea = el(
    'div',
    { id: 'workspace-drop-area', className: 'p-4 sm:p-6 space-y-4' },
    sourcesStrip,
    batchBar,
    gridEl
  );
  mount(container, dropArea);

  const unbindSort = bindSortablePageGrid(gridEl);
  const unbindDrop = bindFileDropzone(dropArea);

  return () => {
    unbindSort();
    unbindDrop();
  };
}
