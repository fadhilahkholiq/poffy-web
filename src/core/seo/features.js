/**
 * Single source of truth for all Poffy feature landing pages, SEO metadata,
 * structured data details, and default tool bindings.
 *
 * @typedef {Object} FeaturePageMeta
 * @property {string} slug - URL directory slug (e.g. 'merge-pdf')
 * @property {string} path - Canonical relative path (e.g. '/merge-pdf/')
 * @property {import('../../state/workspace.js').ToolTabId} tool - Default inspector tab
 * @property {string} shortName - Short nav/footer label
 * @property {string} badge - Category badge label
 * @property {string} title - SEO HTML <title>
 * @property {string} description - SEO meta description
 * @property {string} keywords - SEO meta keywords
 * @property {string} headline - Hero H1 headline
 * @property {string} subheadline - Hero subtitle
 * @property {string} ctaLabel - Primary CTA button label
 * @property {string} accent - DESIGN.md brand accent hex
 * @property {string} accentText - Contrasting text hex
 * @property {string[]} highlights - Key capabilities shown on the feature page
 * @property {{ q: string, a: string }[]} faqs - Feature-specific FAQs (rendered + FAQPage JSON-LD)
 */

/** @type {FeaturePageMeta[]} */
export const FEATURE_PAGES = [
  {
    slug: 'merge-pdf',
    path: '/merge-pdf/',
    tool: 'organize',
    shortName: 'Merge PDF',
    badge: 'Merge & Interleave',
    title: 'Merge PDF Offline — Combine & Interleave PDFs Locally | Poffy',
    description:
      'Combine multiple PDF files sequentially or interleave pages 100% offline in browser memory. Zero uploads, zero file limits, powered by pdf-lib Web Workers.',
    keywords:
      'merge pdf offline, combine pdf locally, interleave pdf pages, private pdf merger, no upload pdf merge',
    headline: 'Merge and interleave PDFs with zero uploads.',
    subheadline:
      'Drop multiple PDFs or images, drag pages into your exact order, or interleave front-and-back scans in one click—entirely inside your browser.',
    ctaLabel: 'Select PDFs to Merge',
    accent: '#ff4d8b',
    accentText: '#ffffff',
    highlights: [
      'Sequential multi-PDF merging & 1-by-1 page interleaving',
      'Mix PDFs with PNG, JPG, or WebP images seamlessly',
      'Zero server uploads — works offline in airplane mode'
    ],
    faqs: [
      {
        q: 'Are my merged PDFs uploaded to any server?',
        a: 'No. Poffy parses and merges your files inside a local Web Worker using pdf-lib. Nothing leaves your device.'
      },
      {
        q: 'Can I interleave odd and even scanned PDFs?',
        a: 'Yes. Upload both PDFs and click Interleave Pages in the Organize Studio to alternate pages automatically.'
      }
    ]
  },
  {
    slug: 'split-pdf',
    path: '/split-pdf/',
    tool: 'split',
    shortName: 'Split PDF',
    badge: 'Split & Burst ZIP',
    title: 'Split PDF Offline — Extract Ranges or Burst to ZIP | Poffy',
    description:
      'Split PDFs by custom page ranges (1-3, 5, 8-end), split every N pages, extract selected pages, or burst every page into a client-side ZIP archive offline.',
    keywords:
      'split pdf offline, extract pdf pages, burst pdf to zip, pdf page range extractor, private pdf splitter',
    headline: 'Split PDFs by range or burst into a ZIP offline.',
    subheadline:
      'Extract exact page selections, split every N pages, or burst an entire PDF into individual files packaged locally with fflate.',
    ctaLabel: 'Choose PDF to Split',
    accent: '#1a3a3a',
    accentText: '#ffffff',
    highlights: [
      'Custom range syntax including reversed order & "end" keyword',
      'Extract selected thumbnail cards into a single clean PDF',
      'Burst every page or split every N pages into a single .zip'
    ],
    faqs: [
      {
        q: 'How are multiple split PDFs downloaded?',
        a: 'Multi-file splits are packaged inside the same Web Worker using fflate into a single .zip archive so browsers never block multiple downloads.'
      },
      {
        q: 'What range formats are supported?',
        a: 'You can enter comma-separated ranges such as "1-3, 5, 8-end" or select pages visually in the grid.'
      }
    ]
  },
  {
    slug: 'organize-pdf',
    path: '/organize-pdf/',
    tool: 'organize',
    shortName: 'Organize Pages',
    badge: 'Rotate, Reorder & Crop',
    title: 'Organize PDF Pages Offline — Rotate, Reorder & Crop | Poffy',
    description:
      'Drag-and-drop reorder PDF pages, rotate 90°/180°/270° instantly, duplicate or delete pages, insert blank A4/Letter/Legal pages, and crop MediaBox margins offline.',
    keywords:
      'organize pdf pages, rotate pdf offline, crop pdf margins, reorder pdf pages, insert blank pdf page',
    headline: 'Reorder, rotate, and crop PDF pages at 60fps.',
    subheadline:
      'Virtual Page Graph editing keeps every drag, rotation, and crop instant without re-saving until you click Export PDF.',
    ctaLabel: 'Open PDF to Organize',
    accent: '#ff4d8b',
    accentText: '#ffffff',
    highlights: [
      'Instant CSS rotation previews with undo history',
      'Insert blank A4, US Letter, or Legal pages anywhere',
      'Adjust MediaBox & CropBox margins in PostScript points'
    ],
    faqs: [
      {
        q: 'Why is rotating or dragging 100+ pages so fast?',
        a: 'Poffy tracks edits in a lightweight Virtual Page Graph and only invokes pdf-lib inside a background Web Worker when exporting.'
      },
      {
        q: 'Can I undo page deletions or rotations?',
        a: 'Yes. The batch toolbar includes multi-step Undo for every virtual page layout change.'
      }
    ]
  },
  {
    slug: 'watermark-pdf',
    path: '/watermark-pdf/',
    tool: 'watermark',
    shortName: 'Watermark PDF',
    badge: 'Text & Image Stamps',
    title: 'Watermark PDF Offline — Diagonal Text & PNG/JPG Stamps | Poffy',
    description:
      'Add customizable text watermarks (center, corners, or diagonal tiled grid with local Unicode TTF fallback) or aspect-locked PNG/JPG stamps 100% offline.',
    keywords:
      'watermark pdf offline, add stamp to pdf, diagonal pdf watermark, unicode pdf watermark, image stamp pdf',
    headline: 'Stamp text or image watermarks on PDFs offline.',
    subheadline:
      'Apply custom opacity, angle, hex color, diagonal tiled grids, or PNG/JPG stamps with built-in offline Unicode TTF font support.',
    ctaLabel: 'Select PDF to Watermark',
    accent: '#b8a4ed',
    accentText: '#0a0a0a',
    highlights: [
      'Automatic @pdf-lib/fontkit + local Inter TTF fallback for Unicode text',
      'Center, corner anchors, or full-page diagonal tiled grids',
      'PNG & JPG image stamps with aspect-ratio lock and opacity'
    ],
    faqs: [
      {
        q: 'Does it support non-Latin or Unicode characters in watermarks?',
        a: 'Yes. Poffy automatically detects non-WinAnsi characters and embeds a bundled local Inter-Regular.ttf subset via @pdf-lib/fontkit.'
      },
      {
        q: 'Are external font CDNs used?',
        a: 'Never. All standard and fallback TTF fonts are bundled locally for full offline operation.'
      }
    ]
  },
  {
    slug: 'page-numbers',
    path: '/page-numbers/',
    tool: 'numbering',
    shortName: 'Page Numbers',
    badge: 'Headers & Footers',
    title: 'Add Page Numbers to PDF Offline — Custom Templates | Poffy',
    description:
      'Stamp dynamic {n} of {total} page numbers, headers, or footers onto PDFs offline with custom start numbers, cover-page skip, alignment, and margin offsets.',
    keywords:
      'add page numbers to pdf, pdf header footer offline, number pdf pages locally, skip cover page pdf numbering',
    headline: 'Add dynamic page numbers and headers offline.',
    subheadline:
      'Format labels with {n} and {total} tokens, skip cover pages, and control top/bottom placement, alignment, and margins locally.',
    ctaLabel: 'Choose PDF to Number',
    accent: '#ffb084',
    accentText: '#0a0a0a',
    highlights: [
      'Dynamic {n} and {total} template formatting',
      'Optional Skip Cover Page & custom starting page number',
      'Header/Footer placement with Left, Center, or Right alignment'
    ],
    faqs: [
      {
        q: 'Can I skip numbering the title or cover page?',
        a: 'Yes. Enable "Skip cover page" in the Numbers Studio and numbering begins cleanly on page 2.'
      },
      {
        q: 'Can I customize the label format?',
        a: 'Yes. Use {n} and {total} anywhere in the template, such as "Page {n} of {total}" or "Draft • {n}/{total}".'
      }
    ]
  },
  {
    slug: 'images-to-pdf',
    path: '/images-to-pdf/',
    tool: 'convert',
    shortName: 'Images to PDF',
    badge: 'JPG, PNG, WebP → PDF',
    title: 'Images to PDF Offline — Convert JPG, PNG & WebP | Poffy',
    description:
      'Batch convert JPG, PNG, and WebP images into a single PDF document offline. Fit images cleanly to A4, US Letter, or preserve original pixel dimensions.',
    keywords:
      'images to pdf offline, jpg to pdf private, png to pdf, webp to pdf converter, batch images to pdf',
    headline: 'Convert JPG, PNG, and WebP images to PDF offline.',
    subheadline:
      'Drop photos, receipts, or screenshots and pack them into A4, US Letter, or original-size PDF pages without uploading a byte.',
    ctaLabel: 'Select Images to Convert',
    accent: '#e8b94a',
    accentText: '#0a0a0a',
    highlights: [
      'Native PNG/JPG embedding plus OffscreenCanvas WebP decoding',
      'Fit cleanly to A4, US Letter, or exact original image dimensions',
      'Reorder or rotate images in the grid before exporting'
    ],
    faqs: [
      {
        q: 'How are WebP images converted to PDF?',
        a: 'WebP images are decoded inside a Web Worker via createImageBitmap and OffscreenCanvas into PNG bytes before embedding with pdf-lib.'
      },
      {
        q: 'Can I mix images and existing PDF pages?',
        a: 'Yes. Drop images alongside PDFs and click Export PDF to compile everything into one document.'
      }
    ]
  },
  {
    slug: 'pdf-to-images',
    path: '/pdf-to-images/',
    tool: 'convert',
    shortName: 'PDF to Images',
    badge: 'PDF → PNG, JPG, WebP',
    title: 'PDF to Images Offline — Export PNG, JPG & WebP | Poffy',
    description:
      'Rasterize PDF pages into high-resolution PNG, JPEG, or WebP images 100% client-side using pdfjs-dist WebAssembly and OffscreenCanvas. Single download or ZIP.',
    keywords:
      'pdf to png offline, pdf to jpg converter, pdf to webp, rasterize pdf in browser, extract pdf as images',
    headline: 'Rasterize PDF pages to PNG, JPG, or WebP offline.',
    subheadline:
      'Render crisp 1×, 2×, or 3× page images off the main thread using WebAssembly and package multi-page exports into a ZIP.',
    ctaLabel: 'Select PDF to Rasterize',
    accent: '#e8b94a',
    accentText: '#0a0a0a',
    highlights: [
      'Export lossless PNG, JPEG, or compact WebP up to 3× (216 DPI)',
      'Export all pages or only selected pages from the grid',
      'Automatic single-image download or .zip archive for multi-page'
    ],
    faqs: [
      {
        q: 'Does PDF-to-Image rendering block the browser tab?',
        a: 'No. Rasterization runs inside a dedicated Web Worker using OffscreenCanvas with live progress and instant cancellation.'
      },
      {
        q: 'Can I export only specific pages as images?',
        a: 'Yes. Select the pages you want in the grid and check "Export selected pages only" in the Images ↔ PDF tab.'
      }
    ]
  },
  {
    slug: 'metadata-scrubber',
    path: '/metadata-scrubber/',
    tool: 'metadata',
    shortName: 'Metadata Scrubber',
    badge: 'Privacy Scrubber',
    title: 'PDF Metadata Editor & Privacy Scrubber Offline | Poffy',
    description:
      'Inspect and edit PDF Title, Author, Subject, Keywords, Creator, and Producer fields, or strip all hidden Info & XMP metadata traces in one click offline.',
    keywords:
      'pdf metadata scrubber, strip pdf metadata, remove author from pdf, edit pdf info dictionary, pdf privacy tool',
    headline: 'Inspect or strip hidden PDF metadata in one click.',
    subheadline:
      'Audit Author, Creator, Producer, and XMP streams locally—then scrub identifying traces before sharing sensitive documents.',
    ctaLabel: 'Inspect PDF Metadata',
    accent: '#a4d4c5',
    accentText: '#0a0a0a',
    highlights: [
      'Read & edit Title, Author, Subject, Keywords, Creator, Producer',
      'One-click Privacy Scrub wipes Info dictionary & XMP Metadata stream',
      'Zero external requests — safe for confidential documents'
    ],
    faqs: [
      {
        q: 'What does "Strip All Metadata" remove?',
        a: 'It clears all Info dictionary fields (Title, Author, Subject, Keywords, Creator, Producer) and deletes the catalog XMP /Metadata stream.'
      },
      {
        q: 'Can I also scrub metadata during a full Workspace Export?',
        a: 'Yes. Enable metadata changes or use Optimize & Compress with "Strip All Metadata" checked.'
      }
    ]
  },
  {
    slug: 'flatten-pdf',
    path: '/flatten-pdf/',
    tool: 'forms',
    shortName: 'Forms & Flatten',
    badge: 'AcroForm & Flatten',
    title: 'Fill & Flatten PDF Forms Offline — AcroForm Inspector | Poffy',
    description:
      'Inspect AcroForm text fields, checkboxes, dropdowns, and radio groups, update values, and flatten interactive PDF forms into static read-only pages offline.',
    keywords:
      'flatten pdf form offline, fill pdf acroform, inspect pdf form fields, lock pdf form fields, client-side pdf forms',
    headline: 'Fill and flatten interactive PDF forms offline.',
    subheadline:
      'Scan AcroForm text inputs, checkboxes, dropdowns, and radio buttons locally, edit values, and bake them into static page content.',
    ctaLabel: 'Open PDF Form',
    accent: '#ff6b5a',
    accentText: '#0a0a0a',
    highlights: [
      'Inspect PDFTextField, PDFCheckBox, PDFDropdown, and PDFRadioGroup',
      'Edit field values directly in the Forms Studio sidebar',
      'One-click form.flatten() locks fields into static PDF graphics'
    ],
    faqs: [
      {
        q: 'Why flatten a PDF form before sending it?',
        a: 'Flattening converts interactive form widgets into permanent static page content so recipients cannot alter filled fields.'
      },
      {
        q: 'Can I save edited form values without flattening?',
        a: 'Yes. Uncheck "Flatten interactive form fields" to save an editable filled PDF.'
      }
    ]
  },
  {
    slug: 'optimize-pdf',
    path: '/optimize-pdf/',
    tool: 'optimize',
    shortName: 'Optimize PDF',
    badge: 'Compress & Prune',
    title: 'Optimize & Compress PDF Offline — Object Streams | Poffy',
    description:
      'Reduce PDF file size locally by pruning orphaned/unused objects, stripping metadata, and re-saving with compressed PDF object streams inside a Web Worker.',
    keywords:
      'optimize pdf offline, compress pdf locally, pdf object streams, prune unused pdf objects, reduce pdf size private',
    headline: 'Prune orphan objects and compress PDFs offline.',
    subheadline:
      'Rebuild bloated PDFs into fresh documents with compressed object streams and optional metadata scrubbing—right in your browser.',
    ctaLabel: 'Select PDF to Optimize',
    accent: '#f5f0e0',
    accentText: '#0a0a0a',
    highlights: [
      'Compressed PDF cross-reference & object streams (useObjectStreams)',
      'Clean document rebuild drops unreferenced/orphan objects',
      'Reports exact before-and-after byte savings locally'
    ],
    faqs: [
      {
        q: 'How does Poffy reduce PDF file size without uploading?',
        a: 'It copies active pages into a clean PDFDocument to discard orphaned revisions and enables PDF object-stream compression.'
      },
      {
        q: 'Does optimization degrade image quality?',
        a: 'No. Structural object-stream compression and orphan pruning are lossless.'
      }
    ]
  }
];

/**
 * Looks up a feature metadata entry by slug.
 * @param {string|undefined|null} slug
 * @returns {FeaturePageMeta|null}
 */
export function getFeatureBySlug(slug) {
  if (!slug) return null;
  return FEATURE_PAGES.find((f) => f.slug === slug) || null;
}
