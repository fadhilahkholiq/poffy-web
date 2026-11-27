import { FEATURE_PAGES } from '../../core/seo/features.js';
import { workspace } from '../../state/workspace.js';
import { bindFileDropzone } from '../interactions/file-ingestion.js';
import { el, mount, svgEl } from '../utils/dom.js';
import { getStudioCopy } from '../utils/tool-copy.js';
import { getToolIcon } from '../utils/tool-icons.js';
import { buildToolSnippet } from '../utils/tool-snippets.js';
import { getToolStyleBySlug } from '../utils/tool-styles.js';

const FEATURED_HERO_SLUGS = new Set(['merge-pdf', 'split-pdf', 'optimize-pdf', 'watermark-pdf']);

/**
 * Compact layered white PDF document stack graphic for the top Interactive Dropzone Bar.
 * @returns {HTMLElement}
 */
function buildCompactPdfStack() {
  return el(
    'div',
    {
      className: 'relative w-[68px] h-[54px] shrink-0 select-none pointer-events-none',
      'aria-hidden': 'true'
    },
    el('div', {
      className:
        'absolute left-0.5 top-1.5 w-[34px] h-[42px] rounded-[8px] bg-[#e8f2ff] border border-black/[0.06] -rotate-8'
    }),
    el('div', {
      className:
        'absolute right-0.5 top-1.5 w-[34px] h-[42px] rounded-[8px] bg-[#e8f8ed] border border-black/[0.06] rotate-8'
    }),
    el(
      'div',
      {
        className:
          'relative mx-auto w-[38px] h-[46px] rounded-[9px] bg-white border border-black/[0.08] shadow-[0_4px_12px_rgba(0,0,0,0.06)] p-1.5 flex flex-col gap-1'
      },
      el('div', { className: 'h-1.5 w-3.5 rounded-full bg-[#0071e3]' }),
      el('div', { className: 'h-1 w-full rounded-full bg-[#efeff4]' }),
      el('div', { className: 'h-1 w-4 rounded-full bg-[#efeff4]' }),
      el('div', { className: 'mt-auto h-2 rounded-[3px] bg-[#f2f2f7]' })
    )
  );
}

/**
 * Builds the sleek Interactive Dropzone Bar (`max-w-[1120px]`) placed right below the frosted navbar.
 * @param {() => void} onOpenFilePicker
 * @param {Object} [opts={}]
 * @param {string} [opts.headline]
 * @param {string} [opts.subtitle]
 * @param {string} [opts.primaryCta]
 * @param {HTMLElement|null} [opts.secondaryAction]
 * @returns {HTMLElement}
 */
function buildDropzoneBar(onOpenFilePicker, opts = {}) {
  const headline = opts.headline || 'Drop PDFs to start';
  const subtitle =
    opts.subtitle || 'Everything runs offline in your browser. Zero uploads, zero file limits.';
  const primaryCta = opts.primaryCta || '+ Choose Files';
  const secondaryAction = opts.secondaryAction || null;

  return el(
    'div',
    {
      id: 'hero-dropzone',
      role: 'region',
      'aria-label': 'Drop PDF or image files here',
      className:
        'clay-dropzone max-w-[1120px] mx-auto px-5 py-5 sm:px-7 sm:py-6 rounded-[22px] flex flex-col lg:flex-row lg:items-center justify-between gap-5 cursor-pointer',
      onClick: (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('button, a')) return;
        onOpenFilePicker();
      }
    },
    el(
      'div',
      { className: 'flex items-center gap-4 min-w-0' },
      buildCompactPdfStack(),
      el(
        'div',
        { className: 'min-w-0 space-y-1' },
        el('h1', { className: 'text-[20px] sm:text-[22px] font-semibold tracking-[-0.02em] text-[#1d1d1f] leading-tight' }, headline),
        el('p', { className: 'text-[13.5px] sm:text-[14px] text-[#6e6e73] leading-snug' }, subtitle)
      )
    ),
    el(
      'div',
      { className: 'flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0' },
      el(
        'div',
        { className: 'flex flex-col sm:flex-row items-stretch sm:items-center gap-2' },
        el(
          'button',
          {
            type: 'button',
            id: 'hero-pick-btn',
            className: 'btn-primary whitespace-nowrap',
            onClick: onOpenFilePicker
          },
          primaryCta
        ),
        secondaryAction
      ),
      el(
        'div',
        {
          className: 'flex items-center justify-center sm:justify-start gap-1.5 sm:pl-2 sm:border-l sm:border-black/[0.08]',
          'aria-label': 'Supported formats'
        },
        ['PDF', 'DOCX', 'XLSX', 'PPTX', 'PNG', 'JPG'].map((fmt) =>
          el(
            'span',
            {
              className:
                'px-2 py-0.5 rounded-[6px] bg-[#f2f2f7] text-[11px] font-medium text-[#6e6e73]'
            },
            fmt
          )
        )
      )
    )
  );
}

