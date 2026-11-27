import { el, svgEl } from './dom.js';
import { getToolIcon } from './tool-icons.js';

/**
 * Helper to create a crisp miniature skeleton text line inside an Apple light preview.
 * @param {string} widthClass
 * @param {string} [tone='bg-[#e5e5ea]']
 * @returns {HTMLElement}
 */
function line(widthClass, tone = 'bg-[#e5e5ea]') {
  return el('div', { className: `h-1 rounded-full ${widthClass} ${tone}` });
}

/**
 * Helper to create a crisp miniature white document sheet.
 * @param {string} extraClass
 * @param {...(HTMLElement|null)} children
 * @returns {HTMLElement}
 */
function miniSheet(extraClass = '', ...children) {
  return el(
    'div',
    {
      className: `bg-white border border-black/[0.07] rounded-[8px] shadow-[0_2px_6px_rgba(0,0,0,0.05)] p-1.5 flex flex-col gap-1 ${extraClass}`
    },
    ...children
  );
}

/**
 * Builds a sleek iOS / macOS light-mode miniature UI preview for each quick-tool Bento card.
 * @param {string} slug
 * @returns {HTMLElement}
 */
export function buildToolSnippet(slug) {
  let diagram = null;

  switch (slug) {
    case 'merge-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        miniSheet('w-11 h-12 -rotate-3', line('w-6', 'bg-[#007aff]'), line('w-full'), line('w-5')),
        el(
          'span',
          {
            className:
              'w-5 h-5 rounded-full bg-[#e8f2ff] text-[#007aff] text-[11px] font-bold flex items-center justify-center shrink-0'
          },
          '+'
        ),
        miniSheet('w-11 h-12 rotate-3 border-[#007aff]/40', line('w-6', 'bg-[#34c759]'), line('w-full'), line('w-5'))
      );
      break;

    case 'split-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        miniSheet('w-11 h-12', line('w-6', 'bg-[#00a3bf]'), line('w-full')),
        el('div', { className: 'h-10 border-l-2 border-dashed border-[#00a3bf]/55' }),
        miniSheet(
          'w-12 h-12 justify-between',
          line('w-6'),
          el(
            'span',
            { className: 'text-[8.5px] font-semibold px-1.5 py-0.5 rounded bg-[#e6f7fa] text-[#00a3bf] w-fit' },
            '.ZIP'
          )
        )
      );
      break;

    case 'organize-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        miniSheet('w-10 h-12', line('w-5'), line('w-full'), line('w-4')),
        miniSheet(
          'w-11 h-12 rotate-6 border-[#ff2d55]/30',
          line('w-6', 'bg-[#ff2d55]'),
          line('w-full'),
          el(
            'span',
            { className: 'mt-auto self-end text-[8.5px] font-semibold px-1 rounded bg-[#ffeaf0] text-[#ff2d55]' },
            '90°'
          )
        )
      );
      break;

    case 'resize-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        el(
          'div',
          {
            className:
              'bg-white border border-black/[0.08] rounded-[8px] w-28 h-12 p-1.5 flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.04)]'
          },
          el(
            'div',
            {
              className:
                'w-full h-full border border-dashed border-[#ff9500]/60 rounded-[5px] flex items-center justify-between px-2'
            },
            el('span', { className: 'text-[9px] font-medium text-[#6e6e73]' }, 'A4'),
            el('span', { className: 'text-[10px] text-[#86868b]' }, '→'),
            el(
              'span',
              { className: 'text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#fff1e5] text-[#c96a00]' },
              'Letter'
            )
          )
        )
      );
      break;

    case 'nup-booklet':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-22 h-12 !p-1 grid grid-cols-2 gap-1',
          el('div', { className: 'rounded-[4px] bg-[#f3ebff] flex items-center justify-center text-[8px] font-semibold text-[#af52de]' }, '1'),
          el('div', { className: 'rounded-[4px] bg-[#f2f2f7] flex items-center justify-center text-[8px] font-semibold text-[#6e6e73]' }, '2'),
          el('div', { className: 'rounded-[4px] bg-[#f2f2f7] flex items-center justify-center text-[8px] font-semibold text-[#6e6e73]' }, '3'),
          el('div', { className: 'rounded-[4px] bg-[#f3ebff] flex items-center justify-center text-[8px] font-semibold text-[#af52de]' }, '4')
        )
      );
      break;

    case 'split-spreads':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-24 h-12 !p-0 overflow-hidden grid grid-cols-2',
          el('div', { className: 'p-1.5 border-r-2 border-dashed border-[#00a3bf]/60 flex flex-col gap-1' }, line('w-5'), line('w-full')),
          el('div', { className: 'p-1.5 flex flex-col gap-1' }, line('w-5'), line('w-full'))
        )
      );
      break;

    case 'watermark-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-22 h-12 relative justify-center items-center overflow-hidden',
          el('div', { className: 'space-y-1 w-full opacity-55' }, line('w-full'), line('w-12'), line('w-full')),
          el(
            'span',
            {
              className:
                'absolute -rotate-12 px-1.5 py-0.5 rounded bg-[#f3ebff] text-[#af52de] text-[8px] font-bold tracking-wider border border-[#af52de]/30'
            },
            'DRAFT'
          )
        )
      );
      break;

    case 'page-numbers':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-22 h-12 justify-between',
          el('div', { className: 'space-y-1' }, line('w-10'), line('w-14')),
          el(
            'div',
            { className: 'flex justify-end' },
            el(
              'span',
              { className: 'px-1.5 py-0.5 rounded bg-[#fff1e5] text-[#c96a00] text-[8.5px] font-semibold' },
              '1 / 12'
            )
          )
        )
      );
      break;

    case 'sign-annotate':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-24 h-12 justify-between',
          el('div', { className: 'space-y-1' }, line('w-14'), line('w-9')),
          el(
            'div',
            { className: 'pt-1 border-t border-black/[0.06] flex items-center justify-between' },
            svgEl(
              'svg',
              { width: 42, height: 12, viewBox: '0 0 60 18', fill: 'none', stroke: '#1d1d1f', 'stroke-width': 2.2, 'stroke-linecap': 'round' },
              svgEl('path', { d: 'M3 13c5-9 9 2 13-6 2-4 5 7 9 1 4-5 7 3 13 1 5-1 10-3 18-1' })
            ),
            el('span', { className: 'w-2 h-2 rounded-full bg-[#ff2d55]' })
          )
        )
      );
      break;

    case 'redact-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-22 h-12 justify-center gap-1.5',
          line('w-12'),
          el('div', { className: 'h-2 w-16 rounded-[3px] bg-[#1d1d1f]' }),
          el('div', { className: 'h-2 w-10 rounded-[3px] bg-[#1d1d1f]' })
        )
      );
      break;

    case 'color-filters':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        el(
          'div',
          {
            className:
              'w-22 h-12 rounded-[8px] overflow-hidden border border-black/[0.08] shadow-[0_2px_6px_rgba(0,0,0,0.05)] grid grid-cols-2'
          },
          el('div', { className: 'bg-white p-1.5 flex flex-col gap-1' }, line('w-5', 'bg-[#1d1d1f]'), line('w-full')),
          el('div', { className: 'bg-[#1d1d1f] p-1.5 flex flex-col gap-1' }, line('w-5', 'bg-[#34c759]'), line('w-full', 'bg-white/30'))
        )
      );
      break;

    case 'compare-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-1.5 w-full' },
        miniSheet('w-11 h-12', line('w-6'), el('div', { className: 'h-1.5 w-full rounded bg-[#ffeaf0]' }), line('w-5')),
        miniSheet('w-11 h-12', line('w-6'), el('div', { className: 'h-1.5 w-full rounded bg-[#e8f8ed]' }), line('w-5'))
      );
      break;

    case 'images-to-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        el(
          'div',
          {
            className:
              'w-10 h-11 rounded-[8px] bg-white border border-black/[0.07] p-1.5 flex items-center justify-center text-[#ff9500] shadow-[0_2px_6px_rgba(0,0,0,0.04)]'
          },
          getToolIcon('images-to-pdf', 16)
        ),
        el('span', { className: 'text-[11px] font-medium text-[#86868b]' }, '→'),
        miniSheet(
          'w-10 h-12',
          el('span', { className: 'text-[8px] font-semibold px-1 rounded bg-[#fff1e5] text-[#c96a00] self-start' }, 'PDF'),
          line('w-full')
        )
      );
      break;

    case 'pdf-to-images':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        miniSheet('w-10 h-12', line('w-5', 'bg-[#00a3bf]'), line('w-full'), line('w-4')),
        el('span', { className: 'text-[11px] font-medium text-[#86868b]' }, '→'),
        el(
          'div',
          { className: 'flex flex-col gap-1' },
          el('span', { className: 'px-2 py-0.5 rounded bg-white border border-black/[0.07] text-[8px] font-semibold text-[#1d1d1f]' }, 'PNG'),
          el('span', { className: 'px-2 py-0.5 rounded bg-white border border-black/[0.07] text-[8px] font-semibold text-[#00a3bf]' }, 'WebP')
        )
      );
      break;

    case 'cbz-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        miniSheet(
          'w-11 h-12',
          el('span', { className: 'text-[8px] font-semibold px-1 rounded bg-[#f3ebff] text-[#af52de] self-start' }, '.CBZ'),
          line('w-full')
        ),
        el('span', { className: 'text-[11px] font-medium text-[#86868b]' }, '↔'),
        miniSheet(
          'w-11 h-12',
          el('span', { className: 'text-[8px] font-semibold px-1 rounded bg-[#f2f2f7] text-[#1d1d1f] self-start' }, '.PDF'),
          line('w-full')
        )
      );
      break;

    case 'extract-text':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-24 h-12 justify-center gap-1',
          el('div', { className: 'flex items-center gap-1' }, el('span', { className: 'text-[9px] font-bold text-[#248a3d]' }, 'Aa'), line('w-10', 'bg-[#1d1d1f]')),
          line('w-full'),
          line('w-14')
        )
      );
      break;

    case 'extract-images':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center gap-2 w-full' },
        miniSheet('w-10 h-11 items-center justify-center text-[#ff9500]', getToolIcon('extract-images', 15)),
        miniSheet(
          'w-11 h-11 items-center justify-center',
          el('span', { className: 'text-[8px] font-semibold px-1.5 py-0.5 rounded bg-[#fff1e5] text-[#c96a00]' }, '.JPG')
        )
      );
      break;

    case 'optimize-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-26 h-12 justify-center gap-1.5',
          el(
            'div',
            { className: 'flex items-center justify-between text-[8.5px] font-semibold text-[#1d1d1f]' },
            el('span', {}, '14 MB → 2 MB'),
            el('span', { className: 'px-1 rounded bg-[#e8f8ed] text-[#248a3d]' }, '-85%')
          ),
          el('div', { className: 'h-1.5 w-full rounded-full bg-[#f2f2f7] overflow-hidden' }, el('div', { className: 'h-full w-2/5 rounded-full bg-[#34c759]' }))
        )
      );
      break;

    case 'metadata-scrubber':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-26 h-12 justify-center gap-1',
          el(
            'div',
            { className: 'flex items-center justify-between text-[8px] font-semibold' },
            el('span', { className: 'line-through text-[#86868b]' }, 'Author'),
            el('span', { className: 'px-1.5 py-0.5 rounded bg-[#e8f8ed] text-[#248a3d]' }, 'Clean')
          ),
          line('w-12')
        )
      );
      break;

    case 'flatten-pdf':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-24 h-12 justify-center gap-1.5',
          el(
            'div',
            { className: 'h-4 rounded bg-[#e8f2ff] px-1.5 flex items-center text-[8px] font-semibold text-[#007aff]' },
            'Form locked ✓'
          ),
          line('w-12')
        )
      );
      break;

    case 'pdf-attachments':
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-24 h-12 justify-center gap-1',
          el('div', { className: 'flex items-center gap-1 text-[8px] font-semibold text-[#1d1d1f]' }, getToolIcon('pdf-attachments', 10), el('span', {}, 'budget.csv')),
          el('span', { className: 'text-[8px] px-1.5 py-0.5 rounded bg-[#f3ebff] text-[#af52de] font-semibold self-start' }, '+ files')
        )
      );
      break;

    case 'bookmark-editor':
    default:
      diagram = el(
        'div',
        { className: 'flex items-center justify-center w-full' },
        miniSheet(
          'w-24 h-12 justify-center gap-1.5',
          el('div', { className: 'flex items-center gap-1' }, el('span', { className: 'w-1.5 h-1.5 rounded-full bg-[#ff9500]' }), line('w-12', 'bg-[#1d1d1f]')),
          el('div', { className: 'flex items-center gap-1 pl-2.5' }, el('span', { className: 'w-1.5 h-1.5 rounded-full bg-[#d1d1d6]' }), line('w-10'))
        )
      );
      break;
  }

  return el(
    'div',
    {
      className: 'rounded-[12px] bg-[#f5f5f7] border border-black/[0.05] h-[72px] px-3 flex items-center justify-center overflow-hidden select-none',
      'aria-hidden': 'true'
    },
    diagram
  );
}
