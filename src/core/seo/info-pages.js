/**
 * Metadata and structured content for Poffy informational & legal pages
 * (`/about/`, `/disclaimer/`, and `/privacy-policy/`).
 *
 * @typedef {'about'|'disclaimer'|'privacy-policy'} InfoPageSlug
 *
 * @typedef {Object} InfoPageMeta
 * @property {InfoPageSlug} slug
 * @property {string} path
 * @property {string} navLabel
 * @property {string} schemaType
 * @property {string} title
 * @property {string} description
 * @property {string} keywords
 * @property {string} headline
 * @property {string} subheadline
 * @property {{ q: string, a: string }[]} [faqs]
 */

/** @type {InfoPageMeta[]} */
export const INFO_PAGES = [
  {
    slug: 'about',
    path: '/about/',
    navLabel: 'About',
    schemaType: 'AboutPage',
    title: 'About Poffy — Offline Client-Side PDF Studio, WebAssembly & Privacy Architecture',
    description:
      'Discover how Poffy edits, merges, splits, signs, and redacts PDFs 100% locally in browser memory using pdf-lib, pdfjs-dist WebAssembly, fflate, and Web Workers with zero uploads.',
    keywords:
      'about poffy, offline pdf studio, client-side pdf editor architecture, pdf-lib web workers, pdfjs-dist webassembly, fflate pdf zip, privacy-first pdf tools, offline pwa pdf',
    headline: 'About Poffy',
    subheadline:
      'A privacy-first, offline-capable PDF studio running 100% inside your browser memory with WebAssembly and Web Workers.',
    faqs: [
      {
        q: 'How does Poffy edit PDFs without uploading files to a server?',
        a: 'Poffy reads selected PDFs into volatile browser ArrayBuffers and processes rendering with pdfjs-dist WebAssembly and document assembly with pdf-lib inside dedicated background Web Workers.'
      },
      {
        q: 'Can Poffy work completely offline or in airplane mode?',
        a: 'Yes. Workbox precaches all 29 tool routes, info pages, JavaScript bundles, Web Workers, WASM binaries, CMaps, and Inter fonts locally for instant offline execution.'
      },
      {
        q: 'What makes Poffy feel fast when reordering or rotating large PDFs?',
        a: 'Poffy uses an in-memory Virtual Page Graph that applies page reordering, rotation, and crop transforms at 60fps and renders only visible thumbnails lazily via IntersectionObserver.'
      }
    ]
  },
  {
    slug: 'disclaimer',
    path: '/disclaimer/',
    navLabel: 'Disclaimer',
    schemaType: 'WebPage',
    title: 'Disclaimer — Legal Notice & Usage Terms | Poffy Offline PDF Studio',
    description:
      'Read Poffy disclaimer terms covering as-is client-side PDF processing, visual electronic signature scope, redaction verification, browser RAM limits, and open-source attributions.',
    keywords:
      'poffy disclaimer, offline pdf editor terms, electronic signature legal scope, pdf redaction verification, browser memory pdf limits, open source pdf libraries',
    headline: 'Disclaimer',
    subheadline:
      'Important technical and legal notes on client-side PDF processing, signatures, redaction, and device memory limits.'
  },
  {
    slug: 'privacy-policy',
    path: '/privacy-policy/',
    navLabel: 'Privacy Policy',
    schemaType: 'WebPage',
    title: 'Privacy Policy — Zero Uploads & Local Browser Memory | Poffy',
    description:
      'Poffy Privacy Policy: 100% client-side PDF processing with zero file uploads, zero telemetry cookies, strict connect-src self Content-Security-Policy, and local-only memory.',
    keywords:
      'poffy privacy policy, zero upload pdf privacy, no cookie pdf editor, client-side pdf privacy, offline pdf zero telemetry, local browser storage pdf',
    headline: 'Privacy Policy',
    subheadline:
      'Zero uploads, zero analytics, and zero cookies. Your documents never leave your device.'
  }
];

/**
 * Looks up an informational page entry by slug.
 * @param {string|undefined|null} slug
 * @returns {InfoPageMeta|null}
 */
export function getInfoPageBySlug(slug) {
  if (!slug) return null;
  return INFO_PAGES.find((p) => p.slug === slug) || null;
}

