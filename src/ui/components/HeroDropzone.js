import { FEATURE_PAGES } from '../../core/seo/features.js';
import { workspace } from '../../state/workspace.js';
import { bindFileDropzone } from '../interactions/file-ingestion.js';
import { el, mount, svgEl } from '../utils/dom.js';
import { getToolIcon } from '../utils/tool-icons.js';

const FEATURED_SLUGS = new Set([
  'merge-pdf',
  'redact-pdf',
  'sign-annotate',
  'compare-pdf',
  'extract-text',
  'optimize-pdf'
]);

const TOOLKIT_GROUP_BY_SLUG = {
  'merge-pdf': 'pages',
  'split-pdf': 'pages',
  'organize-pdf': 'pages',
  'resize-pdf': 'pages',
  'nup-booklet': 'pages',
  'split-spreads': 'pages',
  'watermark-pdf': 'edit',
  'page-numbers': 'edit',
  'sign-annotate': 'edit',
  'redact-pdf': 'edit',
  'color-filters': 'edit',
  'compare-pdf': 'edit',
  'images-to-pdf': 'convert',
  'pdf-to-images': 'convert',
  'cbz-pdf': 'convert',
  'extract-text': 'convert',
  'extract-images': 'convert',
  'optimize-pdf': 'inspect',
  'metadata-scrubber': 'inspect',
  'flatten-pdf': 'inspect',
  'pdf-attachments': 'inspect',
  'bookmark-editor': 'inspect'
};

/**
 * Builds the shared interactive drag-and-drop upload stage with layered Clay paper accents.
 * @param {() => void} onOpenFilePicker
 * @param {string} [hintText]
 * @returns {HTMLElement}
 */
function buildDropzoneBox(onOpenFilePicker, hintText) {
  const uploadIcon = svgEl(
    'svg',
    {
      width: 28,
      height: 28,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: '#0a0a0a',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    },
    svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
    svgEl('polyline', { points: '14 2 14 8 20 8' }),
    svgEl('path', { d: 'M12 18v-6' }),
    svgEl('path', { d: 'm9 15 3-3 3 3' })
  );

  return el(
    'div',
    {
      id: 'hero-dropzone',
      className:
        'clay-dropzone pt-14 pb-7 px-5 sm:p-11 flex flex-col items-center justify-center text-center min-h-[268px] sm:min-h-[340px] cursor-pointer',
      role: 'button',
      tabindex: '0',
      'aria-label': 'Drop PDF or image files here to begin',
      onClick: onOpenFilePicker,
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenFilePicker();
        }
      }
    },
    // Decorative floating Clay paper tokens
    el(
      'div',
      {
        className:
          'pointer-events-none flex items-center gap-1.5 absolute top-3.5 left-3.5 sm:top-5 sm:left-5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[10px] sm:rounded-[12px] bg-[#ff4d8b] text-white text-[10px] sm:text-[11px] font-semibold shadow-sm -rotate-3 border border-black/10',
        'aria-hidden': 'true'
      },
      getToolIcon('sign-annotate', 12),
      el('span', {}, 'Vector Sign')
    ),
    el(
      'div',
      {
        className:
          'pointer-events-none flex items-center gap-1.5 absolute top-3.5 right-3.5 sm:top-5 sm:right-5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-[10px] sm:rounded-[12px] bg-[#a4d4c5] text-[#0a0a0a] text-[10px] sm:text-[11px] font-semibold shadow-sm rotate-3 border border-black/10',
        'aria-hidden': 'true'
      },
      getToolIcon('metadata-scrubber', 12),
      el('span', {}, 'XMP Scrub')
    ),
    el(
      'div',
      {
        className:
          'pointer-events-none hidden sm:flex items-center gap-1.5 absolute bottom-5 right-6 px-3 py-1.5 rounded-[12px] bg-[#b8a4ed] text-[#0a0a0a] text-[11px] font-semibold shadow-sm -rotate-2 border border-black/10',
        'aria-hidden': 'true'
      },
      getToolIcon('nup-booklet', 13),
      el('span', {}, 'N-Up & Booklet')
    ),
    el(
      'div',
      {
        className:
          'pointer-events-none hidden sm:flex items-center gap-1.5 absolute bottom-5 left-6 px-3 py-1.5 rounded-[12px] bg-[#ffb084] text-[#0a0a0a] text-[11px] font-semibold shadow-sm rotate-2 border border-black/10',
        'aria-hidden': 'true'
      },
      getToolIcon('redact-pdf', 13),
      el('span', {}, 'True Redact')
    ),
    // Layered paper stack icon center
    el(
      'div',
      { className: 'relative mb-5 mt-2', 'aria-hidden': 'true' },
      el('div', {
        className:
          'w-16 h-16 rounded-[18px] bg-[#f5f0e0] border border-[#e5e5e5] absolute inset-0 translate-x-2 -translate-y-1.5 rotate-6'
      }),
      el(
        'div',
        {
          className:
            'relative w-16 h-16 rounded-[18px] bg-[#fffaf0] border border-[#0a0a0a]/15 flex items-center justify-center shadow-sm'
        },
        uploadIcon
      )
    ),
    el('p', { className: 'type-title-md text-[#0a0a0a] mb-2 relative' }, 'Drop PDFs or images anywhere here'),
    el(
      'p',
      { className: 'type-body-sm text-[#6a6a6a] max-w-[34ch] mb-5 relative' },
      hintText ||
        'Supports multi-PDF merge, PNG, JPG, and WebP. No file size limits enforced by a server.'
    ),
    el(
      'div',
      { className: 'flex flex-wrap items-center justify-center gap-1.5 relative' },
      el(
        'span',
        { className: 'badge-pill !bg-[#0a0a0a] !text-white font-semibold' },
        'Click to browse files'
      ),
      ...['PDF', 'PNG', 'JPG', 'WebP'].map((fmt) =>
        el(
          'span',
          { className: 'badge-pill !bg-[#fffaf0] border border-[#e5e5e5] text-[11px]' },
          fmt
        )
      )
    )
  );
}

