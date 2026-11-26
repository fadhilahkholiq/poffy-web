import { formatBytes } from '../../core/utils/file-io.js';
import { workspace } from '../../state/workspace.js';
import { cancelActiveJob, runAutoCropJob } from '../actions/export-runner.js';
import {
  renderCompareStudioModal,
  renderRedactStudioModal,
  renderSignStudioModal
} from './Phase3Modals.js';
import { renderBookmarkStudioModal, renderCbzStudioModal } from './Phase4Modals.js';
import { createClaySelect } from './ClaySelect.js';
import { el, mount, sanitizeImageSrc } from '../utils/dom.js';

/**
 * Renders memory warnings, worker progress modal, notice toast, and high-res page preview modal
 * strictly via safe DOM APIs (textContent / createElement).
 * @param {HTMLElement} container
 */
export function renderOverlays(container) {
  const mem = workspace.getMemoryStatus();
  const { job, notice, preview } = workspace;

  const previewPage = preview.pageId
    ? workspace.pages.find((p) => p.id === preview.pageId)
    : null;

  const memoryBanner = mem.warned
    ? el(
        'div',
        { className: 'max-w-[1360px] mx-auto px-4 sm:px-6 pt-3' },
        el(
          'div',
          {
            className:
              'rounded-[12px] bg-[#ffb084] text-[#0a0a0a] px-4 py-2.5 flex items-center justify-between gap-3 border border-[#e5e5e5]'
          },
          el(
            'p',
            { className: 'text-[13px] font-medium' },
            `High memory usage (${formatBytes(mem.totalBytes)} loaded; recommended limit ${formatBytes(
              mem.thresholdBytes
            )}). Consider removing unused source files after exporting.`
          )
        )
      )
    : null;

  const noticeClass =
    notice?.type === 'error'
      ? 'bg-[#ef4444] text-white border-[#ef4444]'
      : notice?.type === 'warning'
        ? 'bg-[#f59e0b] text-[#0a0a0a] border-[#f59e0b]'
        : notice?.type === 'success'
          ? 'bg-[#1a3a3a] text-white border-[#1a3a3a]'
          : 'bg-[#0a0a0a] text-white border-[#0a0a0a]';

  const noticeToast = notice
    ? el(
        'div',
        {
          className: `fixed bottom-5 right-5 z-50 max-w-md w-[calc(100%-2.5rem)] rounded-[16px] p-4 shadow-xl border ${noticeClass}`,
          role: 'alert'
        },
        el(
          'div',
          { className: 'flex items-start justify-between gap-3' },
          el(
            'div',
            { className: 'space-y-1' },
            el('p', { className: 'text-[14px] font-semibold' }, notice.title),
            el('p', { className: 'text-[13px] opacity-90 leading-snug' }, notice.message)
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'notice-close',
              className:
                'px-2 py-0.5 rounded-[8px] bg-black/15 hover:bg-black/25 text-[12px] font-medium cursor-pointer',
              onClick: () => workspace.clearNotice()
            },
            'Dismiss'
          )
        )
      )
    : null;

  const jobDialog = job.active
    ? el(
        'div',
        {
          className:
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'PDF processing progress'
        },
        el(
          'div',
          {
            className:
              'w-full max-w-md rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] p-6 shadow-2xl space-y-4'
          },
          el(
            'div',
            { className: 'flex items-center justify-between gap-3' },
            el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'Processing Locally'),
            el(
              'span',
              { className: 'badge-pill' },
              job.total > 0 ? `${job.current}/${job.total} • ${job.percent}%` : `${job.percent}%`
            )
          ),
          el('p', { className: 'type-body-sm text-[#3a3a3a]' }, job.stage || 'Working...'),
          el(
            'div',
            { className: 'w-full h-2.5 rounded-full bg-[#f5f0e0] overflow-hidden' },
            el('div', {
              className: 'h-full bg-[#0a0a0a] transition-all duration-150',
              style: { width: `${job.percent}%` }
            })
          ),
          el(
            'div',
            { className: 'flex justify-end pt-1' },
            el(
              'button',
              {
                type: 'button',
                id: 'job-cancel-btn',
                className: 'btn-secondary !h-9 !px-3.5',
                disabled: !job.requestId,
                onClick: cancelActiveJob
              },
              'Cancel'
            )
          )
        )
      )
    : null;

  const safePreviewSrc = sanitizeImageSrc(preview.imageUrl);
  const previewBody = preview.loading
    ? el('p', { className: 'type-body-sm text-[#6a6a6a]' }, 'Rendering high-resolution preview...')
    : safePreviewSrc
      ? el('img', {
          src: safePreviewSrc,
          alt: 'High resolution page preview',
          className:
            'max-w-full max-h-[72vh] rounded-[8px] shadow-lg bg-white transition-transform duration-150',
          style: { transform: `rotate(${previewPage?.rotation || 0}deg)` }
        })
      : el(
          'div',
          {
            className:
              'w-64 h-80 bg-white rounded-[8px] border border-[#e5e5e5] flex items-center justify-center text-[#6a6a6a] text-[13px]'
          },
          'Blank Page'
        );

  const previewModal = preview.pageId
    ? el(
        'div',
        {
          id: 'preview-backdrop',
          className:
            'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'Page Preview',
          onClick: (e) => {
            if (e.target === e.currentTarget) workspace.closePreview();
          }
        },
        el(
          'div',
          {
            className:
              'w-full max-w-3xl max-h-[90vh] rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] flex flex-col overflow-hidden shadow-2xl'
          },
          el(
            'div',
            {
              className:
                'px-5 py-3.5 border-b border-[#e5e5e5] flex items-center justify-between gap-3'
            },
            el(
              'div',
              { className: 'flex items-center gap-2' },
              el('span', { className: 'type-title-sm text-[#0a0a0a]' }, 'Page Preview'),
              previewPage
                ? el('span', { className: 'badge-pill' }, `Rotation ${previewPage.rotation}°`)
                : null
            ),
            el(
              'div',
              { className: 'flex items-center gap-2' },
              previewPage
                ? el(
                    'button',
                    {
                      type: 'button',
                      id: 'preview-rotate-btn',
                      className: 'btn-compact',
                      onClick: () => workspace.rotatePages([previewPage.id], 90)
                    },
                    'Rotate +90°'
                  )
                : null,
              el(
                'button',
                {
                  type: 'button',
                  id: 'preview-close-btn',
                  className: 'btn-compact',
                  onClick: () => workspace.closePreview()
                },
                'Close'
              )
            )
          ),
          el(
            'div',
            {
              className:
                'flex-1 overflow-auto p-6 bg-[#faf5e8] flex items-center justify-center min-h-[360px]'
            },
            previewBody
          )
        )
      )
    : null;

  const org = workspace.tools.organize;
  const selectedCount = workspace.pages.filter((p) => p.selected).length;
  const thresholdLabel = el('span', {}, String(org.autoCropThreshold));

  const autoCropModal = org.autoCropModalOpen
    ? el(
        'div',
        {
          id: 'autocrop-modal-backdrop',
          className:
            'fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'Auto-Crop Whitespace Margins',
          onClick: (e) => {
            if (e.target === e.currentTarget) {
              org.autoCropModalOpen = false;
              workspace.emit('tool');
            }
          }
        },
        el(
          'div',
          {
            className:
              'w-full max-w-md rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] p-6 shadow-2xl space-y-4'
          },
          el(
            'div',
            { className: 'flex items-center justify-between gap-3' },
            el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'Auto-Crop Whitespace'),
            el('span', { className: 'badge-pill bg-[#b8a4ed] text-[#0a0a0a]' }, 'OffscreenCanvas')
          ),
          el(
            'p',
            { className: 'type-body-sm' },
            'Scans page luminance off the main thread and updates CropBox margins safely (undoable).'
          ),
          el(
            'div',
            { className: 'grid grid-cols-2 gap-3' },
            el(
              'label',
              { className: 'text-[12px] text-[#6a6a6a] block' },
              'Padding',
              el('input', {
                id: 'autocrop-padding',
                type: 'number',
                min: '0',
                max: '100',
                value: String(org.autoCropPadding),
                className: 'input-clay !h-10 mt-1',
                onInput: (e) => {
                  org.autoCropPadding = Math.max(0, Number(/** @type {HTMLInputElement} */ (e.target).value) || 0);
                }
              })
            ),
            el(
              'label',
              { className: 'text-[12px] text-[#6a6a6a] block' },
              'Unit',
              createClaySelect({
                id: 'autocrop-unit',
                className: 'input-clay !h-10 mt-1',
                currentValue: org.autoCropUnit,
                options: [
                  ['pt', 'Points (pt)'],
                  ['mm', 'Millimeters (mm)']
                ],
                onChange: (val) => {
                  org.autoCropUnit = val;
                }
              })
            )
          ),
          el(
            'label',
            { className: 'block text-[12px] text-[#6a6a6a]' },
            'Whiteness Threshold (',
            thresholdLabel,
            '/255)',
            el('input', {
              id: 'autocrop-threshold',
              type: 'range',
              min: '200',
              max: '254',
              step: '1',
              value: String(org.autoCropThreshold),
              className: 'w-full mt-1.5 accent-[#0a0a0a]',
              onInput: (e) => {
                org.autoCropThreshold = Number(/** @type {HTMLInputElement} */ (e.target).value) || 245;
                thresholdLabel.textContent = String(org.autoCropThreshold);
              }
            })
          ),
          el(
            'div',
            { className: 'grid grid-cols-2 gap-3' },
            el(
              'label',
              { className: 'text-[12px] text-[#6a6a6a] block' },
              'Crop Mode',
              createClaySelect({
                id: 'autocrop-mode',
                className: 'input-clay !h-10 mt-1',
                currentValue: org.autoCropMode,
                options: [
                  ['uniform', 'Uniform (Union Box)'],
                  ['per-page', 'Per-Page Tight Crop']
                ],
                onChange: (val) => {
                  org.autoCropMode = val;
                }
              })
            ),
            el(
              'label',
              { className: 'text-[12px] text-[#6a6a6a] block' },
              'Target Pages',
              createClaySelect({
                id: 'autocrop-scope',
                className: 'input-clay !h-10 mt-1',
                currentValue: selectedCount > 0 ? org.autoCropScope : 'all',
                options: [
                  ['all', `All Pages (${workspace.pages.length})`],
                  ['selected', `Selected (${selectedCount})`, selectedCount === 0]
                ],
                onChange: (val) => {
                  org.autoCropScope = val;
                }
              })
            )
          ),
          el(
            'div',
            { className: 'flex justify-end gap-2 pt-2' },
            el(
              'button',
              {
                type: 'button',
                id: 'autocrop-cancel-btn',
                className: 'btn-secondary !h-10',
                onClick: () => {
                  org.autoCropModalOpen = false;
                  workspace.emit('tool');
                }
              },
              'Cancel'
            ),
            el(
              'button',
              {
                type: 'button',
                id: 'autocrop-run-btn',
                className: 'btn-primary !h-10',
                onClick: runAutoCropJob
              },
              'Detect & Apply Crop'
            )
          )
        )
      )
    : null;

  mount(
    container,
    memoryBanner,
    noticeToast,
    jobDialog,
    previewModal,
    autoCropModal,
    renderRedactStudioModal(),
    renderSignStudioModal(),
    renderCompareStudioModal(),
    renderBookmarkStudioModal(),
    renderCbzStudioModal()
  );
}