/**
 * Miniature macOS UI preview for Merge & Reorder Hero Bento Card.
 */
function buildMergePreview() {
  const makeMiniPage = (label, active = false) =>
    el(
      'div',
      {
        className: `w-[74px] sm:w-[84px] h-[94px] rounded-[10px] bg-white p-2 flex flex-col gap-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${
          active ? 'border-2 border-[#0071e3] -translate-y-1' : 'border border-black/[0.07]'
        }`
      },
      el('div', { className: `h-1.5 w-8 rounded-full ${active ? 'bg-[#0071e3]' : 'bg-[#d1d1d6]'}` }),
      el('div', { className: 'h-1 w-full rounded-full bg-[#efeff4]' }),
      el('div', { className: 'h-1 w-10 rounded-full bg-[#efeff4]' }),
      el(
        'span',
        { className: 'mt-auto text-[10px] font-medium text-[#6e6e73]' },
        label
      )
    );

  const cursorSvg = svgEl(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: '#1d1d1f',
      stroke: '#ffffff',
      'stroke-width': 1.8,
      className: 'drop-shadow-xs',
      'aria-hidden': 'true'
    },
    svgEl('path', { d: 'm4 3 7.2 17 2.6-6.2L20 11.2 4 3Z' })
  );

  return el(
    'div',
    {
      className:
        'relative rounded-[14px] bg-[#f5f5f7] border border-black/[0.05] px-4 py-4 flex items-center justify-center gap-2.5 overflow-hidden select-none',
      'aria-hidden': 'true'
    },
    makeMiniPage('Page 1'),
    el(
      'span',
      {
        className:
          'w-6 h-6 rounded-full bg-[#e8f2ff] text-[#007aff] text-[13px] font-bold flex items-center justify-center shrink-0 border border-[#007aff]/15'
      },
      '+'
    ),
    el('div', { className: 'relative' }, makeMiniPage('Page 2', true), el('div', { className: 'absolute -right-2 -bottom-2' }, cursorSvg)),
    makeMiniPage('Page 3')
  );
}

/**
 * Miniature macOS UI preview for Split & Extract Hero Bento Card.
 */
