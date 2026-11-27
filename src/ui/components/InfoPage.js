import {
  ABOUT_HIGHLIGHTS,
  DISCLAIMER_SECTIONS,
  HOW_IT_WORKS_STEPS,
  INFO_PAGES,
  PRIVACY_SECTIONS,
  TECH_STACK_ITEMS
} from '../../core/seo/info-pages.js';
import { el, mount, svgEl } from '../utils/dom.js';

const TONE_CLASSES = {
  blue: { bg: '#e8f2ff', fg: '#0071e3' },
  teal: { bg: '#e6f7fa', fg: '#00a3bf' },
  green: { bg: '#e8f8ed', fg: '#248a3d' },
  purple: { bg: '#f3ebff', fg: '#af52de' },
  orange: { bg: '#fff3e0', fg: '#f57c00' }
};

/**
 * Returns a simple crisp Apple-style vector glyph for an info page header badge.
 * @param {import('../../core/seo/info-pages.js').InfoPageSlug} slug
 */
function buildPageIcon(slug) {
  if (slug === 'privacy-policy') {
    return {
      style: TONE_CLASSES.green,
      icon: svgEl(
        'svg',
        {
          width: 21,
          height: 21,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true'
        },
        svgEl('path', { d: 'M12 2 4 5v6c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5l-8-3Z' }),
        svgEl('path', { d: 'm9 12 2 2 4-4' })
      )
    };
  }
  if (slug === 'disclaimer') {
    return {
      style: TONE_CLASSES.orange,
      icon: svgEl(
        'svg',
        {
          width: 21,
          height: 21,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true'
        },
        svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        svgEl('path', { d: 'M14 2v6h6' }),
        svgEl('path', { d: 'M12 12v4' }),
        svgEl('circle', { cx: 12, cy: 18, r: 0.75, fill: 'currentColor' })
      )
    };
  }
  return {
    style: TONE_CLASSES.blue,
    icon: svgEl(
      'svg',
      {
        width: 21,
        height: 21,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true'
      },
      svgEl('circle', { cx: 12, cy: 12, r: 9 }),
      svgEl('path', { d: 'M12 16v-4' }),
      svgEl('circle', { cx: 12, cy: 8, r: 0.75, fill: 'currentColor' })
    )
  };
}

/**
 * Renders structured legal/documentation sections (Disclaimer or Privacy Policy).
 * @param {{ title: string, paragraphs: string[], bullets?: string[] }[]} sections
 * @returns {HTMLElement}
 */
function buildDocumentSections(sections) {
  return el(
    'div',
    { className: 'space-y-4' },
    sections.map((section) =>
      el(
        'section',
        { className: 'clay-card p-5 sm:p-6 space-y-2.5' },
        el(
          'h2',
          { className: 'text-[16px] sm:text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f]' },
          section.title
        ),
        section.paragraphs.map((p) =>
          el('p', { className: 'text-[14px] leading-[1.6] text-[#424245]' }, p)
        ),
        section.bullets?.length
          ? el(
              'ul',
              { className: 'space-y-2 pt-1 list-none p-0 m-0' },
              section.bullets.map((b) =>
                el(
                  'li',
                  {
                    className:
                      'flex items-start gap-2.5 text-[13.5px] leading-[1.55] text-[#424245] bg-[#f5f5f7] border border-black/[0.04] rounded-[11px] px-3.5 py-2.5'
                  },
                  el('span', {
                    className: 'w-1.5 h-1.5 rounded-full bg-[#0071e3] mt-[7px] shrink-0',
                    'aria-hidden': 'true'
                  }),
                  el('span', { className: 'min-w-0' }, b)
                )
              )
            )
          : null
      )
    )
  );
}

/**
 * Renders the dedicated About Poffy view covering product story, architecture, how it works,
 * and underlying technologies.
 * @param {() => void} onOpenFilePicker
 * @returns {HTMLElement}
 */
