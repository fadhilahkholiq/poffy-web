import { formatBytes } from '../../core/utils/file-io.js';
import { workspace } from '../../state/workspace.js';
import { cancelActiveJob } from '../actions/export-runner.js';
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
            el('span', { className: 'badge-pill' }, `${job.percent}%`)
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

  mount(container, memoryBanner, noticeToast, jobDialog, previewModal);
}