/**
 * Renders either the main Poffy Hero (on `/`) or a dedicated SEO Feature Landing Hero (on `/<slug>/`).
 * @param {HTMLElement} container
 * @param {() => void} onOpenFilePicker
 * @param {import('../../core/seo/features.js').FeaturePageMeta|null} [activeFeature=null]
 * @returns {() => void} Cleanup callback
 */
export function renderHeroDropzone(container, onOpenFilePicker, activeFeature = null) {
  const dropzone = buildDropzoneBox(
    onOpenFilePicker,
    activeFeature
      ? `Drop your files to launch ${activeFeature.shortName} immediately in browser memory.`
      : undefined
  );

  if (activeFeature) {
    const otherFeatures = FEATURE_PAGES.filter((f) => f.slug !== activeFeature.slug);

    const featureMain = el(
      'main',
      { className: 'max-w-[1360px] mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-12' },
      el(
        'section',
        { className: 'grid grid-cols-1 lg:grid-cols-12 gap-8 items-center' },
        el(
          'div',
          { className: 'lg:col-span-6 space-y-5' },
          el(
            'div',
            { className: 'flex flex-wrap items-center gap-2' },
            el(
              'a',
              {
                href: '/',
                className:
                  'badge-pill bg-[#faf5e8] border border-[#e5e5e5] no-underline hover:bg-[#f5f0e0]'
              },
              '← All Tools'
            ),
            el(
              'span',
              {
                className: 'badge-pill font-semibold border border-black/10',
                style: { backgroundColor: activeFeature.accent, color: activeFeature.accentText }
              },
              getToolIcon(activeFeature.slug, 14),
              activeFeature.badge
            )
          ),
          el('h1', { className: 'type-display-lg text-[#0a0a0a]' }, activeFeature.headline),
          el(
            'p',
            { className: 'text-[16px] leading-[1.55] text-[#3a3a3a] max-w-[52ch]' },
            activeFeature.subheadline
          ),
          el(
            'ul',
            { className: 'space-y-2 pt-1 text-[14px] text-[#1a1a1a]' },
            activeFeature.highlights.map((item) =>
              el(
                'li',
                { className: 'flex items-start gap-2.5' },
                el('span', { className: 'w-2 h-2 rounded-full bg-[#22c55e] mt-2 shrink-0' }),
                el('span', {}, item)
              )
            )
          ),
          el(
            'div',
            { className: 'flex flex-wrap items-center gap-3 pt-2' },
            el(
              'button',
              {
                type: 'button',
                id: 'hero-pick-btn',
                className: 'btn-primary',
                onClick: onOpenFilePicker
              },
              activeFeature.ctaLabel
            ),
            activeFeature.tool === 'organize'
              ? el(
                  'button',
                  {
                    type: 'button',
                    id: 'hero-blank-btn',
                    className: 'btn-secondary',
                    onClick: () => workspace.insertBlankPage('a4', 0)
                  },
                  'Start with Blank Page'
                )
              : activeFeature.tool === 'compare'
                ? el(
                    'button',
                    {
                      type: 'button',
                      id: 'hero-compare-studio-btn',
                      className: 'btn-secondary',
                      onClick: () => {
                        workspace.tools.compare.modalOpen = true;
                        workspace.emit('tool');
                      }
                    },
                    'Open Dual Compare Studio'
                  )
                : activeFeature.tool === 'cbz'
                  ? el(
                      'button',
                      {
                        type: 'button',
                        id: 'hero-cbz-studio-btn',
                        className: 'btn-secondary',
                        onClick: () => {
                          workspace.tools.cbz.modalOpen = true;
                          workspace.emit('tool');
                        }
                      },
                      'Open CBZ ↔ PDF Converter'
                    )
                  : null
          )
        ),
        el('div', { className: 'lg:col-span-6' }, dropzone)
      ),
      el(
        'section',
        { className: 'space-y-4' },
        el('h2', { className: 'type-title-lg text-[#0a0a0a]' }, `${activeFeature.shortName} FAQ`),
        el(
          'div',
          { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
          activeFeature.faqs.map((faq) =>
            el(
              'article',
              { className: 'clay-card !bg-[#faf5e8] p-6 space-y-2' },
              el('h3', { className: 'type-title-sm text-[#0a0a0a]' }, faq.q),
              el('p', { className: 'type-body-sm' }, faq.a)
            )
          )
        )
      ),
      el(
        'section',
        { className: 'space-y-4' },
        el('h2', { className: 'type-title-md text-[#0a0a0a]' }, 'More Offline PDF Tools'),
        el(
          'div',
          { className: 'flex flex-wrap gap-2' },
          otherFeatures.map((f) =>
            el(
              'a',
              {
                href: f.path,
                className:
                  'badge-pill !bg-[#fffaf0] border border-[#e5e5e5] no-underline hover:!bg-[#f5f0e0] hover:border-[#0a0a0a] transition-colors'
              },
              el('span', {
                className: 'w-2 h-2 rounded-full border border-black/15 shrink-0',
                style: { backgroundColor: f.accent },
                'aria-hidden': 'true'
              }),
              f.shortName
            )
          )
        )
      )
    );

    mount(container, featureMain);
    return bindFileDropzone(dropzone);
  }

  let activeToolkitGroup = 'all';

  const GROUP_TABS = /** @type {const} */ ([
    { id: 'all', label: `All (${FEATURE_PAGES.length})` },
    { id: 'pages', label: 'Pages & Layout' },
    { id: 'edit', label: 'Edit & Privacy' },
    { id: 'convert', label: 'Convert & Extract' },
    { id: 'inspect', label: 'Inspect & Output' }
  ]);

  const arrowIcon = () =>
    svgEl(
      'svg',
      {
        width: 15,
        height: 15,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2.25,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        className: 'opacity-70 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
        'aria-hidden': 'true'
      },
      svgEl('path', { d: 'M7 17 17 7' }),
      svgEl('path', { d: 'M8 7h9v9' })
    );

  const cardsGrid = el(
    'div',
    { className: 'grid grid-cols-2 lg:grid-cols-4 grid-flow-dense gap-3 sm:gap-4' },
    FEATURE_PAGES.map((card) => {
      const isFeatured = FEATURED_SLUGS.has(card.slug);
      const isDarkText = card.accentText === '#0a0a0a';
      const iconBg = isDarkText ? 'rgba(255, 255, 255, 0.56)' : 'rgba(255, 255, 255, 0.18)';
      const pillBg = isDarkText ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.2)';
      const group = TOOLKIT_GROUP_BY_SLUG[card.slug] || 'inspect';

      return el(
        'a',
        {
          href: card.path,
          dataset: {
            toolGroup: group,
            toolSearch: `${card.shortName} ${card.badge} ${card.highlights.join(' ')} ${card.keywords}`.toLowerCase()
          },
          className: `clay-bento-card group flex flex-col justify-between no-underline text-left p-3.5 sm:p-5 cursor-pointer ${
            isFeatured ? 'col-span-2 min-h-[164px] sm:min-h-[196px]' : 'min-h-[154px] sm:min-h-[176px]'
          }`,
          style: { backgroundColor: card.accent, color: card.accentText }
        },
        el(
          'div',
          { className: 'space-y-2.5 sm:space-y-3' },
          el(
            'div',
            { className: 'flex items-center justify-between gap-2' },
            el(
              'div',
              { className: 'flex items-center gap-2 sm:gap-2.5 min-w-0' },
              el(
                'span',
                {
                  className: 'w-8 h-8 sm:w-9 sm:h-9 rounded-[10px] sm:rounded-[12px] flex items-center justify-center shrink-0 border border-black/10',
                  style: { backgroundColor: iconBg, color: card.accentText }
                },
                getToolIcon(card.slug, 16)
              ),
              isFeatured
                ? el(
                    'span',
                    {
                      className:
                        'inline-block text-[10px] sm:text-[11px] uppercase tracking-[1px] sm:tracking-[1.3px] font-semibold px-2.5 py-1 rounded-full',
                      style: { backgroundColor: pillBg, color: card.accentText }
                    },
                    card.shortName
                  )
                : null
            ),
            arrowIcon()
          ),
          !isFeatured
            ? el(
                'span',
                {
                  className:
                    'inline-block text-[10px] sm:text-[11px] uppercase tracking-[0.8px] sm:tracking-[1.2px] font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full max-w-full',
                  style: { backgroundColor: pillBg, color: card.accentText }
                },
                card.shortName
              )
            : null,
          el(
            'div',
            { className: 'space-y-1' },
            el(
              'h3',
              {
                className: isFeatured
                  ? 'text-[16px] sm:text-[18px] font-semibold leading-snug'
                  : 'text-[14px] sm:text-[16px] font-semibold leading-snug',
                style: { color: card.accentText }
              },
              card.badge
            ),
            el(
              'p',
              {
                className: `text-[12px] sm:text-[13px] leading-[1.4] sm:leading-[1.45] opacity-90 ${
                  isFeatured ? '' : 'line-clamp-3 sm:line-clamp-none'
                }`,
                style: { color: card.accentText }
              },
              card.highlights[0]
            )
          )
        ),
        isFeatured && card.highlights[1]
          ? el(
              'div',
              {
                className:
                  'mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t flex items-center justify-between gap-3 text-[11px] sm:text-[12px] leading-snug font-medium opacity-90',
                style: {
                  borderColor: isDarkText ? 'rgba(10, 10, 10, 0.12)' : 'rgba(255, 255, 255, 0.22)',
                  color: card.accentText
                }
              },
              el('span', { className: 'min-w-0' }, card.highlights[1]),
              el('span', { className: 'shrink-0 font-semibold' }, 'Open →')
            )
          : null
      );
    })
  );

  const searchInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'toolkit-search-input',
      type: 'search',
      placeholder: `Search all ${FEATURE_PAGES.length} offline tools`,
      className: 'input-clay !h-10 !rounded-full !px-4 sm:!w-64'
    })
  );

  const groupTabButtons = el('div', {
    className: 'flex flex-nowrap sm:flex-wrap items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar',
    role: 'tablist',
    'aria-label': 'Filter tools by category'
  });

  const applyToolkitFilters = () => {
    const q = searchInput.value.trim().toLowerCase();
    for (const node of cardsGrid.children) {
      const card = /** @type {HTMLElement} */ (node);
      const hay = card.dataset.toolSearch || '';
      const grp = card.dataset.toolGroup || '';
      const matchesGroup = activeToolkitGroup === 'all' || grp === activeToolkitGroup;
      const matchesQuery = !q || hay.includes(q);
      card.style.display = matchesGroup && matchesQuery ? '' : 'none';
    }
    for (const btn of groupTabButtons.children) {
      const b = /** @type {HTMLButtonElement} */ (btn);
      const isAct = b.dataset.groupId === activeToolkitGroup;
      b.className = `category-tab !py-1.5 !px-3.5 !text-[13px] ${isAct ? 'is-active border border-[#0a0a0a]/15' : ''}`;
      b.setAttribute('aria-selected', String(isAct));
    }
  };

  for (const g of GROUP_TABS) {
    groupTabButtons.append(
      el(
        'button',
        {
          type: 'button',
          role: 'tab',
          dataset: { groupId: g.id },
          'aria-selected': String(g.id === activeToolkitGroup),
          className: `category-tab !py-1.5 !px-3.5 !text-[13px] ${g.id === activeToolkitGroup ? 'is-active border border-[#0a0a0a]/15' : ''}`,
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

  const darkShowcase = el(
    'section',
    { className: 'clay-dark-showcase p-5 sm:p-10 !rounded-[22px] sm:!rounded-[28px] space-y-5 sm:space-y-7' },
    el(
      'div',
      { className: 'flex flex-col lg:flex-row lg:items-end justify-between gap-4' },
      el(
        'div',
        { className: 'space-y-2' },
        el(
          'span',
          { className: 'inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1a2a2a] border border-white/10 text-[11px] uppercase tracking-[1.3px] font-semibold text-[#a4d4c5]' },
          el('span', { className: 'w-2 h-2 rounded-full bg-[#22c55e]' }),
          'Offline Security Architecture'
        ),
        el(
          'h2',
          { className: 'type-display-sm text-white max-w-[26ch]' },
          'Built for sensitive documents. Verified offline.'
        )
      ),
      el(
        'p',
        { className: 'text-[14px] leading-[1.55] text-[#a0a0a0] max-w-[44ch]' },
        'Every byte stays in local browser RAM with zero external network calls, strict CSP isolation, and Workbox PWA precaching for airplane mode.'
      )
    ),
    el(
      'div',
      { className: 'grid grid-cols-1 md:grid-cols-3 gap-4' },
      ...[
        {
          accent: '#ff4d8b',
          slug: 'redact-pdf',
          title: 'Zero Network Egress',
          desc: 'All PDF parsing, rendering, and ZIP packaging execute inside Web Workers under strict connect-src self CSP.'
        },
        {
          accent: '#a4d4c5',
          slug: 'metadata-scrubber',
          title: 'True Scrub & Raster Burn',
          desc: 'Permanent raster-burn redactions destroy underlying text operators; privacy audits strip XMP streams, thumbnails, and JS.'
        },
        {
          accent: '#b8a4ed',
          slug: 'sign-annotate',
          title: 'CropBox & Rotation Exactness',
          desc: 'Shared coordinate geometry aligns e-signatures, spreads, N-Up imposition, and crops cleanly across 0/90/180/270° pages.'
        }
      ].map((pillar) =>
        el(
          'div',
          { className: 'clay-dark-tile p-5 space-y-3' },
          el(
            'div',
            {
              className: 'w-10 h-10 rounded-[12px] flex items-center justify-center text-[#0a0a0a]',
              style: { backgroundColor: pillar.accent }
            },
            getToolIcon(pillar.slug, 19)
          ),
          el('h3', { className: 'type-title-sm text-white' }, pillar.title),
          el('p', { className: 'text-[13px] leading-[1.5] text-[#a0a0a0]' }, pillar.desc)
        )
      )
    )
  );

  const main = el(
    'main',
    { className: 'max-w-[1360px] mx-auto px-4 sm:px-6 py-6 sm:py-14 space-y-10 sm:space-y-14' },
    el(
      'section',
      { className: 'grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-10 items-center' },
      el(
        'div',
        { className: 'lg:col-span-6 space-y-5 sm:space-y-6' },
        el(
          'div',
          { className: 'badge-pill border border-[#e5e5e5]' },
          el('span', { className: 'w-2 h-2 rounded-full bg-[#22c55e]' }),
          el('span', {}, 'Private • Runs 100% in Browser Memory')
        ),
        el(
          'h1',
          { className: 'type-display-lg text-[#0a0a0a]' },
          'Edit, merge, and scrub PDFs with zero uploads.'
        ),
        el(
          'p',
          { className: 'text-[15px] sm:text-[16px] leading-[1.55] text-[#3a3a3a] max-w-[52ch]' },
          'Poffy runs entirely inside client-side Web Workers and WebAssembly. Your sensitive contracts, receipts, and forms never leave your device—even with Wi-Fi turned off.'
        ),
        el(
          'div',
          { className: 'grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3 pt-1' },
          el(
            'button',
            {
              type: 'button',
              id: 'hero-pick-btn',
              className: 'btn-primary w-full sm:w-auto',
              onClick: onOpenFilePicker
            },
            'Choose PDF or Images'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'hero-blank-btn',
              className: 'btn-secondary w-full sm:w-auto',
              onClick: () => workspace.insertBlankPage('a4', 0)
            },
            'Start with Blank Page'
          )
        ),
        el(
          'div',
          { className: 'flex flex-wrap items-center gap-x-5 gap-y-2 pt-2 text-[13px] text-[#6a6a6a]' },
          el('span', { className: 'inline-flex items-center gap-2 font-medium text-[#1a1a1a]' }, el('span', { className: 'w-2 h-2 rounded-full bg-[#ff4d8b]' }), `${FEATURE_PAGES.length} Offline Tools`),
          el('span', { className: 'inline-flex items-center gap-2 font-medium text-[#1a1a1a]' }, el('span', { className: 'w-2 h-2 rounded-full bg-[#a4d4c5]' }), '0 KB Server Uploads'),
          el('span', { className: 'inline-flex items-center gap-2 font-medium text-[#1a1a1a]' }, el('span', { className: 'w-2 h-2 rounded-full bg-[#b8a4ed]' }), 'Works in Airplane Mode')
        )
      ),
      el('div', { className: 'lg:col-span-6' }, dropzone)
    ),
    el(
      'section',
      { className: 'space-y-6' },
      el(
        'div',
        { className: 'flex flex-col lg:flex-row lg:items-end justify-between gap-4' },
        el(
          'div',
          {},
          el('p', { className: 'type-caption-upper text-[#6a6a6a]' }, `Offline Studio Toolkit (${FEATURE_PAGES.length} Tools)`),
          el(
            'h2',
            { className: 'type-display-sm text-[#0a0a0a] mt-1' },
            'Dedicated tools, zero server roundtrips'
          )
        ),
        searchInput
      ),
      groupTabButtons,
      cardsGrid
    ),
    darkShowcase
  );

  mount(container, main);
  return bindFileDropzone(dropzone);
}
