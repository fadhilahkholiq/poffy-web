import { FEATURE_PAGES } from '../../core/seo/features.js';
import { workspace } from '../../state/workspace.js';
import { bindFileDropzone } from '../interactions/file-ingestion.js';
import { el, mount, svgEl } from '../utils/dom.js';

/**
 * Builds the shared interactive drag-and-drop upload card.
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
        'clay-dropzone p-8 sm:p-12 flex flex-col items-center justify-center text-center min-h-[300px] cursor-pointer',
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
    el(
      'div',
      {
        className:
          'w-16 h-16 rounded-[18px] bg-[#fffaf0] border border-[#e5e5e5] flex items-center justify-center mb-5 shadow-sm'
      },
      uploadIcon
    ),
    el('p', { className: 'type-title-md text-[#0a0a0a] mb-2' }, 'Drop PDFs or images anywhere here'),
    el(
      'p',
      { className: 'type-body-sm text-[#6a6a6a] max-w-[34ch] mb-5' },
      hintText ||
        'Supports multi-PDF merge, PNG, JPG, and WebP. No file size limits enforced by a server.'
    ),
    el(
      'span',
      { className: 'badge-pill bg-[#fffaf0] border border-[#e5e5e5]' },
      'Click to browse files'
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
                className: 'badge-pill font-semibold',
                style: { backgroundColor: activeFeature.accent, color: activeFeature.accentText }
              },
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
              { className: 'rounded-[20px] bg-[#faf5e8] border border-[#e5e5e5] p-6 space-y-2' },
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
                  'badge-pill bg-[#f5f0e0] border border-[#e5e5e5] no-underline hover:bg-[#ebe6d6]'
              },
              f.shortName
            )
          )
        )
      )
    );

    mount(container, featureMain);
    return bindFileDropzone(dropzone);
  }

  const main = el(
    'main',
    { className: 'max-w-[1360px] mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-12' },
    el(
      'section',
      { className: 'grid grid-cols-1 lg:grid-cols-12 gap-8 items-center' },
      el(
        'div',
        { className: 'lg:col-span-6 space-y-6' },
        el(
          'div',
          { className: 'badge-pill' },
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
          { className: 'text-[16px] leading-[1.55] text-[#3a3a3a] max-w-[52ch]' },
          'Poffy runs entirely inside client-side Web Workers and WebAssembly. Your sensitive contracts, receipts, and forms never leave your device—even with Wi-Fi turned off.'
        ),
        el(
          'div',
          { className: 'flex flex-wrap items-center gap-3 pt-1' },
          el(
            'button',
            {
              type: 'button',
              id: 'hero-pick-btn',
              className: 'btn-primary',
              onClick: onOpenFilePicker
            },
            'Choose PDF or Images'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'hero-blank-btn',
              className: 'btn-secondary',
              onClick: () => workspace.insertBlankPage('a4', 0)
            },
            'Start with Blank Page'
          )
        )
      ),
      el('div', { className: 'lg:col-span-6' }, dropzone)
    ),
    el(
      'section',
      { className: 'space-y-5' },
      (() => {
        const cardsGrid = el(
          'div',
          { className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4' },
          FEATURE_PAGES.map((card) =>
            el(
              'a',
              {
                href: card.path,
                dataset: {
                  toolSearch: `${card.shortName} ${card.badge} ${card.highlights.join(' ')} ${card.keywords}`.toLowerCase()
                },
                className:
                  'block no-underline text-left rounded-[24px] p-5 transition-transform duration-150 hover:-translate-y-0.5 cursor-pointer border border-black/5',
                style: { backgroundColor: card.accent, color: card.accentText }
              },
              el(
                'span',
                {
                  className:
                    'inline-block text-[11px] uppercase tracking-[1.4px] font-semibold px-2.5 py-1 rounded-full mb-3',
                  style: { backgroundColor: 'rgba(255,255,255,0.22)', color: card.accentText }
                },
                card.shortName
              ),
              el(
                'h3',
                { className: 'type-title-sm mb-1.5', style: { color: card.accentText } },
                card.badge
              ),
              el(
                'p',
                { className: 'text-[13px] leading-[1.45] opacity-90', style: { color: card.accentText } },
                card.highlights[0]
              )
            )
          )
        );

        const searchInput = /** @type {HTMLInputElement} */ (
          el('input', {
            id: 'toolkit-search-input',
            type: 'search',
            placeholder: `Search all ${FEATURE_PAGES.length} offline tools`,
            className: 'input-clay !h-10 sm:!w-64',
            onInput: (e) => {
              const q = /** @type {HTMLInputElement} */ (e.target).value.trim().toLowerCase();
              for (const node of cardsGrid.children) {
                const hay = /** @type {HTMLElement} */ (node).dataset.toolSearch || '';
                /** @type {HTMLElement} */ (node).style.display = !q || hay.includes(q) ? '' : 'none';
              }
            }
          })
        );

        return el(
          'div',
          { className: 'space-y-5' },
          el(
            'div',
            { className: 'flex flex-col sm:flex-row sm:items-end justify-between gap-4' },
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
          cardsGrid
        );
      })()
    )
  );

  mount(container, main);
  return bindFileDropzone(dropzone);
}