function buildSplitPreview() {
  return el(
    'div',
    {
      className:
        'rounded-[14px] bg-[#f5f5f7] border border-black/[0.05] px-4 py-4 flex items-center justify-center gap-3 select-none',
      'aria-hidden': 'true'
    },
    el(
      'div',
      {
        className:
          'w-[76px] h-[88px] rounded-[10px] bg-white border border-black/[0.07] shadow-[0_2px_8px_rgba(0,0,0,0.05)] p-2 flex flex-col gap-1.5'
      },
      el('div', { className: 'h-1.5 w-7 rounded-full bg-[#00a3bf]' }),
      el('div', { className: 'h-1 w-full rounded-full bg-[#efeff4]' }),
      el('span', { className: 'mt-auto text-[10px] font-medium text-[#6e6e73]' }, 'Pages 1–3')
    ),
    el('div', { className: 'h-[82px] border-l-2 border-dashed border-[#00a3bf]/55 relative flex items-center' }),
    el(
      'div',
      {
        className:
          'relative w-[76px] h-[88px] rounded-[10px] bg-white border border-black/[0.07] shadow-[0_2px_8px_rgba(0,0,0,0.05)] p-2 flex flex-col gap-1.5'
      },
      el('div', { className: 'h-1.5 w-7 rounded-full bg-[#d1d1d6]' }),
      el('div', { className: 'h-1 w-full rounded-full bg-[#efeff4]' }),
      el(
        'span',
        {
          className:
            'mt-auto inline-flex items-center justify-center px-1.5 py-0.5 rounded-[5px] bg-[#e6f7fa] text-[#00a3bf] text-[10px] font-semibold w-fit'
        },
        '.ZIP'
      )
    )
  );
}

/**
 * Miniature macOS UI preview for Compress & Optimize Hero Bento Card.
 */
function buildCompressPreview() {
  return el(
    'div',
    {
      className:
        'rounded-[14px] bg-[#f5f5f7] border border-black/[0.05] px-4 py-6 flex items-center justify-center select-none',
      'aria-hidden': 'true'
    },
    el(
      'div',
      {
        className:
          'inline-flex flex-wrap items-center justify-center gap-2.5 px-3.5 py-2.5 rounded-full bg-white border border-black/[0.07] shadow-[0_2px_10px_rgba(0,0,0,0.05)]'
      },
      el('span', { className: 'text-[12.5px] font-medium text-[#86868b] line-through' }, '14.8 MB'),
      el('span', { className: 'text-[12px] text-[#86868b]' }, '→'),
      el('span', { className: 'text-[13px] font-semibold text-[#1d1d1f]' }, '2.1 MB'),
      el(
        'span',
        {
          className:
            'px-2 py-0.5 rounded-full bg-[#e8f8ed] text-[#248a3d] text-[11px] font-semibold'
        },
        '-85%'
      )
    )
  );
}

/**
 * Miniature macOS UI preview for Watermark & Privacy Scrub Hero Bento Card.
 */
function buildWatermarkPrivacyPreview() {
  const shieldSvg = svgEl(
    'svg',
    {
      width: 13,
      height: 13,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.3,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    },
    svgEl('path', { d: 'M12 2 4 5v6c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5l-8-3Z' }),
    svgEl('path', { d: 'm9 12 2 2 4-4' })
  );

  return el(
    'div',
    {
      className:
        'rounded-[14px] bg-[#f5f5f7] border border-black/[0.05] px-4 py-4 flex flex-wrap items-center justify-center gap-4 select-none',
      'aria-hidden': 'true'
    },
    el(
      'div',
      {
        className:
          'relative w-[138px] h-[88px] rounded-[10px] bg-white border border-black/[0.07] shadow-[0_2px_8px_rgba(0,0,0,0.05)] p-2.5 overflow-hidden flex flex-col gap-1.5'
      },
      el('div', { className: 'h-1.5 w-14 rounded-full bg-[#efeff4]' }),
      el('div', { className: 'h-1 w-20 rounded-full bg-[#efeff4]' }),
      el('div', { className: 'h-1 w-16 rounded-full bg-[#efeff4]' }),
      el(
        'span',
        {
          className:
            'absolute inset-x-2 top-7 text-center px-1.5 py-0.5 rounded border border-[#af52de]/45 bg-[#f3ebff]/85 text-[#af52de] text-[9.5px] font-bold tracking-[0.08em] -rotate-12'
        },
        'CONFIDENTIAL'
      )
    ),
    el(
      'div',
      {
        className:
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#e8f8ed] text-[#248a3d] text-[12px] font-semibold border border-[#34c759]/25'
      },
      shieldSvg,
      'Metadata Clean'
    )
  );
}

