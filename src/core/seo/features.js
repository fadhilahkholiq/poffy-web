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
    title: 'Merge PDF Offline · Combine & Interleave PDFs Locally | Poffy',
    description:
      'Combine multiple PDF files sequentially or interleave pages 100% offline in browser memory. Zero uploads, zero file limits, powered by pdf-lib Web Workers.',
    keywords:
      'merge pdf offline, combine pdf locally, interleave pdf pages, private pdf merger, no upload pdf merge',
    headline: 'Merge and interleave PDFs with zero uploads.',
    subheadline:
      'Drop multiple PDFs or images, drag pages into your exact order, or interleave front-and-back scans in one click, entirely inside your browser.',
    ctaLabel: 'Select PDFs to Merge',
    accent: '#ff4d8b',
    accentText: '#ffffff',
    highlights: [
      'Sequential multi-PDF merging & 1-by-1 page interleaving',
      'Mix PDFs with PNG, JPG, or WebP images seamlessly',
      'Zero server uploads · works offline in airplane mode'
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
    title: 'Split PDF Offline · Extract Ranges or Burst to ZIP | Poffy',
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
    title: 'Organize PDF Pages Offline · Rotate, Reorder & Crop | Poffy',
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
    title: 'Watermark PDF Offline · Diagonal Text & PNG/JPG Stamps | Poffy',
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
    title: 'Add Page Numbers to PDF Offline · Custom Templates | Poffy',
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
    title: 'Images to PDF Offline · Convert JPG, PNG & WebP | Poffy',
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
    title: 'PDF to Images Offline · Export PNG, JPG & WebP | Poffy',
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
      'Audit Author, Creator, Producer, and XMP streams locally, then scrub identifying traces before sharing sensitive documents.',
    ctaLabel: 'Inspect PDF Metadata',
    accent: '#a4d4c5',
    accentText: '#0a0a0a',
    highlights: [
      'Read & edit Title, Author, Subject, Keywords, Creator, Producer',
      'One-click Privacy Scrub wipes Info dictionary & XMP Metadata stream',
      'Zero external requests · safe for confidential documents'
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
    title: 'Fill & Flatten PDF Forms Offline · AcroForm Inspector | Poffy',
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
    title: 'Optimize & Compress PDF Offline · Object Streams | Poffy',
    description:
      'Reduce PDF file size locally by pruning orphaned/unused objects, stripping metadata, and re-saving with compressed PDF object streams inside a Web Worker.',
    keywords:
      'optimize pdf offline, compress pdf locally, pdf object streams, prune unused pdf objects, reduce pdf size private',
    headline: 'Prune orphan objects and compress PDFs offline.',
    subheadline:
      'Rebuild bloated PDFs into fresh documents with compressed object streams and optional metadata scrubbing, right in your browser.',
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
  },
  {
    slug: 'resize-pdf',
    path: '/resize-pdf/',
    tool: 'resize',
    shortName: 'Resize PDF',
    badge: 'Standardize Paper Size',
    title: 'Resize PDF Pages Offline · A4, Letter, Legal, F4 & Custom | Poffy',
    description:
      'Standardize mixed PDF page sizes to uniform A4, A3, A5, US Letter, Legal, F4/Folio, or custom mm/cm/in/pt dimensions locally via embedPage().',
    keywords:
      'resize pdf offline, standardize pdf page size, convert letter to a4 pdf, f4 folio pdf resize, change pdf dimensions locally',
    headline: 'Normalize mixed PDF page sizes to uniform paper dimensions.',
    subheadline:
      'Convert irregular scans, screenshots, Letter, Legal, and F4 documents into crisp uniform A4, A3, A5, or custom sheets offline.',
    ctaLabel: 'Select PDF to Resize',
    accent: '#e8b94a',
    accentText: '#0a0a0a',
    highlights: [
      'A3, A4, A5, Letter, Legal, F4/Folio presets + mm/cm/in/pt custom sizes',
      'Fit (aspect-safe), Fill (cover), and Original Center placement modes',
      'Auto, Force Portrait, or Force Landscape with CropBox & /Rotate accuracy'
    ],
    faqs: [
      {
        q: 'Does resizing keep vector text crisp?',
        a: 'Yes. Poffy uses pdf-lib embedPage() vector embedding so text and vector drawings scale sharply without rasterization.'
      },
      {
        q: 'Can I set custom dimensions in millimeters or inches?',
        a: 'Yes. Switch Preset to Custom and convert seamlessly between mm, cm, inches, and PostScript points.'
      }
    ]
  },
  {
    slug: 'nup-booklet',
    path: '/nup-booklet/',
    tool: 'nup',
    shortName: 'N-Up & Booklet',
    badge: 'N-Up & Saddle-Stitch',
    title: 'PDF N-Up Grid & Booklet Maker Offline · Saddle-Stitch | Poffy',
    description:
      'Combine 2, 4, 6, or 9 PDF pages per sheet or impose saddle-stitch folded booklets with automatic 4-page blank padding and duplex flip offline.',
    keywords:
      'pdf booklet maker offline, n-up pdf grid, 2-up pdf print, saddle stitch pdf imposition, duplex pdf flip',
    headline: 'Create N-Up grids and saddle-stitch booklets offline.',
    subheadline:
      'Lay out 2-up to 9-up study sheets or fold-ready saddle-stitch booklets with automatic multiple-of-4 blank padding and live sheet diagrams.',
    ctaLabel: 'Open PDF for Imposition',
    accent: '#b8a4ed',
    accentText: '#0a0a0a',
    highlights: [
      'Vector 2-up, 4-up, 6-up, and 9-up sheets with LTR, RTL, or TTB order',
      'Saddle-stitch booklet padding & [N, 1], [2, N-1] spread imposition',
      'Duplex 180° back-side flip toggle and live visual sheet diagram'
    ],
    faqs: [
      {
        q: 'What happens if my PDF page count is not a multiple of 4 in Booklet mode?',
        a: 'Poffy automatically pads trailing blank pages so sheets align cleanly, for example, a 5-page PDF imposes onto 4 folded landscape spreads.'
      },
      {
        q: 'Does it support right-to-left (RTL) manga or book binding?',
        a: 'Yes. Choose Right-Edge Binding in Booklet mode or Right-to-Left order in N-Up mode.'
      }
    ]
  },
  {
    slug: 'split-spreads',
    path: '/split-spreads/',
    tool: 'spreads',
    shortName: 'Split Spreads',
    badge: 'Half-Page Book Splitter',
    title: 'Split PDF Book Spreads Offline · Cut 2-Up Scans in Half | Poffy',
    description:
      'Slice 2-page scanned book spreads cleanly into single pages by updating CropBox and MediaBox offline with draggable split preview and cover skip.',
    keywords:
      'split pdf book spreads, cut double page pdf in half, crop two page spread pdf, manga spread splitter offline',
    headline: 'Slice 2-page book spreads cleanly into single pages.',
    subheadline:
      'Drag the visual divider line to set the exact gutter cut, skip front or back covers, and export lossless vector single pages offline.',
    ctaLabel: 'Select Spread PDF to Split',
    accent: '#1a3a3a',
    accentText: '#ffffff',
    highlights: [
      'Interactive draggable vertical/horizontal split line preview',
      'Updates both CropBox and MediaBox cleanly with /Rotate accuracy',
      'Skip first/last covers, landscape-only filter, and LTR/RTL reading order'
    ],
    faqs: [
      {
        q: 'Does splitting spreads re-rasterize my PDF pages?',
        a: 'No. Poffy duplicates pages via pdf-lib copyPages() and slices CropBox and MediaBox cleanly without losing text or resolution.'
      },
      {
        q: 'Can I keep a single-page front or back cover unsplit?',
        a: 'Yes. Enable "Skip first page (cover)", "Skip last page", or "Split landscape pages only".'
      }
    ]
  },
  {
    slug: 'color-filters',
    path: '/color-filters/',
    tool: 'filters',
    shortName: 'Color Filters',
    badge: 'Grayscale, Dark & Clean',
    title: 'PDF Grayscale, Dark Mode & Scan Cleanup Offline | Poffy',
    description:
      'Convert PDFs to ink-saving grayscale, eye-friendly dark mode invert, or high-contrast Otsu-cleaned scans inside local Web Workers with live preview.',
    keywords:
      'pdf grayscale offline, invert pdf dark mode, pdf scan cleanup contrast, otsu threshold pdf, whiten scanned pdf background',
    headline: 'Convert PDFs to grayscale, dark mode, or crisp scans.',
    subheadline:
      'Whiten shadowy phone scans, save printer ink with luminance grayscale, or generate dark-slate reading PDFs with a live side-by-side preview.',
    ctaLabel: 'Choose PDF to Filter',
    accent: '#a4d4c5',
    accentText: '#0a0a0a',
    highlights: [
      'Ink-Saver Grayscale, Dark Slate/Pure Invert, and Scan Cleanup presets',
      'Background whitening, contrast boost, and Otsu auto-binarization',
      'Instant side-by-side preview and configurable 150/200/300 DPI output'
    ],
    faqs: [
      {
        q: 'When should I enable B&W Otsu Binarization in Scan Cleanup?',
        a: 'Enable B&W Binarization on phone photos or receipts with uneven shadows to snap ink to crisp black on pure white encoded as compact PNG.'
      },
      {
        q: 'Are page pixels ever sent to a remote server?',
        a: 'Never. All pdfjs-dist rendering and OffscreenCanvas pixel filters execute locally inside a dedicated Web Worker.'
      }
    ]
  },
  {
    slug: 'redact-pdf',
    path: '/redact-pdf/',
    tool: 'redact',
    shortName: 'Redact PDF',
    badge: 'True Raster Redaction',
    title: 'True PDF Redaction Offline · Permanently Burn Sensitive Data | Poffy',
    description:
      'Permanently destroy sensitive text and regions in PDFs via Selective Raster-Burn or Paranoid Mode with deep XMP/Info scrubbing inside local Web Workers.',
    keywords:
      'redact pdf offline, permanent pdf redaction, remove sensitive text from pdf, regex pdf redaction, paranoid pdf scrub',
    headline: 'Permanently redact sensitive PDF data with zero leaks.',
    subheadline:
      'Draw redaction boxes or auto-mark emails, phone numbers, and regex patterns, then raster-burn marked pages while keeping clean pages crisp.',
    ctaLabel: 'Select PDF to Redact',
    accent: '#1a3a3a',
    accentText: '#ffffff',
    highlights: [
      'Selective Raster-Burn destroys underlying text layers completely',
      'Regex & keyword search-and-mark (emails, phones, SSN, custom patterns)',
      'Paranoid Mode burns every page & runs deep XMP/JavaScript privacy scrub'
    ],
    faqs: [
      {
        q: 'Why is Poffy redaction permanent compared to drawing black boxes?',
        a: 'Marked pages are rendered onto OffscreenCanvas with opaque pixels burned directly into the raster image and rebuilt via pdf-lib, leaving zero extractable text underneath.'
      },
      {
        q: 'Does Selective Raster-Burn affect unmarked pages?',
        a: 'No. In default Selective mode, unmarked pages are copied losslessly via copyPages() to keep selectable text sharp unless Paranoid Mode is enabled.'
      }
    ]
  },
  {
    slug: 'sign-annotate',
    path: '/sign-annotate/',
    tool: 'sign',
    shortName: 'Sign & Annotate',
    badge: 'e-Signature & Markup',
    title: 'Sign & Annotate PDF Offline · Draw Signatures & Vector Markup | Poffy',
    description:
      'Sign PDFs offline using drawn Bezier canvas signatures, styled typed signatures, or transparent PNG/WebP uploads, plus native vector highlights, shapes, and arrows.',
    keywords:
      'sign pdf offline, electronic signature pdf locally, annotate pdf vector, pdf highlight arrow checkmark offline',
    headline: 'Sign and annotate PDFs with crisp vector precision.',
    subheadline:
      'Create handwritten or styled signatures locally, place translucent highlights, shapes, arrows, and text callouts, accurate on rotated PDFs.',
    ctaLabel: 'Open PDF to Sign',
    accent: '#ff4d8b',
    accentText: '#ffffff',
    highlights: [
      'Draw (smooth Bezier pad), Type (offline styled canvas), or Upload PNG/WebP',
      'Native pdf-lib vector highlights, rectangles, ellipses, arrows, and callouts',
      'Rotation & CropBox-aware drag, resize, and rotate placement engine'
    ],
    faqs: [
      {
        q: 'Are my signatures or documents ever stored on a server?',
        a: 'No. Signatures are rendered to transparent PNG in browser memory and optionally saved strictly in your browser localStorage tray with a one-click clear button.'
      },
      {
        q: 'Do placed signatures align on rotated 90° or 270° PDFs?',
        a: 'Yes. The shared Coordinate & Overlay Engine compensates for page CropBox offsets and cumulative /Rotate angles automatically.'
      }
    ]
  },
  {
    slug: 'compare-pdf',
    path: '/compare-pdf/',
    tool: 'compare',
    shortName: 'Compare PDF',
    badge: 'Visual & Text Diff',
    title: 'Compare Two PDFs Offline · Pixel Visual Diff & Text Myers Diff | Poffy',
    description:
      'Compare original and revised PDF versions locally with worker RGBA pixel diffs, side-by-side sync scroll, split-slider curtain, and Myers text diff.',
    keywords:
      'compare pdf offline, pdf visual diff locally, pdf text diff myers, find changes between two pdfs privately',
    headline: 'Spot every visual and textual change between PDF revisions.',
    subheadline:
      'Load v1 and v2 side by side in browser memory to inspect red/green pixel diffs, split-slider curtains, and word/line Myers text diffs.',
    ctaLabel: 'Upload First PDF (v1)',
    accent: '#b8a4ed',
    accentText: '#0a0a0a',
    highlights: [
      'OffscreenCanvas 1.5× visual pixel diff with per-page % change badges',
      'Side-by-side sync scroll, Overlay Diff Map, and Split-Slider curtain',
      'Client-side Myers text diff & downloadable PDF Diff Report'
    ],
    faqs: [
      {
        q: 'How are added and removed changes highlighted?',
        a: 'Pixels removed from the original PDF appear in red (#ef4444), newly added pixels appear in green (#22c55e), and matching regions dim for context.'
      },
      {
        q: 'What happens if v1 and v2 have different page counts?',
        a: 'Poffy flags trailing extra or missing pages cleanly as Added or Removed (100% delta) without interrupting comparison.'
      }
    ]
  },
  {
    slug: 'extract-text',
    path: '/extract-text/',
    tool: 'extract-text',
    shortName: 'Extract Text',
    badge: 'TXT, Markdown & JSON',
    title: 'Extract PDF Text Offline · Reading Order TXT, Markdown & JSON | Poffy',
    description:
      'Extract ordered text, inferred Markdown headings, and JSON bounding coordinates from PDFs locally via pdfjs-dist getTextContent() or batch ZIP.',
    keywords:
      'extract text from pdf offline, pdf to markdown offline, pdf to txt json, pdf text extractor client side',
    headline: 'Extract clean TXT, Markdown, and JSON from PDFs offline.',
    subheadline:
      'Sort text spans in natural reading order, infer Markdown headings and paragraphs, or export coordinate JSON and batch ZIPs locally.',
    ctaLabel: 'Select PDF to Extract Text',
    accent: '#a4d4c5',
    accentText: '#0a0a0a',
    highlights: [
      'Natural reading-order Y-bucket & X-sort reconstruction with paragraph detection',
      'Export TXT (page markers), Markdown (headings), or JSON (item coordinates)',
      'Batch multi-PDF ZIP packaging + automatic scanned-PDF detection'
    ],
    faqs: [
      {
        q: 'What happens if I upload a scanned image-only PDF?',
        a: 'Poffy detects when near-zero extractable text characters exist and shows a clear notice explaining no text layer is present.'
      },
      {
        q: 'Can I extract text from multiple PDFs at once?',
        a: 'Yes. Load multiple PDFs and click Batch ZIP to bundle every extracted file locally via fflate.'
      }
    ]
  },
  {
    slug: 'extract-images',
    path: '/extract-images/',
    tool: 'extract-images',
    shortName: 'Extract Images',
    badge: 'Raw Embedded Assets',
    title: 'Extract Embedded Images from PDF Offline · JPG, PNG & ZIP | Poffy',
    description:
      'Extract raw embedded JPEG, JP2, and Flate PNG images (including CMYK to RGB and SMask alpha transparency) directly from PDF streams locally.',
    keywords:
      'extract images from pdf offline, lossless pdf jpg extractor, extract embedded pdf assets zip, pdf smask png',
    headline: 'Extract original embedded PDF images without re-encoding.',
    subheadline:
      'Pull raw /DCTDecode JPEGs byte-for-byte, reconstruct Flate CMYK/SMask PNGs on OffscreenCanvas, filter spacers, and export a ZIP.',
    ctaLabel: 'Select PDF to Scan Images',
    accent: '#e8b94a',
    accentText: '#0a0a0a',
    highlights: [
      'Byte-for-byte lossless /DCTDecode JPEG & /JPXDecode JP2 extraction',
      'Reconstructs /FlateDecode RGB, CMYK & /SMask alpha channels to PNG',
      'Deduplicates identical images, filters small spacers & exports ZIP'
    ],
    faqs: [
      {
        q: 'Are embedded JPEGs re-compressed during extraction?',
        a: 'No. /DCTDecode image streams are extracted directly as raw .jpg bytes without any quality loss.'
      },
      {
        q: 'How are tiny 1x1 tracking spacers filtered out?',
        a: 'Set Minimum Dimensions (default 32×32 px) before scanning to ignore spacer pixels and duplicate logos.'
      }
    ]
  },
  {
    slug: 'pdf-attachments',
    path: '/pdf-attachments/',
    tool: 'attachments',
    shortName: 'PDF Attachments',
    badge: 'EmbeddedFiles Manager',
    title: 'PDF Attachments Manager Offline · Extract, Add & Remove Files | Poffy',
    description:
      'Inspect, extract (single or ZIP), attach new files via pdfDoc.attach(), and remove embedded XML/CSV/archive attachments from PDFs locally.',
    keywords:
      'pdf attachments manager offline, extract embedded files from pdf, attach csv xml to pdf, remove pdf attachments',
    headline: 'Inspect, attach, and extract embedded PDF files offline.',
    subheadline:
      'Walk PDF /EmbeddedFiles name trees locally, decompress Flate streams, attach datasets with UTF-8 names, or extract all into a ZIP.',
    ctaLabel: 'Open PDF with Attachments',
    accent: '#ff6b5a',
    accentText: '#0a0a0a',
    highlights: [
      'Reads nested /Names -> /EmbeddedFiles trees & decompresses Flate streams',
      'Attach CSV, XML, JSON, or spreadsheets preserving MIME & UTF-8 filenames',
      'Remove attachments cleanly or Extract All into a local fflate ZIP'
    ],
    faqs: [
      {
        q: 'Are UTF-8 filenames preserved when attaching files?',
        a: 'Yes. Poffy uses pdfDoc.attach() and decodes both /UF and /F strings cleanly across round-trips.'
      },
      {
        q: 'Can I extract all attachments at once?',
        a: 'Yes. Click Extract All (.zip) to package all embedded files locally via fflate.'
      }
    ]
  },
  {
    slug: 'bookmark-editor',
    path: '/bookmark-editor/',
    tool: 'bookmarks',
    shortName: 'Bookmark Editor',
    badge: 'Outlines & Auto-TOC',
    title: 'PDF Bookmark & Outline Editor Offline · Nested TOC Tree | Poffy',
    description:
      'Read, create, nest, reorder, and rename PDF bookmarks (Table of Contents) with full Unicode/CJK PDFHexString support locally in browser memory.',
    keywords:
      'edit pdf bookmarks offline, pdf outline table of contents editor, add nested bookmarks pdf, unicode pdf outlines',
    headline: 'Build and edit nested PDF bookmarks and Table of Contents.',
    subheadline:
      'Inspect existing outlines, nest sub-chapters, jump to target pages side-by-side, and serialize clean Unicode /Outlines dictionaries offline.',
    ctaLabel: 'Open PDF to Edit Bookmarks',
    accent: '#ffb084',
    accentText: '#0a0a0a',
    highlights: [
      'Reads existing pdfjs-dist outlines & resolves target page destinations',
      'Nested tree editor: add sibling/child, indent/outdent, reorder & jump preview',
      'Full Unicode/CJK titles via PDFHexString.fromText() & Merge Auto-TOC hook'
    ],
    faqs: [
      {
        q: 'Do non-Latin or CJK bookmark titles work properly?',
        a: 'Yes. Titles are encoded via PDFHexString.fromText() so Unicode, accented text, and CJK characters display cleanly in standard PDF viewers.'
      },
      {
        q: 'Can Poffy auto-generate bookmarks when merging PDFs?',
        a: 'Yes. Check "Generate bookmarks from filenames" in the Organize/Merge studio before exporting.'
      }
    ]
  },
  {
    slug: 'cbz-pdf',
    path: '/cbz-pdf/',
    tool: 'cbz',
    shortName: 'CBZ ↔ PDF',
    badge: 'Comic Archive Converter',
    title: 'CBZ to PDF & PDF to CBZ Converter Offline · Natural Page Sort | Poffy',
    description:
      'Convert CBZ comic archives to PDF with natural numeric page sorting and optional uniform width, or export PDFs to store-mode CBZ archives offline.',
    keywords:
      'cbz to pdf offline, pdf to cbz converter, comic archive converter client side, natural sort cbz to pdf',
    headline: 'Convert CBZ comics and PDF documents bidirectionally offline.',
    subheadline:
      'Unpack CBZ archives with natural numeric page sorting and optional uniform width, or render PDFs into zero-compression CBZ archives.',
    ctaLabel: 'Choose PDF or CBZ File',
    accent: '#b8a4ed',
    accentText: '#0a0a0a',
    highlights: [
      'CBZ → PDF: natural numeric sort, __MACOSX/dotfile filtering & uniform width',
      'PDF → CBZ: 1.5×–3× WebP/JPEG/PNG rendering packed in fflate store mode',
      '100% offline Web Worker execution · zero file size or server limits'
    ],
    faqs: [
      {
        q: 'Does CBZ → PDF sort page2.jpg before page10.jpg?',
        a: 'Yes. Poffy sorts archive entries using natural numeric collation (numeric: true) and skips __MACOSX metadata folders.'
      },
      {
        q: 'Why does PDF → CBZ use store-mode ZIP (level 0)?',
        a: 'Because WebP, JPEG, and PNG comic images are already compressed, store-mode zipSync creates valid .cbz files near-instantly.'
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
