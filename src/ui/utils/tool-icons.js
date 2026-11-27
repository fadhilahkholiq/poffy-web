import { svgEl } from './dom.js';

/**
 * Returns a clean, zero-dependency inline SVG icon for each Poffy feature slug.
 * Uses only `svgEl()` primitives for strict offline CSP compliance.
 * @param {string} slug
 * @param {number} [size=18]
 * @returns {SVGElement}
 */
export function getToolIcon(slug, size = 18) {
  const base = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  };

  switch (slug) {
    case 'merge-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 3, width: 8, height: 10, rx: 2 }),
        svgEl('rect', { x: 13, y: 3, width: 8, height: 10, rx: 2 }),
        svgEl('path', { d: 'M7 13v2a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-2' }),
        svgEl('path', { d: 'M12 18v3' })
      );
    case 'split-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('circle', { cx: 6, cy: 6, r: 3 }),
        svgEl('circle', { cx: 6, cy: 18, r: 3 }),
        svgEl('path', { d: 'M20 4 8.12 15.88' }),
        svgEl('path', { d: 'M14.47 14.48 20 20' }),
        svgEl('path', { d: 'M8.12 8.12 12 12' })
      );
    case 'organize-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }),
        svgEl('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }),
        svgEl('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }),
        svgEl('path', { d: 'M14 17.5h7' }),
        svgEl('path', { d: 'M17.5 14v7' })
      );
    case 'watermark-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M12 2.5 19.5 10a5.3 5.3 0 0 1-7.5 7.5A5.3 5.3 0 0 1 4.5 10L12 2.5Z' }),
        svgEl('path', { d: 'M9 14c1 1 2.5 1 3.5 0' })
      );
    case 'page-numbers':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M4 9h16' }),
        svgEl('path', { d: 'M4 15h16' }),
        svgEl('path', { d: 'M10 3 8 21' }),
        svgEl('path', { d: 'M16 3 14 21' })
      );
    case 'images-to-pdf':
    case 'pdf-to-images':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }),
        svgEl('circle', { cx: 8.5, cy: 9.5, r: 1.5 }),
        svgEl('path', { d: 'm21 15-4.5-4.5a1.5 1.5 0 0 0-2.1 0L6 19' })
      );
    case 'metadata-scrubber':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M12 2 4 5v6c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5l-8-3Z' }),
        svgEl('path', { d: 'm9 12 2 2 4-4' })
      );
    case 'flatten-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M12 3 3 8l9 5 9-5-9-5Z' }),
        svgEl('path', { d: 'm3 12 9 5 9-5' }),
        svgEl('path', { d: 'm3 16 9 5 9-5' })
      );
    case 'optimize-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M4 14h6v6' }),
        svgEl('path', { d: 'm3 21 7-7' }),
        svgEl('path', { d: 'M20 10h-6V4' }),
        svgEl('path', { d: 'm21 3-7 7' })
      );
    case 'resize-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M15 3h6v6' }),
        svgEl('path', { d: 'M9 21H3v-6' }),
        svgEl('path', { d: 'm21 3-7 7' }),
        svgEl('path', { d: 'm3 21 7-7' })
      );
    case 'nup-booklet':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M2 5.5A2.5 2.5 0 0 1 4.5 3H12v18H4.5A2.5 2.5 0 0 1 2 18.5Z' }),
        svgEl('path', { d: 'M22 5.5A2.5 2.5 0 0 0 19.5 3H12v18h7.5a2.5 2.5 0 0 0 2.5-2.5Z' })
      );
    case 'split-spreads':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        svgEl('path', { d: 'M12 2v20' }),
        svgEl('path', { d: 'M8 12H5' }),
        svgEl('path', { d: 'M19 12h-3' })
      );
    case 'color-filters':
      return svgEl(
        'svg',
        base,
        svgEl('circle', { cx: 12, cy: 12, r: 8.5 }),
        svgEl('path', { d: 'M12 3.5v17' }),
        svgEl('path', { d: 'M12 7.5h7.2' }),
        svgEl('path', { d: 'M12 12h8.5' }),
        svgEl('path', { d: 'M12 16.5h7.2' })
      );
    case 'redact-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
        svgEl('rect', { x: 6.5, y: 9, width: 11, height: 2.5, fill: 'currentColor', stroke: 'none' }),
        svgEl('rect', { x: 6.5, y: 13.5, width: 7, height: 2.5, fill: 'currentColor', stroke: 'none' })
      );
    case 'sign-annotate':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M17 3a2.8 2.8 0 0 1 4 4L8.5 19.5 3 21l1.5-5.5L17 3Z' }),
        svgEl('path', { d: 'M13.5 6.5 17.5 10.5' })
      );
    case 'compare-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 8, height: 16, rx: 1.5 }),
        svgEl('rect', { x: 13, y: 4, width: 8, height: 16, rx: 1.5 }),
        svgEl('path', { d: 'M6 9h2' }),
        svgEl('path', { d: 'M16 14h2' })
      );
    case 'extract-text':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }),
        svgEl('path', { d: 'M14 2v6h6' }),
        svgEl('path', { d: 'M8 13h8' }),
        svgEl('path', { d: 'M8 17h5' })
      );
    case 'extract-images':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2.5 }),
        svgEl('circle', { cx: 8.5, cy: 8.5, r: 1.5 }),
        svgEl('path', { d: 'm21 15-4.5-4.5L9 18' }),
        svgEl('path', { d: 'M12 18v-5' })
      );
    case 'pdf-attachments':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'm21.44 11.05-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.48a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.48a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78' })
      );
    case 'bookmark-editor':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z' })
      );
    case 'cbz-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        svgEl('path', { d: 'M9 4v16' }),
        svgEl('path', { d: 'M13 9h5' }),
        svgEl('path', { d: 'M13 13h4' })
      );
    case 'pdf-to-markdown':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }),
        svgEl('path', { d: 'M7 15V9l2.5 3L12 9v6' }),
        svgEl('path', { d: 'M16.5 9v6' }),
        svgEl('path', { d: 'm14.5 13 2 2 2-2' })
      );
    case 'pdf-to-docx':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }),
        svgEl('path', { d: 'M14 2v6h6' }),
        svgEl('path', { d: 'M8 13h8' }),
        svgEl('path', { d: 'M8 17h6' })
      );
    case 'pdf-to-xlsx':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        svgEl('path', { d: 'M3 10h18' }),
        svgEl('path', { d: 'M3 15h18' }),
        svgEl('path', { d: 'M10 4v16' })
      );
    case 'pdf-to-pptx':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
        svgEl('path', { d: 'M12 17v4' }),
        svgEl('path', { d: 'M8 21h8' }),
        svgEl('path', { d: 'M7.5 10h4.5' }),
        svgEl('path', { d: 'M7.5 13h3' })
      );
    case 'docx-to-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }),
        svgEl('path', { d: 'M14 2v6h6' }),
        svgEl('path', { d: 'M8 13l1.5 4 1.5-3 1.5 3L14 13' })
      );
    case 'xlsx-to-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
        svgEl('path', { d: 'M3 10h18' }),
        svgEl('path', { d: 'M9.5 10v10' }),
        svgEl('path', { d: 'm13 13 4 4' }),
        svgEl('path', { d: 'm17 13-4 4' })
      );
    case 'pptx-to-pdf':
      return svgEl(
        'svg',
        base,
        svgEl('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
        svgEl('path', { d: 'M12 17v4' }),
        svgEl('path', { d: 'M8 21h8' }),
        svgEl('path', { d: 'm10 8.5 5 2.5-5 2.5v-5Z' })
      );
    default:
      return svgEl(
        'svg',
        base,
        svgEl('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z' }),
        svgEl('path', { d: 'M14 2v6h6' })
      );
  }
}
