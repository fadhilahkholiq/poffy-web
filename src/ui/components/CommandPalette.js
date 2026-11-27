import { FEATURE_PAGES } from '../../core/seo/features.js';
import { workspace } from '../../state/workspace.js';
import { el, svgEl } from '../utils/dom.js';
import { getStudioCopy } from '../utils/tool-copy.js';
import { getToolIcon } from '../utils/tool-icons.js';
import { getToolStyleBySlug } from '../utils/tool-styles.js';
import { selectStudioTool } from './ToolInspector.js';

let paletteOpen = false;
let paletteQuery = '';

/** @type {HTMLElement|null} */
let activePaletteEl = null;

/**
 * Closes the quick tool command palette if open.
 */
export function closeCommandPalette() {
  paletteOpen = false;
  if (activePaletteEl && activePaletteEl.parentNode) {
    activePaletteEl.parentNode.removeChild(activePaletteEl);
  }
  activePaletteEl = null;
}

/**
 * Opens the `⌘K` quick tool switcher / navigation palette.
 */
export function openCommandPalette() {
  if (paletteOpen) {
    closeCommandPalette();
    return;
  }
  paletteOpen = true;
  paletteQuery = '';

  const hasWorkspacePages = workspace.pages.length > 0;

  const listEl = el('div', {
    className: 'max-h-[360px] overflow-y-auto p-2 space-y-0.5',
    role: 'listbox',
    'aria-label': 'PDF Studio Tools'
  });

  const renderRows = () => {
    const q = paletteQuery.trim().toLowerCase();
    const matches = FEATURE_PAGES.filter((f) => {
      if (!q) return true;
      const copy = getStudioCopy(f);
      return `${copy.title} ${copy.summary} ${f.shortName} ${f.keywords}`.toLowerCase().includes(q);
    });

    listEl.replaceChildren();
    if (matches.length === 0) {
      listEl.appendChild(
        el(
          'p',
          { className: 'py-8 text-center text-[13px] text-[#86868b]' },
          'No matching offline PDF tools.'
        )
      );
      return;
    }

    for (const f of matches) {
      const style = getToolStyleBySlug(f.slug);
      const copy = getStudioCopy(f);
      const row = el(
        'button',
        {
          type: 'button',
          role: 'option',
          className:
            'w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-[12px] text-left hover:bg-[#f2f2f7] transition-colors cursor-pointer',
          onClick: () => {
            closeCommandPalette();
            if (hasWorkspacePages) {
              selectStudioTool(f.tool, f.slug);
            } else {
              window.location.assign(f.path);
            }
          }
        },
        el(
          'div',
          { className: 'flex items-center gap-3 min-w-0' },
          el(
            'span',
            {
              className: 'w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0',
              style: { backgroundColor: style.bg, color: style.fg }
            },
            getToolIcon(f.slug, 17)
          ),
          el(
            'div',
            { className: 'min-w-0' },
            el('p', { className: 'text-[13.5px] font-semibold text-[#1d1d1f] truncate' }, copy.title),
            el('p', { className: 'text-[11.5px] text-[#6e6e73] truncate' }, copy.categoryLabel)
          )
        ),
        el(
          'span',
          {
            className: 'text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-[#f2f2f7] text-[#6e6e73] shrink-0'
          },
          hasWorkspacePages ? 'Switch' : 'Open'
        )
      );
      listEl.appendChild(row);
    }
  };

  const searchInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'cmdk-search-input',
      type: 'search',
      placeholder: hasWorkspacePages ? 'Switch studio tool' : `Search all ${FEATURE_PAGES.length} offline PDF tools`,
      className: 'w-full h-11 px-3 bg-transparent text-[14px] text-[#1d1d1f] outline-none placeholder:text-[#86868b]',
      onInput: (e) => {
        paletteQuery = /** @type {HTMLInputElement} */ (e.target).value;
        renderRows();
      }
    })
  );

  renderRows();

  const modalCard = el(
    'div',
    {
      className:
        'w-full max-w-[520px] rounded-[20px] bg-white border border-black/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.18)] overflow-hidden',
      onClick: (e) => e.stopPropagation()
    },
    el(
      'div',
      { className: 'flex items-center gap-2 px-3.5 border-b border-black/[0.08]' },
      svgEl(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: '#86868b',
          'stroke-width': 2.2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true'
        },
        svgEl('circle', { cx: 11, cy: 11, r: 7 }),
        svgEl('path', { d: 'm20 20-3.5-3.5' })
      ),
      searchInput,
      el(
        'button',
        {
          type: 'button',
          className:
            'text-[11px] font-medium px-2 py-1 rounded-[6px] bg-[#f2f2f7] text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer shrink-0',
          onClick: closeCommandPalette
        },
        'Esc'
      )
    ),
    listEl
  );

  const backdrop = el(
    'div',
    {
      id: 'cmdk-backdrop',
      className:
        'fixed inset-0 z-50 bg-black/25 backdrop-blur-[4px] flex items-start justify-center pt-[12vh] px-4',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Quick tool launcher',
      onClick: closeCommandPalette
    },
    modalCard
  );

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeCommandPalette();
      document.removeEventListener('keydown', onKeyDown);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  activePaletteEl = backdrop;
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => searchInput.focus());
}

let shortcutBound = false;

/**
 * Registers global `Cmd+K` / `Ctrl+K` shortcut once.
 */
export function bindCommandPaletteShortcut() {
  if (shortcutBound) return;
  shortcutBound = true;
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
  });
}