/** @type {{ badge: string, title: string, description: string }[]} */
export const ABOUT_HIGHLIGHTS = [
  {
    badge: '0 KB Uploaded',
    title: '100% Local Execution',
    description: 'Files stay inside volatile browser ArrayBuffers from open to export.'
  },
  {
    badge: '29 Tools',
    title: 'Unified 3-Pane Studio',
    description: 'Merge, split, sign, redact, impose, convert, extract, and inspect in one workspace.'
  },
  {
    badge: 'Airplane Mode',
    title: 'Full Offline PWA',
    description: 'All scripts, WASM binaries, CMaps, and fonts are precached via Workbox.'
  },
  {
    badge: 'Strict CSP',
    title: 'Zero Tracking',
    description: "connect-src 'self' blocks external APIs, analytics, and third-party CDNs."
  }
];

/** @type {{ step: string, title: string, detail: string }[]} */
export const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Local File Ingestion',
    detail:
      'Dropped or selected PDFs, images, and CBZ archives are read straight into local RAM via FileReader/ArrayBuffer APIs, with nothing uploaded over the network.'
  },
  {
    step: '02',
    title: '60fps Virtual Page Graph',
    detail:
      'Reordering, rotating, duplicating, deleting, and margin-cropping mutate lightweight page descriptors and CSS transforms instantaneously without rewriting binary PDFs on every click.'
  },
  {
    step: '03',
    title: 'Dual Web Worker Pipeline',
    detail:
      'UI responsiveness stays smooth because page thumbnails render off-thread via pdfjs-dist OffscreenCanvas, while heavy PDF serialization, redaction, and ZIP packing run in a separate pdf-lib Worker.'
  },
  {
    step: '04',
    title: 'Direct Blob Export & Cleanup',
    detail:
      'When you export, a compiled Uint8Array becomes a short-lived local blob: download URL that saves straight to disk and is immediately revoked, alongside bounded LRU bitmap cleanup.'
  }
];

/** @type {{ name: string, role: string, detail: string, tone: 'blue'|'teal'|'green'|'purple'|'orange' }[]} */
export const TECH_STACK_ITEMS = [
  {
    name: 'pdf-lib & @pdf-lib/fontkit',
    role: 'PDF Assembly, Forms & Metadata Engine',
    tone: 'blue',
    detail:
      'Handles structural PDF merging, page copying, CropBox/MediaBox imposition, AcroForm flattening, PDFHexString Unicode bookmarks, /EmbeddedFiles attachments, and deep metadata scrubbing cleanly in JavaScript.'
  },
  {
    name: 'pdfjs-dist & WebAssembly',
    role: 'High-Fidelity Rendering & Rasterization',
    tone: 'teal',
    detail:
      'Runs Mozilla PDF.js inside render.worker.js with bundled local WASM decoders, JPEG2000/CMaps, and OffscreenCanvas (with isEvalSupported: false) for lazy IntersectionObserver thumbnails, color filters, and visual pixel diffing.'
  },
  {
    name: 'fflate',
    role: 'Streaming ZIP & CBZ Compression',
    tone: 'orange',
    detail:
      'Packages burst-split PDFs, extracted embedded images, batch numbered outputs, and zero-compression store-mode .cbz comic archives locally without main-thread stalls.'
  },
  {
    name: 'Web Workers & Virtual Page Graph',
    role: 'Zero-Copy Concurrency & Responsive Abort',
    tone: 'purple',
    detail:
      'Transfers ArrayBuffers between the workspace store and background workers with cooperative ABORT_JOB signaling and hard worker-terminate respawn fallback so long jobs cancel immediately.'
  },
  {
    name: 'Vite MPA, Tailwind CSS v4 & Workbox PWA',
    role: 'Offline Precaching & Strict Security Shell',
    tone: 'green',
    detail:
      'Bundles dedicated SEO HTML entry points per route alongside @fontsource/inter and Inter-Regular.ttf fallback fonts into a static Workbox precache with strict Content-Security-Policy headers.'
  }
];