/**
 * Builds the miniature visual preview card displayed on each dedicated `/<slug>/` tool page.
 * Uses the rich featured preview for core workflows and `buildToolSnippet` for all other tools.
 * @param {string} slug
 * @returns {HTMLElement}
 */
/**
 * Contextual accepted file badges per tool route.
 * @param {string} slug
 * @returns {string[]}
 */
function getAcceptedFormatPills(slug) {
  if (slug === 'docx-to-pdf') return ['.DOCX'];
  if (slug === 'xlsx-to-pdf') return ['.XLSX', '.XLS', '.CSV'];
  if (slug === 'pptx-to-pdf') return ['.PPTX'];
  if (slug === 'images-to-pdf') return ['PNG', 'JPG', 'WebP'];
  if (slug === 'cbz-pdf') return ['.CBZ', '.PDF'];
  if (slug === 'merge-pdf' || slug === 'organize-pdf') return ['.PDF', 'PNG', 'JPG', 'WebP'];
  return ['.PDF'];
}

/**
 * Resolve source -> target badge spec for a miniature conversion graphic.
 * @param {string} slug
 * @returns {{ from: string, fromColor: string, to: string, toColor: string } | null}
 */
function getConversionDiagramSpec(slug) {
  const map = {
    'docx-to-pdf': { from: '.DOCX', fromColor: '#0071e3', to: '.PDF', toColor: '#d93025' },
    'xlsx-to-pdf': { from: '.XLSX', fromColor: '#248a3d', to: '.PDF', toColor: '#d93025' },
    'pptx-to-pdf': { from: '.PPTX', fromColor: '#c93400', to: '.PDF', toColor: '#d93025' },
    'pdf-to-markdown': { from: '.PDF', fromColor: '#d93025', to: '.MD', toColor: '#1d1d1f' },
    'pdf-to-docx': { from: '.PDF', fromColor: '#d93025', to: '.DOCX', toColor: '#0071e3' },
    'pdf-to-xlsx': { from: '.PDF', fromColor: '#d93025', to: '.XLSX', toColor: '#248a3d' },
    'pdf-to-pptx': { from: '.PDF', fromColor: '#d93025', to: '.PPTX', toColor: '#c93400' },
    'images-to-pdf': { from: 'IMG', fromColor: '#00839b', to: '.PDF', toColor: '#d93025' },
    'pdf-to-images': { from: '.PDF', fromColor: '#d93025', to: 'PNG', toColor: '#00839b' },
    'cbz-pdf': { from: '.CBZ', fromColor: '#bf4800', to: '.PDF', toColor: '#d93025' }
  };
  return map[slug] || null;
}

/**
 * Build a 48px miniature document sheet with crisp placeholder lines and badge tag.
 * @param {string} label
 * @param {string} accentColor
 * @param {string} [extraClass]
 * @returns {HTMLElement}
 */
function buildMiniDocSheet(label, accentColor, extraClass = '') {
  return el(
    'div',
    {
      className:
        `w-[38px] h-[48px] rounded-[8px] bg-white border border-black/[0.1] shadow-[0_3px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] flex flex-col justify-between p-1.5 relative ${extraClass}`.trim()
    },
    el(
      'div',
      { className: 'space-y-1' },
      el('div', { className: 'h-[2.5px] w-4 rounded-full bg-black/[0.14]' }),
      el('div', { className: 'h-[2px] w-5 rounded-full bg-black/[0.08]' }),
      el('div', { className: 'h-[2px] w-3.5 rounded-full bg-black/[0.08]' })
    ),
    el(
      'span',
      {
        className:
          'inline-block self-start px-1 py-[1px] rounded-[4px] text-[7.5px] font-bold leading-tight tracking-tight text-white',
        style: { backgroundColor: accentColor }
      },
      label
    )
  );
}

