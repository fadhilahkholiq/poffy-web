import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './styles/main.css';

import { registerSW } from 'virtual:pwa-register';
import { pdfOpsClient } from './core/pdf/worker-client.js';
import { pdfRenderClient } from './core/render/pdfjs-client.js';
import { FEATURE_PAGES, getFeatureBySlug } from './core/seo/features.js';
import { getInfoPageBySlug, INFO_PAGES } from './core/seo/info-pages.js';
import { workspace } from './state/workspace.js';
import { renderHeroDropzone } from './ui/components/HeroDropzone.js';
import { renderInfoPage } from './ui/components/InfoPage.js';
import { renderOverlays } from './ui/components/Overlays.js';
import { renderPageGrid } from './ui/components/PageGrid.js';
import { renderTopNav } from './ui/components/TopNav.js';
import {
  renderToolInspector,
  renderToolRail,
  updateFilterPreviewDom
} from './ui/components/ToolInspector.js';
import { bindWindowDropOverlay, ingestFiles } from './ui/interactions/file-ingestion.js';
import { el, mount, sanitizeExternalUrl, svgEl } from './ui/utils/dom.js';
import { getToolStyleBySlug } from './ui/utils/tool-styles.js';

/**
 * Registers the Workbox service worker for full offline capability.
 */
function initOfflineServiceWorker() {
  try {
    registerSW({
      immediate: true,
      onOfflineReady() {
        workspace.showNotice(
          'info',
          'Offline Ready',
          'Poffy is cached locally and ready to work with Wi-Fi turned off.'
        );
      }
    });
  } catch {
    // Service Worker registration can be skipped in unsupported environments
  }
}

/**
 * Bootstraps the Poffy application shell, reactive subscriptions, and global error boundary.
 */