function buildAboutContent(onOpenFilePicker) {
  return el(
    'div',
    { className: 'space-y-8' },
    // Key pillars grid
    el(
      'section',
      { 'aria-label': 'Core Poffy pillars', className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5' },
      ABOUT_HIGHLIGHTS.map((item) =>
        el(
          'div',
          { className: 'clay-card p-5 space-y-2' },
          el(
            'span',
            {
              className:
                'inline-flex px-2.5 py-0.5 rounded-full bg-[#e8f2ff] text-[#0071e3] text-[11px] font-semibold'
            },
            item.badge
          ),
          el('h2', { className: 'text-[15.5px] font-semibold text-[#1d1d1f]' }, item.title),
          el('p', { className: 'text-[13px] leading-[1.5] text-[#6e6e73]' }, item.description)
        )
      )
    ),

    // How It Works
    el(
      'section',
      { className: 'clay-card p-6 sm:p-7 space-y-5' },
      el(
        'div',
        { className: 'space-y-1' },
        el(
          'h2',
          { className: 'text-[19px] font-semibold tracking-[-0.015em] text-[#1d1d1f]' },
          'How Poffy Works'
        ),
        el(
          'p',
          { className: 'text-[14px] text-[#6e6e73]' },
          'From opening a file to saving the finished PDF, every step executes inside your browser.'
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-1 md:grid-cols-2 gap-3.5' },
        HOW_IT_WORKS_STEPS.map((s) =>
          el(
            'div',
            {
              className:
                'rounded-[14px] bg-[#f5f5f7] border border-black/[0.04] p-4 space-y-1.5'
            },
            el(
              'div',
              { className: 'flex items-center gap-2' },
              el(
                'span',
                {
                  className:
                    'px-2 py-0.5 rounded-full bg-white border border-black/[0.06] text-[11px] font-semibold text-[#0071e3]'
                },
                `Step ${s.step}`
              ),
              el('h3', { className: 'text-[14.5px] font-semibold text-[#1d1d1f]' }, s.title)
            ),
            el('p', { className: 'text-[13px] leading-[1.55] text-[#424245]' }, s.detail)
          )
        )
      )
    ),

    // Tech Behind Poffy
    el(
      'section',
      { className: 'space-y-4' },
      el(
        'div',
        { className: 'space-y-1' },
        el(
          'h2',
          { className: 'text-[19px] font-semibold tracking-[-0.015em] text-[#1d1d1f]' },
          'The Technology Behind Poffy'
        ),
        el(
          'p',
          { className: 'text-[14px] text-[#6e6e73]' },
          'Modern browser primitives combined with battle-tested open-source PDF engines.'
        )
      ),
      el(
        'div',
        { className: 'grid grid-cols-1 md:grid-cols-2 gap-3.5' },
        TECH_STACK_ITEMS.map((tech, idx) => {
          const tone = TONE_CLASSES[tech.tone] || TONE_CLASSES.blue;
          return el(
            'div',
            {
              className: `clay-card p-5 space-y-2 ${idx === TECH_STACK_ITEMS.length - 1 ? 'md:col-span-2' : ''}`
            },
            el(
              'div',
              { className: 'flex flex-wrap items-center justify-between gap-2' },
              el('h3', { className: 'text-[15.5px] font-semibold text-[#1d1d1f]' }, tech.name),
              el(
                'span',
                {
                  className: 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold',
                  style: { backgroundColor: tone.bg, color: tone.fg }
                },
                tech.role
              )
            ),
            el('p', { className: 'text-[13.5px] leading-[1.55] text-[#424245]' }, tech.detail)
          );
        })
      )
    ),

    // Ready CTA bar
    el(
      'section',
      {
        className:
          'clay-card p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#f5f5f7]'
      },
      el(
        'div',
        { className: 'space-y-1' },
        el('h2', { className: 'text-[16px] font-semibold text-[#1d1d1f]' }, 'Try Poffy Right Now'),
        el(
          'p',
          { className: 'text-[13.5px] text-[#6e6e73]' },
          'Open any PDF, image, or CBZ file locally, or jump back to browse all 22 tools.'
        )
      ),
      el(
        'div',
        { className: 'flex flex-wrap items-center gap-2.5 shrink-0' },
        el(
          'button',
          {
            type: 'button',
            className: 'btn-primary whitespace-nowrap',
            onClick: onOpenFilePicker
          },
          '+ Open PDF'
        ),
        el(
          'a',
          { href: '/', className: 'btn-secondary whitespace-nowrap no-underline' },
          'Explore All 22 Tools'
        )
      )
    )
  );
}

/**
 * Renders an informational page (`/about/`, `/disclaimer/`, or `/privacy-policy/`)
 * inside the workspace container using strictly safe DOM APIs.
 * @param {HTMLElement} container
 * @param {import('../../core/seo/info-pages.js').InfoPageMeta} page
 * @param {() => void} onOpenFilePicker
 */
export function renderInfoPage(container, page, onOpenFilePicker) {
  const { style, icon } = buildPageIcon(page.slug);

  let bodyNode;
  if (page.slug === 'about') {
    bodyNode = buildAboutContent(onOpenFilePicker);
  } else if (page.slug === 'disclaimer') {
    bodyNode = buildDocumentSections(DISCLAIMER_SECTIONS);
  } else {
    bodyNode = buildDocumentSections(PRIVACY_SECTIONS);
  }

  const pageMain = el(
    'main',
    { className: 'max-w-[920px] mx-auto px-4 sm:px-6 pt-8 pb-14 space-y-7' },
    el(
      'header',
      { className: 'text-center space-y-3.5' },
      el(
        'div',
        { className: 'flex flex-wrap items-center justify-center gap-2' },
        el(
          'a',
          {
            href: '/',
            className:
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e8e8ed]/85 hover:bg-[#e8e8ed] text-[12.5px] font-medium text-[#424245] no-underline transition-colors'
          },
          '← All Tools'
        ),
        INFO_PAGES.map((navPage) => {
          const isActive = navPage.slug === page.slug;
          return el(
            'a',
            {
              href: navPage.path,
              'aria-current': isActive ? 'page' : undefined,
              className: `inline-flex items-center px-3 py-1 rounded-full text-[12.5px] font-medium no-underline transition-colors ${
                isActive
                  ? 'bg-[#0071e3] text-white font-semibold'
                  : 'bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#424245] border border-black/[0.05]'
              }`
            },
            navPage.navLabel
          );
        })
      ),
      el(
        'div',
        { className: 'flex items-center justify-center pt-1' },
        el(
          'span',
          {
            className: 'w-11 h-11 rounded-[12px] flex items-center justify-center',
            style: { backgroundColor: style.bg, color: style.fg }
          },
          icon
        )
      ),
      el('h1', { className: 'type-display-sm text-[#1d1d1f]' }, page.headline),
      el(
        'p',
        { className: 'text-[15px] leading-[1.5] text-[#6e6e73] max-w-[60ch] mx-auto' },
        page.subheadline
      )
    ),
    bodyNode
  );

  mount(container, pageMain);
}
