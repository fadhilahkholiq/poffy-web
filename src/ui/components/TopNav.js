import { formatBytes } from '../../core/utils/file-io.js';
import { workspace } from '../../state/workspace.js';
import { exportWorkspacePdf } from '../actions/export-runner.js';
import { el, mount, svgEl } from '../utils/dom.js';

/**
 * Renders and binds the sticky 64px top navigation bar using safe DOM APIs.
 * @param {HTMLElement} container
 * @param {() => void} onOpenFilePicker
 */
export function renderTopNav(container, onOpenFilePicker) {
  const hasPages = workspace.pages.length > 0;
  const mem = workspace.getMemoryStatus();
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  const logoSvg = svgEl(
    'svg',
    { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none' },
    svgEl('rect', { x: 3, y: 2, width: 11, height: 14, rx: 3, fill: '#ff4d8b' }),
    svgEl('rect', { x: 7, y: 5, width: 11, height: 14, rx: 3, fill: '#b8a4ed' }),
    svgEl('rect', { x: 10, y: 8, width: 11, height: 14, rx: 3, fill: '#fffaf0' })
  );

  const header = el(
    'header',
    { className: 'clay-nav w-full' },
    el(
      'div',
      {
        className:
          'max-w-[1360px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-3'
      },
      el(
        'div',
        { className: 'flex items-center gap-3 min-w-0' },
        el(
          'a',
          {
            href: '/',
            className: 'flex items-center gap-3 min-w-0 no-underline text-[#0a0a0a]',
            'aria-label': 'Poffy Home'
          },
          el(
            'div',
            {
              className:
                'w-9 h-9 rounded-[10px] bg-[#0a0a0a] flex items-center justify-center shrink-0',
              'aria-hidden': 'true'
            },
            logoSvg
          ),
          el(
            'div',
            { className: 'flex items-baseline gap-2 min-w-0' },
            el('span', { className: 'type-title-md tracking-tight text-[#0a0a0a]' }, 'Poffy'),
            el(
              'span',
              { className: 'hidden sm:inline type-caption text-[#6a6a6a]' },
              'Offline PDF Studio'
            )
          )
        ),
        el(
          'span',
          {
            className: 'hidden md:inline-flex badge-pill ml-2',
            title: 'All PDF processing stays inside your browser'
          },
          el('span', {
            className: `w-2 h-2 rounded-full ${isOffline ? 'bg-[#f59e0b]' : 'bg-[#22c55e]'}`
          }),
          isOffline ? 'Offline Mode Active' : '100% Local • Zero Uploads'
        )
      ),
      el(
        'div',
        { className: 'flex items-center gap-2 sm:gap-3 shrink-0' },
        workspace.sourceFiles.size > 0
          ? el(
              'span',
              {
                className: `hidden sm:inline-flex badge-pill ${
                  mem.warned ? 'bg-[#ffb084] text-[#0a0a0a]' : ''
                }`,
                title: 'Combined in-memory ArrayBuffer footprint'
              },
              `RAM: ${formatBytes(mem.totalBytes)}`
            )
          : null,
        el(
          'button',
          {
            type: 'button',
            id: 'nav-add-files',
            className: 'btn-secondary !h-9 sm:!h-10 !px-3 sm:!px-4 whitespace-nowrap',
            onClick: onOpenFilePicker
          },
          el('span', {}, '+ Add Files')
        ),
        hasPages
          ? el(
              'button',
              {
                type: 'button',
                id: 'nav-clear',
                className: 'btn-secondary !h-9 sm:!h-10 !px-3.5 hidden sm:inline-flex whitespace-nowrap',
                onClick: () => workspace.clearWorkspace()
              },
              'Clear'
            )
          : null,
        hasPages
          ? el(
              'button',
              {
                type: 'button',
                id: 'nav-export',
                className: 'btn-primary !h-9 sm:!h-10 !px-3.5 sm:!px-4 whitespace-nowrap',
                disabled: workspace.job.active,
                onClick: () => exportWorkspacePdf()
              },
              'Export PDF'
            )
          : null
      )
    )
  );

  mount(container, header);
}