/**
 * Build the 48px miniature layered document graphic inside the recessed drop well.
 * @param {string} slug
 * @param {{ bg: string, fg: string }} style
 * @returns {HTMLElement}
 */
function buildToolWellGraphic(slug, style) {
  const conv = getConversionDiagramSpec(slug);
  if (conv) {
    return el(
      'div',
      {
        className: 'studio-well-graphic inline-flex items-center gap-2.5 select-none',
        'aria-hidden': 'true'
      },
      buildMiniDocSheet(conv.from, conv.fromColor, '-rotate-2'),
      el(
        'span',
        {
          className:
            'w-6 h-6 rounded-full bg-white border border-black/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex items-center justify-center text-[11px] font-semibold text-[#6e6e73]'
        },
        '→'
      ),
      buildMiniDocSheet(conv.to, conv.toColor, 'rotate-2')
    );
  }

  return el(
    'div',
    {
      className: 'studio-well-graphic relative inline-flex items-center justify-center h-[50px] w-[76px] select-none',
      'aria-hidden': 'true'
    },
    el('div', {
      className:
        'absolute left-1.5 top-1 w-[36px] h-[44px] rounded-[8px] bg-white/90 border border-black/[0.08] shadow-[0_2px_6px_rgba(0,0,0,0.04)] -rotate-6'
    }),
    buildMiniDocSheet('.PDF', '#d93025', 'relative z-10 rotate-2'),
    el(
      'span',
      {
        className:
          'absolute -right-0.5 -bottom-0.5 z-20 w-6 h-6 rounded-[7px] border border-white shadow-[0_2px_6px_rgba(0,0,0,0.12)] flex items-center justify-center',
        style: { backgroundColor: style.bg, color: style.fg }
      },
      getToolIcon(slug, 13)
    )
  );
}

/**
 * Build a 24x24 tinted squircle mini-icon for tool highlight cards.
 * @param {{ bg: string, fg: string }} style
 * @param {number} index
 * @returns {HTMLElement}
 */
function buildHighlightSquircle(style, index) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const iconPaths = [
    ['M20 6 9 17l-5-5'],
    ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
    ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']
  ];
  for (const d of iconPaths[index % iconPaths.length]) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }

  return el(
    'span',
    {
      className: 'w-6 h-6 rounded-[7px] shrink-0 flex items-center justify-center mt-0.5',
      style: { backgroundColor: style.bg, color: style.fg },
      'aria-hidden': 'true'
    },
    svg
  );
}

/**
 * Renders either the iOS / macOS Home Studio (`/`) with immediate Dropzone Bar + Asymmetric Bento Showcase,
 * or a focused native-app Tool Route (`/<slug>/`).
 * @param {HTMLElement} container
 * @param {() => void} onOpenFilePicker
 * @param {import('../../core/seo/features.js').FeaturePageMeta|null} [activeFeature=null]
 * @returns {() => void} Cleanup callback
 */
