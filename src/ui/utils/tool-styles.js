/**
 * Pure presentation mapping from tool slug / activeTool ID to refined iOS squircle icon swatches,
 * short category micro-labels, and optional keyboard hints using strictly DESIGN.md tokens.
 */

export const IOS_SWATCHES = {
  blue: { bg: '#e8f2ff', fg: '#007aff' },
  purple: { bg: '#f3ebff', fg: '#af52de' },
  orange: { bg: '#fff1e5', fg: '#ff9500' },
  green: { bg: '#e8f8ed', fg: '#34c759' },
  pink: { bg: '#ffeaf0', fg: '#ff2d55' },
  teal: { bg: '#e6f7fa', fg: '#00a3bf' }
};

/** @type {Record<string, { bg: string, fg: string, category: string, hint?: string }>} */
const TOOL_STYLE_BY_SLUG = {
  'merge-pdf': { ...IOS_SWATCHES.blue, category: 'Pages', hint: '⌘M' },
  'split-pdf': { ...IOS_SWATCHES.teal, category: 'Pages' },
  'organize-pdf': { ...IOS_SWATCHES.pink, category: 'Pages', hint: '⌘O' },
  'resize-pdf': { ...IOS_SWATCHES.orange, category: 'Pages' },
  'nup-booklet': { ...IOS_SWATCHES.purple, category: 'Pages' },
  'split-spreads': { ...IOS_SWATCHES.teal, category: 'Pages' },
  'watermark-pdf': { ...IOS_SWATCHES.purple, category: 'Edit' },
  'page-numbers': { ...IOS_SWATCHES.orange, category: 'Edit' },
  'sign-annotate': { ...IOS_SWATCHES.pink, category: 'Edit', hint: '⌘E' },
  'redact-pdf': { ...IOS_SWATCHES.pink, category: 'Privacy' },
  'color-filters': { ...IOS_SWATCHES.green, category: 'Edit' },
  'compare-pdf': { ...IOS_SWATCHES.blue, category: 'Inspect' },
  'images-to-pdf': { ...IOS_SWATCHES.orange, category: 'Convert' },
  'pdf-to-images': { ...IOS_SWATCHES.teal, category: 'Convert' },
  'cbz-pdf': { ...IOS_SWATCHES.purple, category: 'Convert' },
  'extract-text': { ...IOS_SWATCHES.green, category: 'Extract' },
  'extract-images': { ...IOS_SWATCHES.orange, category: 'Extract' },
  'pdf-to-markdown': { ...IOS_SWATCHES.purple, category: 'Convert' },
  'pdf-to-docx': { ...IOS_SWATCHES.blue, category: 'Convert' },
  'pdf-to-xlsx': { ...IOS_SWATCHES.green, category: 'Convert' },
  'pdf-to-pptx': { ...IOS_SWATCHES.orange, category: 'Convert' },
  'docx-to-pdf': { ...IOS_SWATCHES.blue, category: 'Convert' },
  'xlsx-to-pdf': { ...IOS_SWATCHES.green, category: 'Convert' },
  'pptx-to-pdf': { ...IOS_SWATCHES.orange, category: 'Convert' },
  'optimize-pdf': { ...IOS_SWATCHES.green, category: 'Output' },
  'metadata-scrubber': { ...IOS_SWATCHES.teal, category: 'Privacy' },
  'flatten-pdf': { ...IOS_SWATCHES.blue, category: 'Inspect' },
  'pdf-attachments': { ...IOS_SWATCHES.purple, category: 'Inspect' },
  'bookmark-editor': { ...IOS_SWATCHES.orange, category: 'Inspect' }
};

/** @type {Record<string, { bg: string, fg: string, category: string, slug: string }>} */
const TOOL_STYLE_BY_TAB_ID = {
  organize: { ...IOS_SWATCHES.pink, category: 'Pages', slug: 'organize-pdf' },
  split: { ...IOS_SWATCHES.teal, category: 'Pages', slug: 'split-pdf' },
  watermark: { ...IOS_SWATCHES.purple, category: 'Edit', slug: 'watermark-pdf' },
  numbering: { ...IOS_SWATCHES.orange, category: 'Edit', slug: 'page-numbers' },
  convert: { ...IOS_SWATCHES.blue, category: 'Convert', slug: 'images-to-pdf' },
  resize: { ...IOS_SWATCHES.orange, category: 'Pages', slug: 'resize-pdf' },
  nup: { ...IOS_SWATCHES.purple, category: 'Pages', slug: 'nup-booklet' },
  spreads: { ...IOS_SWATCHES.teal, category: 'Pages', slug: 'split-spreads' },
  filters: { ...IOS_SWATCHES.green, category: 'Edit', slug: 'color-filters' },
  redact: { ...IOS_SWATCHES.pink, category: 'Privacy', slug: 'redact-pdf' },
  sign: { ...IOS_SWATCHES.pink, category: 'Edit', slug: 'sign-annotate' },
  compare: { ...IOS_SWATCHES.blue, category: 'Inspect', slug: 'compare-pdf' },
  'extract-text': { ...IOS_SWATCHES.green, category: 'Extract', slug: 'extract-text' },
  'extract-images': { ...IOS_SWATCHES.orange, category: 'Extract', slug: 'extract-images' },
  attachments: { ...IOS_SWATCHES.purple, category: 'Inspect', slug: 'pdf-attachments' },
  bookmarks: { ...IOS_SWATCHES.orange, category: 'Inspect', slug: 'bookmark-editor' },
  cbz: { ...IOS_SWATCHES.purple, category: 'Convert', slug: 'cbz-pdf' },
  metadata: { ...IOS_SWATCHES.teal, category: 'Privacy', slug: 'metadata-scrubber' },
  forms: { ...IOS_SWATCHES.blue, category: 'Inspect', slug: 'flatten-pdf' },
  optimize: { ...IOS_SWATCHES.green, category: 'Output', slug: 'optimize-pdf' },
  'pdf-to-markdown': { ...IOS_SWATCHES.purple, category: 'Convert', slug: 'pdf-to-markdown' },
  'pdf-to-docx': { ...IOS_SWATCHES.blue, category: 'Convert', slug: 'pdf-to-docx' },
  'pdf-to-xlsx': { ...IOS_SWATCHES.green, category: 'Convert', slug: 'pdf-to-xlsx' },
  'pdf-to-pptx': { ...IOS_SWATCHES.orange, category: 'Convert', slug: 'pdf-to-pptx' },
  'docx-to-pdf': { ...IOS_SWATCHES.blue, category: 'Convert', slug: 'docx-to-pdf' },
  'xlsx-to-pdf': { ...IOS_SWATCHES.green, category: 'Convert', slug: 'xlsx-to-pdf' },
  'pptx-to-pdf': { ...IOS_SWATCHES.orange, category: 'Convert', slug: 'pptx-to-pdf' }
};

/**
 * Returns refined iOS squircle colors & micro-category for a feature slug.
 * @param {string} slug
 */
export function getToolStyleBySlug(slug) {
  return TOOL_STYLE_BY_SLUG[slug] || { ...IOS_SWATCHES.blue, category: 'Studio' };
}

/**
 * Returns refined iOS squircle colors & slug for a workspace ToolTabId.
 * @param {string} toolId
 */
export function getToolStyleById(toolId) {
  return TOOL_STYLE_BY_TAB_ID[toolId] || { ...IOS_SWATCHES.blue, category: 'Studio', slug: 'organize-pdf' };
}