function bootstrap() {
  const root = document.getElementById('app');
  if (!root) return;

  const activeFeature = getFeatureBySlug(document.documentElement.dataset.feature);
  const activeInfoPage = !activeFeature ? getInfoPageBySlug(document.documentElement.dataset.page) : null;
  if (activeFeature) {
    workspace.setActiveTool(activeFeature.tool);
  }

  const navSlot = el('div', { id: 'nav-slot', className: 'sticky top-0 z-30' });
  const overlaysSlot = el('div', { id: 'overlays-slot' });
  const workspaceSlot = el('div', { id: 'workspace-slot', className: 'flex-1' });
  const fileInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'global-file-input',
      type: 'file',
      multiple: true,
      accept:
        'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.xls,.csv,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/vnd.openxmlformats-officedocument.presentationml.presentation',
      className: 'hidden'
    })
  );

  const preFooterHero = el(
    'section',
    {
      'aria-label': 'Poffy Offline PDF Studio overview',
      className: 'border-t border-black/[0.08] bg-white'
    },
    el(
      'div',
      { className: 'max-w-[1120px] mx-auto px-4 sm:px-6 py-10 sm:py-12 text-center space-y-4' },
      el(
        'div',
        { className: 'flex flex-wrap items-center justify-center gap-2.5' },
        el(
          'a',
          {
            href: '/',
            className: 'inline-flex items-center gap-2.5 no-underline text-[#1d1d1f]'
          },
          el(
            'h2',
            {
              className:
                'text-[24px] sm:text-[28px] font-semibold tracking-[-0.025em] leading-[1.1] text-[#1d1d1f]'
            },
            'Poffy'
          ),
          el('span', { className: 'badge-pill text-[12px]' }, 'Offline PDF Studio')
        )
      ),
      el(
        'p',
        { className: 'text-[14.5px] sm:text-[15.5px] leading-[1.55] text-[#6e6e73] max-w-[60ch] mx-auto' },
        'Privacy-first PDF tools running 100% in browser memory via WebAssembly and Web Workers.'
      ),
      el(
        'div',
        { className: 'flex flex-wrap items-center justify-center gap-2 pt-1' },
        el(
          'span',
          {
            className:
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e8f8ed] border border-[#34c759]/20 text-[12px] font-medium text-[#248a3d]'
          },
          el('span', { className: 'w-1.5 h-1.5 rounded-full bg-[#34c759] shrink-0', 'aria-hidden': 'true' }),
          'Zero Uploads'
        ),
        el(
          'span',
          {
            className:
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e8f2ff] border border-[#0071e3]/15 text-[12px] font-medium text-[#0071e3]'
          },
          el('span', { className: 'w-1.5 h-1.5 rounded-full bg-[#0071e3] shrink-0', 'aria-hidden': 'true' }),
          'Works Offline'
        ),
        el(
          'span',
          {
            className:
              'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#f5f5f7] border border-black/[0.07] text-[12px] font-medium text-[#424245]'
          },
          el('span', { className: 'w-1.5 h-1.5 rounded-full bg-[#86868b] shrink-0', 'aria-hidden': 'true' }),
          `${FEATURE_PAGES.length} Tools`
        )
      )
    )
  );

  const footerEl = el(
    'footer',
    { className: 'border-t border-black/[0.08] bg-white' },
    el(
      'div',
      { className: 'max-w-[1120px] mx-auto px-4 sm:px-6 py-10 space-y-8' },
      el(
        'nav',
        { 'aria-label': 'All Offline PDF Tools' },
        (() => {
              const groups = [
                {
                  title: 'Pages & Layout',
                  slugs: ['merge-pdf', 'split-pdf', 'organize-pdf', 'resize-pdf', 'nup-booklet', 'split-spreads'],
                  includeHome: true
                },
                {
                  title: 'Edit, Sign & Clean',
                  slugs: ['watermark-pdf', 'page-numbers', 'sign-annotate', 'redact-pdf', 'color-filters', 'compare-pdf'],
                  includeHome: false
                },
                {
                  title: 'Convert & Extract',
                  slugs: [
                    'images-to-pdf',
                    'pdf-to-images',
                    'cbz-pdf',
                    'docx-to-pdf',
                    'xlsx-to-pdf',
                    'pptx-to-pdf',
                    'pdf-to-markdown',
                    'pdf-to-docx',
                    'pdf-to-xlsx',
                    'pdf-to-pptx',
                    'extract-text',
                    'extract-images'
                  ],
                  includeHome: false
                },
                {
                  title: 'Inspect & Output',
                  slugs: ['optimize-pdf', 'metadata-scrubber', 'flatten-pdf', 'pdf-attachments', 'bookmark-editor'],
                  includeHome: false
                }
              ];

              const bySlug = new Map(FEATURE_PAGES.map((f) => [f.slug, f]));
              const assignedSlugs = new Set(groups.flatMap((g) => g.slugs));
              for (const f of FEATURE_PAGES) {
                if (!assignedSlugs.has(f.slug)) {
                  groups[3].slugs.push(f.slug);
                }
              }

              return el(
                'div',
                { className: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-6' },
                groups.map((grp) => {
                  const items = [];
                  if (grp.includeHome) {
                    const isHome = !activeFeature && !activeInfoPage;
                    items.push(
                      el(
                        'li',
                        {},
                        el(
                          'a',
                          {
                            href: '/',
                            'aria-current': isHome ? 'page' : undefined,
                            className: `footer-dir-link ${isHome ? 'is-current' : ''}`
                          },
                          el('span', {
                            className: `w-2 h-2 rounded-full shrink-0 ${isHome ? 'bg-white' : 'bg-[#0071e3]'}`,
                            'aria-hidden': 'true'
                          }),
                          el('span', { className: 'truncate' }, 'Studio Home')
                        )
                      )
                    );
                  }

                  for (const slug of grp.slugs) {
                    const f = bySlug.get(slug);
                    if (!f) continue;
                    const isCurrent = activeFeature?.slug === f.slug;
                    const st = getToolStyleBySlug(f.slug);
                    items.push(
                      el(
                        'li',
                        {},
                        el(
                          'a',
                          {
                            href: f.path,
                            'aria-current': isCurrent ? 'page' : undefined,
                            className: `footer-dir-link ${isCurrent ? 'is-current' : ''}`
                          },
                          el('span', {
                            className: 'w-2 h-2 rounded-full shrink-0',
                            style: { backgroundColor: isCurrent ? '#ffffff' : st.fg },
                            'aria-hidden': 'true'
                          }),
                          el('span', { className: 'truncate' }, f.shortName)
                        )
                      )
                    );
                  }

                  return el(
                    'div',
                    { className: 'space-y-2' },
                    el(
                      'p',
                      { className: 'text-[11px] font-semibold uppercase tracking-[0.06em] text-[#86868b] px-0.5 sm:px-2' },
                      grp.title
                    ),
                    el('ul', { className: 'flex flex-wrap gap-1.5 sm:block sm:space-y-0.5 list-none p-0 m-0' }, items)
                  );
                })
              );
            })()
          ),
        el(
          'div',
          {
            className:
              'pt-6 border-t border-black/[0.08] flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left text-[13px] text-[#86868b]'
          },
          el(
            'div',
            { className: 'flex flex-col sm:flex-row flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-2.5' },
            el(
              'div',
              { className: 'flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1' },
              el('span', { className: 'font-semibold text-[#1d1d1f]' }, 'Poffy'),
              el('span', { 'aria-hidden': 'true' }, '•'),
              el('span', {}, 'Created by Kholiq Fadhilah')
            ),
            el(
              'nav',
              { 'aria-label': 'About and legal pages', className: 'flex flex-wrap items-center justify-center gap-1.5' },
              INFO_PAGES.map((p) => {
                const isActive = activeInfoPage?.slug === p.slug;
                return el(
                  'a',
                  {
                    href: p.path,
                    'aria-current': isActive ? 'page' : undefined,
                    className: `px-2.5 py-1 rounded-full text-[12px] font-medium no-underline transition-colors ${
                      isActive
                        ? 'bg-[#0071e3] text-white font-semibold'
                        : 'bg-[#f5f5f7] hover:bg-[#e5e5ea] text-[#424245] border border-black/[0.05]'
                    }`
                  },
                  p.navLabel
                );
              })
            )
          ),
          el(
            'div',
            { className: 'flex flex-col sm:flex-row items-center gap-x-5 gap-y-3' },
            el(
              'div',
              { className: 'flex flex-col items-center md:items-end leading-snug' },
              el('span', { className: 'font-medium text-[#424245]' }, '100% Client-Side & Zero Telemetry'),
              el('span', { className: 'text-[12px] text-[#86868b]' }, 'Built with pdf-lib, pdfjs-dist & fflate')
            ),
            el(
              'a',
              {
                href: sanitizeExternalUrl('https://github.com/fadhilahkholiq/poffy-web') || '#',
                target: '_blank',
                rel: 'noopener noreferrer',
                className:
                  'inline-flex items-center gap-1.5 self-center sm:self-auto w-fit px-3 py-1.5 rounded-full bg-[#f2f2f7] border border-black/[0.06] text-[#1d1d1f] font-medium no-underline hover:bg-[#e5e5ea] transition-colors'
              },
              svgEl(
                'svg',
                {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 24 24',
                  fill: 'currentColor',
                  'aria-hidden': 'true'
                },
                svgEl('path', {
                  d: 'M12 0.5C5.37 0.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.4s2.04.14 3 .4c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .32.22.7.83.58C20.57 22.3 24 17.8 24 12.5 24 5.87 18.63 0.5 12 0.5z'
                })
              ),
              'GitHub'
            )
          )
        )
      )
  );

  const shell = el(
    'div',
    { className: 'min-h-screen flex flex-col bg-white text-[#1d1d1f]' },
    navSlot,
    overlaysSlot,
    workspaceSlot,
    preFooterHero,
    footerEl,
    fileInput
  );

  mount(root, shell);
  bindWindowDropOverlay();

  const openFilePicker = () => {
    fileInput.click();
  };

  fileInput.addEventListener('change', async () => {
    if (fileInput.files?.length) {
      await ingestFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  // Allow workers to resync sources automatically if hard-terminated via cancel
  const getSources = () => [...workspace.sourceFiles.values()];
  pdfOpsClient.setSourceProvider(getSources);
  pdfRenderClient.setSourceProvider(getSources);

  // Wire aggressive memory cleanup hooks between workspace store and workers
  workspace.onSourceEvict((sourceFileId) => {
    pdfRenderClient.evictSource(sourceFileId);
    pdfOpsClient.evictSource(sourceFileId);
  });
  workspace.onWorkspaceClear(() => {
    pdfRenderClient.clearAll();
    pdfOpsClient.clearAll();
  });

  /** @type {() => void} */
  let cleanupHero = () => {};
  /** @type {() => void} */
  let cleanupGrid = () => {};
  /** @type {boolean|null} */
  let lastHasPages = null;
  /** @type {HTMLElement|null} */
  let railSlot = null;
  /** @type {HTMLElement|null} */
  let gridSlot = null;
  /** @type {HTMLElement|null} */
  let inspectorSlot = null;

  const renderWorkspaceLayout = () => {
    const hasPages = workspace.pages.length > 0;

    if (!hasPages) {
      cleanupGrid();
      cleanupGrid = () => {};
      cleanupHero();
      railSlot = null;
      gridSlot = null;
      inspectorSlot = null;
      footerEl.className = 'border-t border-black/[0.08] bg-white';
      if (activeInfoPage) {
        renderInfoPage(workspaceSlot, activeInfoPage, openFilePicker);
        cleanupHero = () => {};
      } else {
        cleanupHero = renderHeroDropzone(workspaceSlot, openFilePicker, activeFeature);
      }
      lastHasPages = false;
      return;
    }

    if (lastHasPages !== true) {
      cleanupHero();
      cleanupHero = () => {};
      footerEl.className = 'border-t border-black/[0.08] bg-white';
      railSlot = el('section', {
        id: 'tool-rail-slot',
        className: 'studio-pane-left',
        'aria-label': 'Studio tools'
      });
      gridSlot = el('section', {
        id: 'grid-slot',
        className: 'studio-pane-center',
        'aria-label': 'Workspace pages'
      });
      inspectorSlot = el('section', {
        id: 'inspector-slot',
        className: 'studio-pane-right',
        'aria-label': 'PDF tools inspector'
      });
      mount(
        workspaceSlot,
        el(
          'main',
          {
            className: 'studio-3pane border-b border-[#e5e5e5]'
          },
          el('h1', { className: 'sr-only' }, 'Poffy · Offline PDF Studio Workspace'),
          railSlot,
          gridSlot,
          inspectorSlot
        )
      );
      lastHasPages = true;
    }

    if (railSlot) {
      renderToolRail(railSlot);
    }
    if (gridSlot) {
      cleanupGrid();
      cleanupGrid = renderPageGrid(gridSlot);
    }
    if (inspectorSlot) {
      renderToolInspector(inspectorSlot);
    }
  };

  // Initial render
  renderTopNav(navSlot, openFilePicker);
  renderOverlays(overlaysSlot);
  renderWorkspaceLayout();

  // Granular reactive updates
  workspace.subscribe((topic) => {
    if (topic === 'job' || topic === 'notice' || topic === 'preview') {
      renderOverlays(overlaysSlot);
      if (topic === 'job') renderTopNav(navSlot, openFilePicker);
      return;
    }

    if (topic === 'filter-preview') {
      updateFilterPreviewDom();
      return;
    }

    if (topic === 'tool') {
      renderOverlays(overlaysSlot);
      if (railSlot) {
        renderToolRail(railSlot);
      }
      if (inspectorSlot) {
        renderToolInspector(inspectorSlot);
      }
      return;
    }

    if (topic === 'files' || topic === 'pages') {
      renderTopNav(navSlot, openFilePicker);
      renderOverlays(overlaysSlot);
      renderWorkspaceLayout();
      return;
    }

    renderTopNav(navSlot, openFilePicker);
    renderOverlays(overlaysSlot);
    renderWorkspaceLayout();
  });

  window.addEventListener('online', () => renderTopNav(navSlot, openFilePicker));
  window.addEventListener('offline', () => renderTopNav(navSlot, openFilePicker));

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    workspace.showNotice(
      'error',
      reason?.code === 'ENCRYPTED_PDF' ? 'Encrypted PDF' : 'Unexpected Error',
      reason?.message || 'An unhandled operation failed.'
    );
  });

  window.addEventListener('error', (event) => {
    if (event.message) {
      workspace.showNotice('error', 'Application Error', event.message);
    }
  });

  initOfflineServiceWorker();
}

bootstrap();