export function renderHeroDropzone(container, onOpenFilePicker, activeFeature = null) {
  if (activeFeature) {
    const style = getToolStyleBySlug(activeFeature.slug);
    const copy = getStudioCopy(activeFeature);

    const secondaryAction =
      activeFeature.tool === 'compare'
        ? el(
            'button',
            {
              type: 'button',
              id: 'hero-compare-studio-btn',
              className: 'btn-secondary text-[13px] px-4 py-2.5 shrink-0',
              onClick: (e) => {
                e.stopPropagation();
                workspace.tools.compare.modalOpen = true;
                workspace.emit('tool');
              }
            },
            'Open Dual Compare'
          )
        : activeFeature.tool === 'cbz'
          ? el(
              'button',
              {
                type: 'button',
                id: 'hero-cbz-studio-btn',
                className: 'btn-secondary text-[13px] px-4 py-2.5 shrink-0',
                onClick: (e) => {
                  e.stopPropagation();
                  workspace.tools.cbz.modalOpen = true;
                  workspace.emit('tool');
                }
              },
              'Open CBZ Converter'
            )
          : null;

    const formatPills = getAcceptedFormatPills(activeFeature.slug);
    const ctaBtn = el(
      'button',
      {
        type: 'button',
        className: 'btn-primary text-[13.5px] px-5 py-2.5 shrink-0',
        onClick: (e) => {
          e.stopPropagation();
          onOpenFilePicker();
        }
      },
      activeFeature.ctaLabel
    );

    const dropCard = el(
      'div',
      {
        id: 'hero-dropzone',
        role: 'region',
        'aria-label': `${copy.title} file dropzone`,
        tabIndex: 0,
        className: 'studio-drop-card max-w-[760px] w-full mx-auto p-3 sm:p-4 cursor-pointer',
        onClick: () => onOpenFilePicker(),
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenFilePicker();
          }
        }
      },
      el(
        'div',
        { className: 'studio-drop-well flex flex-col items-center text-center gap-4' },
        buildToolWellGraphic(activeFeature.slug, style),
        el(
          'div',
          { className: 'space-y-1.5' },
          el(
            'h2',
            { className: 'text-[17px] sm:text-[19px] font-semibold tracking-[-0.015em] text-[#1d1d1f]' },
            activeFeature.ctaLabel
          ),
          el(
            'p',
            { className: 'text-[13.5px] leading-[1.45] text-[#6e6e73] max-w-[44ch] mx-auto' },
            'Runs offline in your browser. Zero uploads, zero file limits.'
          )
        ),
        el(
          'div',
          { className: 'flex flex-wrap items-center justify-center gap-2.5 pt-0.5' },
          ctaBtn,
          secondaryAction
        ),
        el(
          'div',
          {
            className: 'flex flex-wrap items-center justify-center gap-2 pt-1 text-[11.5px] text-[#86868b]',
            'aria-label': 'Supported formats'
          },
          el(
            'div',
            { className: 'flex items-center gap-1.5' },
            formatPills.map((fmt) =>
              el(
                'span',
                {
                  className:
                    'inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-black/[0.08] text-[10.5px] font-semibold tracking-wider text-[#424245] shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
                },
                fmt
              )
            )
          ),
          el('span', { className: 'font-medium text-[#86868b]' }, 'or drop anywhere · ⌘V')
        )
      )
    );

    const toolMain = el(
      'main',
      { className: 'max-w-[1120px] mx-auto px-4 sm:px-6 pt-8 pb-10 space-y-6' },
      el(
        'header',
        { className: 'text-center space-y-3' },
        el(
          'div',
          { className: 'flex justify-center' },
          el(
            'a',
            {
              href: '/',
              className:
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/85 hover:bg-white border border-black/[0.07] shadow-[0_1px_2px_rgba(0,0,0,0.03)] text-[12.5px] font-medium text-[#424245] no-underline transition-colors'
            },
            '← All Tools'
          )
        ),
        el(
          'div',
          { className: 'flex items-center justify-center pt-1' },
          el(
            'span',
            {
              className:
                'w-11 h-11 rounded-[12px] flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.65)]',
              style: { backgroundColor: style.bg, color: style.fg }
            },
            getToolIcon(activeFeature.slug, 21)
          )
        ),
        el('h1', { className: 'type-display-sm text-[#1d1d1f]' }, copy.title),
        el(
          'p',
          { className: 'text-[15px] leading-[1.5] text-[#6e6e73] max-w-[56ch] mx-auto' },
          copy.summary
        )
      ),
      dropCard,
      el(
        'ul',
        {
          className:
            'max-w-[760px] mx-auto w-full grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px] leading-[1.45] text-[#424245] list-none p-0 m-0'
        },
        activeFeature.highlights.slice(0, 3).map((item, idx) =>
          el(
            'li',
            {
              className: 'studio-highlight-card flex items-start gap-2.5 px-3.5 py-3 text-left'
            },
            buildHighlightSquircle(style, idx),
            el('span', { className: 'min-w-0 font-medium text-[#424245]' }, item)
          )
        )
      )
    );

    mount(container, toolMain);
    return bindFileDropzone(dropCard);
  }

  const dropzone = buildDropzoneBar(onOpenFilePicker);
  const bySlug = new Map(FEATURE_PAGES.map((f) => [f.slug, f]));

  const HERO_CARDS = [
    { slug: 'merge-pdf', span: 'md:col-span-7', preview: buildMergePreview },
    { slug: 'split-pdf', span: 'md:col-span-5', preview: buildSplitPreview },
    { slug: 'optimize-pdf', span: 'md:col-span-5', preview: buildCompressPreview },
    { slug: 'watermark-pdf', span: 'md:col-span-7', preview: buildWatermarkPrivacyPreview }
  ];

  const featuredSection = el(
    'section',
    { 'aria-label': 'Featured PDF workflows', className: 'space-y-3.5' },
    el(
      'div',
      { className: 'flex items-center justify-between gap-2' },
      el('h2', { className: 'text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f]' }, 'Featured Workflows'),
      el('span', { className: 'text-[12px] text-[#86868b]' }, '4 Essentials')
    ),
    el(
      'div',
      { className: 'grid grid-cols-1 md:grid-cols-12 gap-4' },
      HERO_CARDS.map(({ slug, span, preview }) => {
        const feature = bySlug.get(slug);
        if (!feature) return null;
        const style = getToolStyleBySlug(slug);
        const copy = getStudioCopy(feature);
        return el(
          'a',
          {
            href: feature.path,
            className: `clay-bento-card !p-6 !rounded-[22px] ${span} flex flex-col justify-between gap-4 no-underline text-left cursor-pointer`
          },
          el(
            'div',
            { className: 'flex items-start gap-3.5' },
            el(
              'span',
              {
                className: 'w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0',
                style: { backgroundColor: style.bg, color: style.fg }
              },
              getToolIcon(slug, 21)
            ),
            el(
              'div',
              { className: 'space-y-1 min-w-0' },
              el(
                'h3',
                { className: 'text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f]' },
                copy.title
              ),
              el(
                'p',
                { className: 'text-[13.5px] leading-[1.45] text-[#6e6e73]' },
                copy.summary
              )
            )
          ),
          preview()
        );
      })
    )
  );

  let activeToolkitGroup = 'all';

  const GROUP_TABS = /** @type {const} */ ([
    { id: 'all', label: 'All Tools' },
    { id: 'pages', label: 'Pages & Layout' },
    { id: 'security', label: 'Security & Privacy' },
    { id: 'convert', label: 'Convert' },
    { id: 'inspect', label: 'Inspect' }
  ]);

  const cardsGrid = el(
    'div',
    { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5' },
    FEATURE_PAGES.map((card) => {
      const style = getToolStyleBySlug(card.slug);
      const copy = getStudioCopy(card);
      const isFeaturedHero = FEATURED_HERO_SLUGS.has(card.slug);

      return el(
        'a',
        {
          href: card.path,
          dataset: {
            toolGroup: copy.category,
            isFeaturedHero: isFeaturedHero ? 'true' : 'false',
            toolSearch: `${copy.title} ${copy.summary} ${copy.categoryLabel} ${card.keywords}`.toLowerCase()
          },
          className:
            'clay-bento-card !p-[18px] !rounded-[18px] flex flex-col justify-between gap-3.5 no-underline text-left cursor-pointer'
        },
        el(
          'div',
          { className: 'flex items-start gap-3.5' },
          el(
            'span',
            {
              className: 'w-10 h-10 rounded-[11px] flex items-center justify-center shrink-0 mt-0.5',
              style: { backgroundColor: style.bg, color: style.fg }
            },
            getToolIcon(card.slug, 19)
          ),
          el(
            'div',
            { className: 'space-y-1 min-w-0 flex-1' },
            el(
              'div',
              { className: 'flex items-center justify-between gap-2' },
              el(
                'h3',
                { className: 'text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-[#1d1d1f]' },
                copy.title
              ),
              el(
                'span',
                { className: 'text-[11px] font-medium text-[#86868b] shrink-0' },
                copy.categoryLabel
              )
            ),
            el(
              'p',
              { className: 'text-[13px] leading-[1.45] text-[#6e6e73]' },
              copy.summary
            )
          )
        ),
        buildToolSnippet(card.slug)
      );
    })
  );

  const searchInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'toolkit-search-input',
      type: 'search',
      placeholder: 'Search tools',
      'aria-label': 'Search all tools',
      className: 'input-clay !h-9 !rounded-full !pl-4 !pr-12 text-[13px] w-full sm:!w-64'
    })
  );

  const searchWrapper = el(
    'div',
    { className: 'relative flex items-center shrink-0' },
    searchInput,
    el(
      'kbd',
      {
        className:
          'pointer-events-none absolute right-3 text-[11px] font-semibold text-[#86868b] font-sans'
      },
      '⌘K'
    )
  );

  const groupTabButtons = el('div', {
    className: 'ios-segmented',
    role: 'tablist',
    'aria-label': 'Filter tools by category'
  });

  const applyToolkitFilters = () => {
    const q = searchInput.value.trim().toLowerCase();
    const filteringByQueryOrGroup = q.length > 0 || activeToolkitGroup !== 'all';
    // Keep all 4 hero cards visible when idle; if user searches, filter across all 22 in the grid cleanly
    featuredSection.style.display = q.length > 0 ? 'none' : '';

    for (const node of cardsGrid.children) {
      const card = /** @type {HTMLElement} */ (node);
      const hay = card.dataset.toolSearch || '';
      const grp = card.dataset.toolGroup || '';
      const isHero = card.dataset.isFeaturedHero === 'true';
      const matchesGroup = activeToolkitGroup === 'all' || grp === activeToolkitGroup;
      const matchesQuery = !q || hay.includes(q);
      // In default "All Tools" view without search, render the remaining 18 tools cleanly to avoid repeating hero cards
      const hideDuplicateHero = !filteringByQueryOrGroup && isHero;
      card.style.display = !hideDuplicateHero && matchesGroup && matchesQuery ? '' : 'none';
    }

    for (const btn of groupTabButtons.children) {
      const b = /** @type {HTMLButtonElement} */ (btn);
      const isAct = b.dataset.groupId === activeToolkitGroup;
      b.className = `ios-segmented-tab ${isAct ? 'is-active' : ''}`;
      b.setAttribute('aria-selected', String(isAct));
    }
  };

  for (const g of GROUP_TABS) {
    const isAct = g.id === activeToolkitGroup;
    groupTabButtons.append(
      el(
        'button',
        {
          type: 'button',
          role: 'tab',
          dataset: { groupId: g.id },
          'aria-selected': String(isAct),
          className: `ios-segmented-tab ${isAct ? 'is-active' : ''}`,
          onClick: () => {
            activeToolkitGroup = g.id;
            applyToolkitFilters();
          }
        },
        g.label
      )
    );
  }

  searchInput.addEventListener('input', applyToolkitFilters);
  applyToolkitFilters();

  const mainEl = el(
    'main',
    { className: 'max-w-[1120px] mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-10 space-y-9' },
    el('section', { 'aria-label': 'Immediate file dropzone' }, dropzone),
    featuredSection,
    el(
      'section',
      { id: 'tools', className: 'space-y-4' },
      el(
        'div',
        { className: 'flex flex-col md:flex-row md:items-center justify-between gap-3' },
        groupTabButtons,
        searchWrapper
      ),
      cardsGrid
    )
  );

  mount(container, mainEl);
  return bindFileDropzone(dropzone);
}