/** @type {{ title: string, paragraphs: string[], bullets?: string[] }[]} */
export const DISCLAIMER_SECTIONS = [
  {
    title: '1. As-Is Software & Document Backups',
    paragraphs: [
      'Poffy is provided on an "as is" and "as available" basis without warranties of any kind, express or implied, including fitness for a particular purpose or non-infringement.',
      'Always retain copies of your original PDF, image, or CBZ files before performing destructive edits, permanent redaction, flattening, or metadata scrubbing.'
    ]
  },
  {
    title: '2. Electronic Signatures & Legal Compliance',
    paragraphs: [
      'Drawn, typed, and stamped signatures created with Poffy Sign & Annotate are visual vector/bitmap markings embedded onto PDF pages. They are not cryptographic digital certificates issued by a Certificate Authority (CA), nor do they replace qualified electronic signatures (such as eIDAS QES) where legally mandated.'
    ]
  },
  {
    title: '3. Redaction & Privacy Scrubbing Verification',
    paragraphs: [
      'Poffy provides permanent raster-burn redaction (burning selected regions or full pages in Paranoid Mode) and deep metadata scrubbing (clearing Info dictionaries, XMP streams, thumbnails, and document actions). However, complex PDFs can contain embedded artifacts or scanned text.',
      'Always open and inspect exported files independently to confirm all sensitive content has been removed to your satisfaction before sharing.'
    ]
  },
  {
    title: '4. Local Device Memory & Browser Limits',
    paragraphs: [
      'Because Poffy operates 100% inside your browser without server-side processing, maximum file size, batch rasterization resolution, and processing speed depend on your device hardware, available RAM, and browser tab memory limits.'
    ]
  },
  {
    title: '5. Open-Source Attributions',
    paragraphs: [
      'Poffy is built with open-source packages including pdf-lib, @pdf-lib/fontkit, pdfjs-dist, fflate, Tailwind CSS, Vite, Workbox, and the Inter typeface. All trademarks and package copyrights belong to their respective authors and maintainers.'
    ]
  }
];

/** @type {{ title: string, paragraphs: string[], bullets?: string[] }[]} */
export const PRIVACY_SECTIONS = [
  {
    title: '1. Zero Uploads & 100% Local Processing',
    paragraphs: [
      'Every PDF, image, CBZ archive, filename, form field value, and signature processed in Poffy stays strictly inside your browser memory on your own device. No files or document contents are ever transmitted to our servers or any third-party API.',
      'Poffy enforces a strict Content-Security-Policy (connect-src \'self\'; object-src \'none\'; frame-ancestors \'none\') so browser runtime code cannot make outbound network requests to external servers.'
    ]
  },
  {
    title: '2. No Analytics, Cookies, or Tracking',
    paragraphs: [
      'Poffy does not set tracking cookies, run analytics scripts, collect usage telemetry, or load external fonts, CDNs, or advertising pixels.'
    ],
    bullets: [
      'Zero cookies used for tracking or profiling',
      'Zero third-party analytics or crash-reporting beacons',
      'Zero outbound requests after static app assets load'
    ]
  },
  {
    title: '3. How Browser Memory & Local Storage Are Used',
    paragraphs: [
      'While your documents never leave your device, browsers expose different local storage mechanisms for distinct purposes:'
    ],
    bullets: [
      'Volatile RAM (ArrayBuffers & Web Workers): Holds opened files, page previews, and active edits solely during your open session. Closing, refreshing, or clicking Reset immediately discards all document data.',
      'Offline Service Worker Cache (Workbox): Stores static application scripts, WASM binaries, CMaps, and fonts locally so Poffy works offline. User PDFs and edits are never written into the Service Worker cache.',
      'Optional Signature Tray (localStorage): Only if you explicitly draw or save a reusable signature in Sign & Annotate does Poffy store that transparent PNG signature locally under poffy_saved_signatures in browser localStorage, which you can clear anytime in one click.',
      'Zero IndexedDB Document Persistence: Uploaded files are never persisted to IndexedDB.'
    ]
  },
  {
    title: '4. Static Website Hosting Logs',
    paragraphs: [
      'When you initially load Poffy over the internet, standard static web hosting infrastructure (such as Cloudflare Pages or Vercel) may temporarily process standard HTTP request logs (such as IP address, user-agent, and page path) solely to deliver the static HTML, JS, CSS, and WASM assets. Once cached as an offline PWA, Poffy operates with zero network traffic.'
    ]
  },
  {
    title: '5. Transparency & Source Verification',
    paragraphs: [
      'You can inspect Poffy\'s source code, security headers, worker isolation, and offline PWA manifest directly in the open-source repository on GitHub.'
    ]
  }
];
