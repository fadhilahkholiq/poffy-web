import { formatBytes } from '../../core/utils/file-io.js';
import { workspace } from '../../state/workspace.js';
import { exportWorkspacePdf } from '../actions/export-runner.js';
import { el, mount, svgEl } from '../utils/dom.js';
import { bindCommandPaletteShortcut, openCommandPalette } from './CommandPalette.js';

/**
 * Renders and binds the sticky 56px frosted-glass navigation bar (and contextual workspace bar
 * when files are loaded) using strictly safe DOM APIs.
 * @param {HTMLElement} container
 * @param {() => void} onOpenFilePicker
 */
export function renderTopNav(container, onOpenFilePicker) {
  bindCommandPaletteShortcut();

  const pages = workspace.pages;
  const hasPages = pages.length > 0;
  const mem = workspace.getMemoryStatus();
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const sources = [...workspace.sourceFiles.values()];
  const docLabel =
    sources.length === 1
      ? sources[0].name
      : sources.length > 1
        ? `${sources.length} documents`
        : 'Blank document';

  // Crisp iOS-style rounded-square app glyph (white layered sheets over #0071e3 squircle)
  const logoSvg = svgEl(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
    svgEl('rect', { x: 4, y: 3, width: 11, height: 14, rx: 3, fill: 'rgba(255,255,255,0.45)' }),
    svgEl('rect', { x: 9, y: 7, width: 11, height: 14, rx: 3, fill: '#ffffff' })
  );

  const navContainerClass = hasPages
    ? 'w-full h-full px-3.5 sm:px-5 flex items-center justify-between gap-2 sm:gap-3'
    : 'max-w-[1120px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-3';

  const header = el(
    'header',
    { className: 'clay-nav w-full' },
    el(
      'div',
      { className: navContainerClass },
      el(
        'div',
        { className: 'flex items-center gap-2 sm:gap-3 min-w-0' },
        el(
          'a',
          {
            href: '/',
            className: 'flex items-center gap-2.5 min-w-0 shrink-0 no-underline text-[#1d1d1f]',
            'aria-label': 'Poffy Home'
          },
          el(
            'div',
            {
              className:
                'w-8 h-8 rounded-[9px] bg-[#0071e3] flex items-center justify-center shrink-0 shadow-[0_1px_4px_rgba(0,113,227,0.3)]',
              'aria-hidden': 'true'
            },
            logoSvg
          ),
          el(
            'div',
            { className: 'flex flex-col justify-center min-w-0' },
            el(
              'span',
              {
                className:
                  'text-[15.5px] sm:text-[16.5px] font-semibold tracking-[-0.02em] leading-[1.08] text-[#1d1d1f]'
              },
              'Poffy'
            ),
            el(
              'span',
              {
                className: `${
                  hasPages ? 'hidden sm:block' : 'block'
                } text-[9.5px] sm:text-[10.5px] font-medium tracking-[-0.01em] leading-[1.15] text-[#6e6e73] whitespace-nowrap`
              },
              'PDFs, Powered by Your Browser'
            )
          )
        ),
        hasPages
          ? el(
              'div',
              { className: 'hidden sm:flex items-center gap-2 min-w-0' },
              el(
                'span',
                {
                  className:
                    'hidden md:inline-flex items-center px-2.5 py-1 rounded-full bg-[#f2f2f7] text-[12px] font-medium text-[#1d1d1f] max-w-[200px]'
                },
                el('span', { className: 'truncate' }, docLabel)
              ),
              el(
                'span',
                {
                  className:
                    'inline-flex px-2.5 py-1 rounded-full bg-[#f2f2f7] text-[12px] font-medium text-[#6e6e73]'
                },
                `${pages.length} page${pages.length === 1 ? '' : 's'}`
              ),
              el(
                'span',
                {
                  className: `hidden xl:inline-flex px-2.5 py-1 rounded-full text-[12px] font-medium ${
                    mem.warned ? 'bg-[#fff1e5] text-[#ff9500]' : 'bg-[#f2f2f7] text-[#6e6e73]'
                  }`,
                  title: 'Combined in-memory ArrayBuffer footprint'
                },
                `RAM: ${formatBytes(mem.totalBytes)}`
              )
            )
          : null
      ),
      el(
        'div',
        { className: 'flex items-center gap-1.5 sm:gap-2 shrink-0' },
        !hasPages
          ? el(
              'span',
              {
                className:
                  'hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[#f2f2f7] text-[12px] font-medium text-[#424245] whitespace-nowrap',
                title: 'All PDF processing runs locally inside your browser'
              },
              el('span', {
                className: `w-2 h-2 rounded-full ${isOffline ? 'bg-[#ff9500]' : 'bg-[#34c759]'}`,
                'aria-hidden': 'true'
              }),
              isOffline ? 'Offline' : '100% Local'
            )
          : null,
        el(
          'button',
          {
            type: 'button',
            id: 'nav-cmdk-btn',
            className:
              'btn-secondary !h-8 sm:!h-9 !px-2.5 sm:!px-3 text-[12.5px] text-[#424245] whitespace-nowrap',
            title: 'Quick tool switcher (⌘K / Ctrl+K)',
            onClick: openCommandPalette
          },
          svgEl(
            'svg',
            {
              width: 13,
              height: 13,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              'stroke-width': 2.2,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
              'aria-hidden': 'true'
            },
            svgEl('circle', { cx: 11, cy: 11, r: 7 }),
            svgEl('path', { d: 'm20 20-3.5-3.5' })
          ),
          el(
            'kbd',
            {
              className: 'text-[11px] font-semibold text-[#6e6e73] font-sans'
            },
            '⌘K'
          )
        ),
        hasPages
          ? el(
              'button',
              {
                type: 'button',
                id: 'nav-undo',
                className: 'btn-secondary !h-9 !px-3.5 hidden md:inline-flex whitespace-nowrap text-[13px]',
                disabled: workspace.undoStack.length === 0,
                onClick: () => workspace.undo()
              },
              'Undo'
            )
          : null,
        hasPages
          ? el(
              'button',
              {
                type: 'button',
                id: 'nav-clear',
                className: 'btn-secondary !h-9 !px-3.5 hidden sm:inline-flex whitespace-nowrap text-[13px]',
                onClick: () => workspace.clearWorkspace()
              },
              'Reset'
            )
          : null,
        el(
          'button',
          {
            type: 'button',
            id: 'nav-add-files',
            className: hasPages
              ? 'btn-secondary !h-8 sm:!h-9 !px-2.5 sm:!px-3.5 text-[12.5px] sm:text-[13px] whitespace-nowrap'
              : 'btn-primary !h-8 sm:!h-9 !px-3.5 sm:!px-4 text-[13px] whitespace-nowrap',
            onClick: onOpenFilePicker
          },
          hasPages
            ? el(
                'span',
                {},
                el('span', { className: 'sm:hidden' }, '+ Add'),
                el('span', { className: 'hidden sm:inline' }, '+ Add Files')
              )
            : '+ Open PDF'
        ),
        hasPages
          ? el(
              'button',
              {
                type: 'button',
                id: 'nav-export',
                className:
                  'btn-primary !h-8 sm:!h-9 !px-3 sm:!px-4 text-[12.5px] sm:text-[13px] whitespace-nowrap',
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
