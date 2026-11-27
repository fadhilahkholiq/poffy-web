/**
 * Human-friendly, benefit-driven studio copywriting and categorization for all 22 tools.
 * Zero internal technical jargon; fits cleanly on 2 lines without ellipsis truncation.
 *
 * @typedef {'pages'|'security'|'convert'|'inspect'} StudioCategory
 */

/** @type {Record<string, { title: string, summary: string, category: StudioCategory, categoryLabel: string }>} */
export const STUDIO_TOOL_COPY = {
  'merge-pdf': {
    title: 'Merge & Reorder',
    summary: 'Combine multiple PDFs or images into one file and arrange pages in any order.',
    category: 'pages',
    categoryLabel: 'Pages & Layout'
  },
  'split-pdf': {
    title: 'Split & Extract',
    summary: 'Extract specific page ranges or save every page as a separate PDF in one ZIP.',
    category: 'pages',
    categoryLabel: 'Pages & Layout'
  },
  'organize-pdf': {
    title: 'Rotate & Crop',
    summary: 'Fix upside-down scans, trim wide margins, or insert blank pages effortlessly.',
    category: 'pages',
    categoryLabel: 'Pages & Layout'
  },
  'resize-pdf': {
    title: 'Resize Pages',
    summary: 'Scale documents cleanly to A4, US Letter, or custom print sizes in seconds.',
    category: 'pages',
    categoryLabel: 'Pages & Layout'
  },
  'nup-booklet': {
    title: 'Booklet & N-Up',
    summary: 'Arrange multiple pages per sheet or lay out spreads for ready-to-fold booklets.',
    category: 'pages',
    categoryLabel: 'Pages & Layout'
  },
  'split-spreads': {
    title: 'Split Book Scans',
    summary: 'Slice two-page book spreads cleanly down the middle into single readable pages.',
    category: 'pages',
    categoryLabel: 'Pages & Layout'
  },
  'watermark-pdf': {
    title: 'Watermark & Privacy Scrub',
    summary: 'Stamp diagonal watermarks across pages and strip hidden author metadata cleanly.',
    category: 'security',
    categoryLabel: 'Security & Privacy'
  },
  'metadata-scrubber': {
    title: 'Privacy Scrubber',
    summary: 'Inspect and wipe hidden author names, edit history, and device metadata.',
    category: 'security',
    categoryLabel: 'Security & Privacy'
  },
  'redact-pdf': {
    title: 'True Redact',
    summary: 'Permanently black out sensitive names, numbers, and paragraphs before sharing.',
    category: 'security',
    categoryLabel: 'Security & Privacy'
  },
  'sign-annotate': {
    title: 'Sign & Annotate',
    summary: 'Draw or type your signature, highlight key lines, and add clean callouts.',
    category: 'security',
    categoryLabel: 'Security & Privacy'
  },
  'flatten-pdf': {
    title: 'Flatten Forms',
    summary: 'Fill out checkboxes and fields or lock completed forms so entries never shift.',
    category: 'security',
    categoryLabel: 'Security & Privacy'
  },
  'color-filters': {
    title: 'Dark Mode & Cleanup',
    summary: 'Convert to ink-saving grayscale, invert for night reading, or brighten scans.',
    category: 'security',
    categoryLabel: 'Security & Privacy'
  },
  'images-to-pdf': {
    title: 'Images to PDF',
    summary: 'Turn batches of JPG, PNG, or WebP photos into one clean, printable document.',
    category: 'convert',
    categoryLabel: 'Convert'
  },
  'pdf-to-images': {
    title: 'PDF to Images',
    summary: 'Save PDF pages as crisp PNG, JPG, or WebP pictures individually or zipped.',
    category: 'convert',
    categoryLabel: 'Convert'
  },
  'cbz-pdf': {
    title: 'CBZ ↔ PDF',
    summary: 'Convert comic archives into neat PDFs or package illustrated PDFs into CBZ.',
    category: 'convert',
    categoryLabel: 'Convert'
  },
  'extract-text': {
    title: 'Extract Text',
    summary: 'Pull clean readable text or structured notes straight out of any PDF file.',
    category: 'convert',
    categoryLabel: 'Convert'
  },
  'extract-images': {
    title: 'Extract Images',
    summary: 'Download every embedded photo and graphic from a PDF at original quality.',
    category: 'convert',
    categoryLabel: 'Convert'
  },
  'optimize-pdf': {
    title: 'Compress PDF',
    summary: 'Shrink heavy PDF file sizes for faster sharing while keeping text sharp.',
    category: 'inspect',
    categoryLabel: 'Inspect'
  },
  'page-numbers': {
    title: 'Page Numbers',
    summary: 'Add clean headers, footers, or consecutive numbering while skipping covers.',
    category: 'inspect',
    categoryLabel: 'Inspect'
  },
  'compare-pdf': {
    title: 'Compare Versions',
    summary: 'Spot added, removed, or edited text and visuals side by side between two drafts.',
    category: 'inspect',
    categoryLabel: 'Inspect'
  },
  'pdf-attachments': {
    title: 'Attachments',
    summary: 'View, extract, or bundle supporting spreadsheets and files inside a PDF.',
    category: 'inspect',
    categoryLabel: 'Inspect'
  },
  'bookmark-editor': {
    title: 'Bookmark Editor',
    summary: 'Create, nest, and reorder a clickable table of contents for long documents.',
    category: 'inspect',
    categoryLabel: 'Inspect'
  }
};

/**
 * Returns polished human copy for a feature slug.
 * @param {import('../../core/seo/features.js').FeaturePageMeta} feature
 */
export function getStudioCopy(feature) {
  return (
    STUDIO_TOOL_COPY[feature.slug] || {
      title: feature.badge,
      summary: feature.highlights?.[0] || feature.subheadline,
      category: 'inspect',
      categoryLabel: 'Inspect'
    }
  );
}
