import { formatBytes } from '../../core/utils/file-io.js';
import { createUuid, workspace } from '../../state/workspace.js';
import {
  clearCompareResults,
  loadRedactPreview,
  loadSignPreview,
  runComparePdfJob,
  runExportDiffReportJob,
  runFindRedactionMatchesJob,
  runRedactPdfJob,
  runSignAnnotateJob,
  setCompareFile,
  useWorkspacePdfForCompare
} from '../actions/export-runner.js';
import { el, sanitizeImageSrc } from '../utils/dom.js';
import { createClaySelect } from './ClaySelect.js';
import {
  TYPED_SIGNATURE_STYLES,
  clearSavedSignaturesLocally,
  loadSavedSignatures,
  normalizeSignatureImageFile,
  pngDataUrlToBytes,
  renderTypedSignaturePng,
  saveSignatureLocally,
  trimCanvasToTransparentPng
} from '../utils/signature-pad.js';

const sigTrayBlobUrls = new Map();
/** @type {Map<string, string>} */
const overlaySigBlobUrls = new Map();
/** @type {HTMLCanvasElement|null} */
let persistentPadCanvas = null;
let persistentPadColor = '#0a0a0a';
let persistentPadStroke = 2.5;
let signAsideScrollTop = 0;
let signStageScrollTop = 0;

/**
 * Resolves an independent `blob:` ObjectURL for a placed signature overlay so changing
 * the active brush/typed signature never revokes previews already placed on pages.
 * @param {{ id: string, imageBytes?: Uint8Array|ArrayBuffer }} ov
 * @returns {string|null}
 */
function getOverlaySignatureBlobUrl(ov) {
  if (!ov?.id || !ov.imageBytes) return null;
  if (overlaySigBlobUrls.has(ov.id)) {
    return overlaySigBlobUrls.get(ov.id) || null;
  }
  const raw = ov.imageBytes instanceof Uint8Array ? ov.imageBytes : new Uint8Array(ov.imageBytes);
  const url = URL.createObjectURL(new Blob([raw], { type: 'image/png' }));
  overlaySigBlobUrls.set(ov.id, url);
  return url;
}

/**
 * Revokes cached ObjectURLs for signature overlays that were removed from the workspace.
 * @param {{ id: string }[]} activeOverlays
 */
function pruneRemovedOverlayUrls(activeOverlays) {
  const activeIds = new Set(activeOverlays.map((o) => o.id));
  for (const [id, url] of overlaySigBlobUrls.entries()) {
    if (!activeIds.has(id)) {
      URL.revokeObjectURL(url);
      overlaySigBlobUrls.delete(id);
    }
  }
}

/**
 * Returns the persistent Bezier draw canvas so strokes are preserved across inspector re-renders.
 * @param {string} color
 * @param {number} strokeWidth
 * @returns {HTMLCanvasElement}
 */
function getPersistentDrawCanvas(color, strokeWidth) {
  persistentPadColor = color || '#0a0a0a';
  persistentPadStroke = Math.max(2, Number(strokeWidth) || 2.5);
  if (persistentPadCanvas) return persistentPadCanvas;

  const canvas = /** @type {HTMLCanvasElement} */ (
    el('canvas', {
      id: 'sign-draw-canvas',
      width: 360,
      height: 135,
      className: 'w-full aspect-[8/3] rounded-[10px] border border-[#e5e5e5] bg-white cursor-crosshair touch-none'
    })
  );
  const ctx = canvas.getContext('2d');
  if (ctx) {
    let drawing = false;
    let moved = false;
    /** @type {{ x: number, y: number }[]} */
    let pts = [];
    const getPt = (ev) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        y: ((ev.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height
      };
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      drawing = true;
      moved = false;
      const p0 = getPt(e);
      pts = [p0];
      ctx.strokeStyle = persistentPadColor;
      ctx.fillStyle = persistentPadColor;
      ctx.lineWidth = persistentPadStroke;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = getPt(e);
      moved = true;
      pts.push(p);
      if (pts.length >= 3) {
        const pPrev2 = pts[pts.length - 3];
        const pPrev = pts[pts.length - 2];
        const startMidX = (pPrev2.x + pPrev.x) / 2;
        const startMidY = (pPrev2.y + pPrev.y) / 2;
        const endMidX = (pPrev.x + p.x) / 2;
        const endMidY = (pPrev.y + p.y) / 2;
        ctx.beginPath();
        ctx.moveTo(pts.length === 3 ? pPrev2.x : startMidX, pts.length === 3 ? pPrev2.y : startMidY);
        ctx.quadraticCurveTo(pPrev.x, pPrev.y, endMidX, endMidY);
        ctx.stroke();
      } else if (pts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo((pts[0].x + p.x) / 2, (pts[0].y + p.y) / 2);
        ctx.stroke();
      }
    });
    const endDraw = () => {
      if (!drawing) return;
      drawing = false;
      if (!moved && pts[0]) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, persistentPadStroke * 0.65, 0, Math.PI * 2);
        ctx.fill();
      } else if (pts.length >= 2) {
        const prev = pts[pts.length - 2];
        const last = pts[pts.length - 1];
        ctx.beginPath();
        ctx.moveTo((prev.x + last.x) / 2, (prev.y + last.y) / 2);
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }
      pts = [];
    };
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
  }
  persistentPadCanvas = canvas;
  return canvas;
}

/**
 * Resolves a safe `blob:` ObjectURL for a saved localStorage signature entry.
 * @param {{ id: string, dataUrl: string }} entry
 * @returns {string}
 */
function getSavedSignatureBlobUrl(entry) {
  if (sigTrayBlobUrls.has(entry.id)) {
    return sigTrayBlobUrls.get(entry.id);
  }
  const bytes = pngDataUrlToBytes(entry.dataUrl);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  sigTrayBlobUrls.set(entry.id, url);
  return url;
}

/**
 * Renders the interactive True Redaction Studio modal (FEAT-01).
 * @returns {HTMLElement|null}
 */
export function renderRedactStudioModal() {
  const r = workspace.tools.redact;
  if (!r.modalOpen) return null;

  const src = r.targetFileId ? workspace.sourceFiles.get(r.targetFileId) : null;
  const pageCount = src?.pageCount || 1;
  const safePageIdx = Math.max(0, Math.min(pageCount - 1, Number(r.activePageIndex) || 0));
  r.activePageIndex = safePageIdx;

  if (src && r.previewPageIndex !== safePageIdx && !r.previewLoading) {
    queueMicrotask(() => {
      loadRedactPreview();
    });
  }

  const pageMarks = r.marks.filter((m) => m.pageIndex === safePageIdx);
  const draftRectEl = el('div', {
    className:
      'hidden absolute border-2 border-dashed border-[#ef4444] bg-[#ef4444]/25 pointer-events-none'
  });

  const stageWrap = el(
    'div',
    {
      id: 'redact-canvas-stage',
      className:
        'relative inline-block select-none touch-none cursor-crosshair bg-white rounded-[8px] shadow-md overflow-hidden max-w-full',
      onPointerdown: (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('button')) return;
        const stage = /** @type {HTMLElement} */ (e.currentTarget);
        const rect = stage.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;
        stage.setPointerCapture?.(e.pointerId);

        const startX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const startY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        let curX = startX;
        let curY = startY;

        draftRectEl.classList.remove('hidden');
        const syncDraft = () => {
          const x = Math.min(startX, curX);
          const y = Math.min(startY, curY);
          const w = Math.abs(curX - startX);
          const h = Math.abs(curY - startY);
          draftRectEl.style.left = `${x}px`;
          draftRectEl.style.top = `${y}px`;
          draftRectEl.style.width = `${w}px`;
          draftRectEl.style.height = `${h}px`;
        };
        syncDraft();

        const onMove = (ev) => {
          curX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          curY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          syncDraft();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          draftRectEl.classList.add('hidden');
          const w = Math.abs(curX - startX);
          const h = Math.abs(curY - startY);
          if (w >= 6 && h >= 6) {
            r.marks.push({
              id: createUuid(),
              pageIndex: safePageIdx,
              nx: Math.min(startX, curX) / rect.width,
              ny: Math.min(startY, curY) / rect.height,
              nw: w / rect.width,
              nh: h / rect.height,
              sourceLabel: 'Manual box'
            });
            workspace.emit('tool');
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
    },
    r.previewLoading
      ? el('div', { className: 'w-[420px] h-[540px] flex items-center justify-center text-[13px] text-[#6a6a6a]' }, 'Rendering page preview...')
      : sanitizeImageSrc(r.previewUrl)
        ? el('img', {
            src: sanitizeImageSrc(r.previewUrl),
            alt: `Redaction page ${safePageIdx + 1}`,
            draggable: false,
            className: 'block max-h-[70vh] w-auto pointer-events-none'
          })
        : el('div', { className: 'w-[420px] h-[540px] flex items-center justify-center text-[13px] text-[#6a6a6a]' }, 'Select a PDF to redact.'),
    ...pageMarks.map((mark) =>
      el(
        'div',
        {
          className: 'absolute border-2 border-[#ef4444]',
          style: {
            left: `${mark.nx * 100}%`,
            top: `${mark.ny * 100}%`,
            width: `${mark.nw * 100}%`,
            height: `${mark.nh * 100}%`,
            backgroundColor: r.fillColor || '#000000',
            opacity: '0.88'
          }
        },
        el(
          'button',
          {
            type: 'button',
            title: 'Remove redaction mark',
            className:
              'absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full bg-[#ef4444] text-white text-[11px] font-bold flex items-center justify-center shadow cursor-pointer',
            onClick: (ev) => {
              ev.stopPropagation();
              r.marks = r.marks.filter((item) => item.id !== mark.id);
              workspace.emit('tool');
            }
          },
          '×'
        )
      )
    ),
    draftRectEl
  );

  const searchInput = /** @type {HTMLInputElement} */ (
    el('input', {
      id: 'redact-modal-query',
      type: 'text',
      placeholder: r.searchMode === 'regex' ? 'Regex e.g. \\b\\d{4}\\b' : 'Keyword to redact...',
      value: r.searchQuery,
      className: 'input-clay !h-9 text-[12px]',
      onInput: (e) => {
        r.searchQuery = /** @type {HTMLInputElement} */ (e.target).value;
      }
    })
  );
  searchInput.value = r.searchQuery;

  const searchModeSelect = createClaySelect({
    className: 'input-clay !h-9 text-[12px]',
    currentValue: r.searchMode,
    options: [
      ['keyword', 'Keyword'],
      ['regex', 'Regex Pattern'],
      ['email', 'Preset: Emails'],
      ['phone', 'Preset: Phone Numbers'],
      ['ssn', 'Preset: SSN/ID']
    ],
    onChange: (val) => {
      r.searchMode = val;
      workspace.emit('tool');
    }
  });

  return el(
    'div',
    {
      id: 'redact-studio-backdrop',
      className: 'fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'True Redaction Studio',
      onClick: (e) => {
        if (e.target === e.currentTarget) {
          r.modalOpen = false;
          workspace.emit('tool');
        }
      }
    },
    el(
      'div',
      {
        className:
          'w-full max-w-6xl max-h-[92vh] rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] shadow-2xl flex flex-col overflow-hidden'
      },
      el(
        'div',
        { className: 'px-5 py-3.5 border-b border-[#e5e5e5] flex flex-wrap items-center justify-between gap-3 bg-white' },
        el(
          'div',
          { className: 'flex items-center gap-2.5' },
          el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'True Redaction Studio'),
          el('span', { className: 'badge-pill bg-[#1a3a3a] text-white' }, `${r.marks.length} total mark${r.marks.length === 1 ? '' : 's'}`)
        ),
        el(
          'div',
          { className: 'flex items-center gap-2' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-compact',
              disabled: safePageIdx <= 0,
              onClick: () => {
                r.activePageIndex = Math.max(0, safePageIdx - 1);
                loadRedactPreview();
              }
            },
            '← Prev'
          ),
          el('span', { className: 'text-[12px] font-medium px-2' }, `Page ${safePageIdx + 1} / ${pageCount}`),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-compact',
              disabled: safePageIdx >= pageCount - 1,
              onClick: () => {
                r.activePageIndex = Math.min(pageCount - 1, safePageIdx + 1);
                loadRedactPreview();
              }
            },
            'Next →'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'redact-modal-close',
              className: 'btn-compact',
              onClick: () => {
                r.modalOpen = false;
                workspace.emit('tool');
              }
            },
            'Close'
          )
        )
      ),
      el(
        'div',
        { className: 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden' },
        el(
          'aside',
          { className: 'lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#e5e5e5] p-4 overflow-y-auto space-y-3.5 bg-[#fffaf0]' },
          el(
            'div',
            { className: 'p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] space-y-2' },
            el('p', { className: 'text-[12px] font-semibold text-[#0a0a0a]' }, 'Search & Auto-Mark Text'),
            searchModeSelect,
            r.searchMode === 'keyword' || r.searchMode === 'regex' ? searchInput : null,
            el(
              'button',
              {
                type: 'button',
                id: 'redact-search-mark-btn',
                className: 'btn-secondary w-full !h-9 !text-[12px]',
                onClick: runFindRedactionMatchesJob
              },
              'Find & Mark Matches'
            )
          ),
          el(
            'div',
            { className: 'p-3 rounded-[12px] bg-white border border-[#e5e5e5] space-y-2' },
            el(
              'div',
              { className: 'flex items-center justify-between' },
              el('span', { className: 'text-[12px] font-semibold text-[#0a0a0a]' }, `Page ${safePageIdx + 1} Marks (${pageMarks.length})`),
              pageMarks.length > 0
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: 'text-[11px] text-[#ef4444] hover:underline',
                      onClick: () => {
                        r.marks = r.marks.filter((m) => m.pageIndex !== safePageIdx);
                        workspace.emit('tool');
                      }
                    },
                    'Clear Page'
                  )
                : null
            ),
            pageMarks.length === 0
              ? el('p', { className: 'text-[11px] text-[#6a6a6a]' }, 'Click and drag directly on the page preview to draw a redaction box.')
              : el(
                  'div',
                  { className: 'space-y-1 max-h-36 overflow-y-auto' },
                  pageMarks.map((mark, idx) =>
                    el(
                      'div',
                      { className: 'flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#faf5e8] text-[11px]' },
                      el('span', { className: 'truncate' }, `${idx + 1}. ${mark.sourceLabel || 'Box'}`),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'text-[#ef4444] font-bold',
                          onClick: () => {
                            r.marks = r.marks.filter((item) => item.id !== mark.id);
                            workspace.emit('tool');
                          }
                        },
                        '×'
                      )
                    )
                  )
                )
          ),
          el(
            'div',
            { className: 'grid grid-cols-2 gap-2' },
            el(
              'label',
              { className: 'text-[12px] text-[#6a6a6a] block' },
              'Burn DPI',
              createClaySelect({
                className: 'input-clay !h-9 mt-1',
                currentValue: String(r.dpi),
                options: [
                  ['200', '200 DPI'],
                  ['250', '250 DPI'],
                  ['300', '300 DPI']
                ],
                onChange: (val) => {
                  r.dpi = Number(val) || 220;
                }
              })
            ),
            el(
              'label',
              { className: 'text-[12px] text-[#6a6a6a] block' },
              'Mask Color',
              el('input', {
                type: 'color',
                value: r.fillColor,
                className: 'input-clay !h-9 !p-1 mt-1 cursor-pointer',
                onInput: (e) => {
                  r.fillColor = /** @type {HTMLInputElement} */ (e.target).value;
                  workspace.emit('tool');
                }
              })
            )
          ),
          el(
            'label',
            { className: 'flex items-start gap-2 p-2.5 rounded-[12px] bg-[#fef2f2] border border-[#ef4444]/30 cursor-pointer text-[12px]' },
            el('input', {
              type: 'checkbox',
              checked: Boolean(r.paranoidMode),
              className: 'w-4 h-4 accent-[#ef4444] mt-0.5',
              onChange: (e) => {
                r.paranoidMode = /** @type {HTMLInputElement} */ (e.target).checked;
                workspace.emit('tool');
              }
            }),
            el(
              'span',
              {},
              el('strong', { className: 'block text-[#991b1b]' }, 'Paranoid Mode'),
              el('span', { className: 'text-[#7f1d1d]' }, 'Raster-burn ALL pages & run deep XMP/Info/script scrub.')
            )
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'redact-burn-export-btn',
              className: 'btn-primary w-full',
              onClick: runRedactPdfJob
            },
            'Burn Redactions & Export PDF'
          )
        ),
        el(
          'div',
          { className: 'lg:col-span-8 bg-[#f5f0e0] overflow-auto p-4 sm:p-6 flex items-start justify-center' },
          stageWrap
        )
      )
    )
  );
}

/**
 * Renders the interactive e-Signature & Vector Annotator Studio modal (FEAT-02).
 * @returns {HTMLElement|null}
 */
export function renderSignStudioModal() {
  const s = workspace.tools.sign;
  if (!s.modalOpen) {
    pruneRemovedOverlayUrls(s.overlays);
    return null;
  }

  pruneRemovedOverlayUrls(s.overlays);
  const src = s.targetFileId ? workspace.sourceFiles.get(s.targetFileId) : null;
  const pageCount = src?.pageCount || 1;
  const safePageIdx = Math.max(0, Math.min(pageCount - 1, Number(s.activePageIndex) || 0));
  s.activePageIndex = safePageIdx;

  if (src && s.previewPageIndex !== safePageIdx && !s.previewLoading) {
    queueMicrotask(() => {
      loadSignPreview();
    });
  }

  const pageOverlays = s.overlays.filter((o) => o.pageIndex === safePageIdx);
  const selected = s.overlays.find((o) => o.id === s.selectedOverlayId) || null;
  const savedTrays = loadSavedSignatures();
  const padCanvas = getPersistentDrawCanvas(s.color, s.strokeWidth);

  const applyNewSignatureAsset = (asset, label, alsoSave) => {
    if (!asset) return;
    if (s.activeSigPreviewUrl && s.activeSigPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(s.activeSigPreviewUrl);
    }
    const blobUrl = URL.createObjectURL(new Blob([asset.bytes], { type: 'image/png' }));
    s.activeSigBytes = asset.bytes;
    s.activeSigPreviewUrl = blobUrl;
    s.activeSigAspect = Math.max(0.25, asset.width / Math.max(1, asset.height));
    s.activeKind = 'signature';
    if (alsoSave && asset.dataUrl) {
      saveSignatureLocally({
        id: createUuid(),
        dataUrl: asset.dataUrl,
        width: asset.width,
        height: asset.height,
        label
      });
    }
    workspace.emit('tool');
  };

  const placeOverlayAt = (kind, nx = 0.3, ny = 0.35, nw = 0.28, nh = 0.1) => {
    if (kind === 'signature' && !s.activeSigBytes) {
      workspace.showNotice('warning', 'Create Signature First', 'Draw, type, or upload a signature before placing.');
      return;
    }
    const id = createUuid();
    let finalNh = nh;
    if (kind === 'signature' && s.activeSigAspect > 0) {
      const stageAspect = s.previewHeight > 0 && s.previewWidth > 0 ? s.previewWidth / s.previewHeight : 0.72;
      finalNh = Math.max(0.04, Math.min(0.45, (nw * stageAspect) / s.activeSigAspect));
    } else if (kind === 'highlight') {
      finalNh = 0.04;
    } else if (kind === 'line' || kind === 'arrow') {
      finalNh = 0.06;
    } else if (kind === 'check') {
      nw = 0.07;
      finalNh = 0.07;
    }
    const ovEntry = {
      id,
      pageIndex: safePageIdx,
      kind,
      nx: Math.max(0.02, Math.min(0.95 - nw, nx)),
      ny: Math.max(0.02, Math.min(0.95 - finalNh, ny)),
      nw,
      nh: finalNh,
      rotation: 0,
      color: kind === 'highlight' && s.color === '#0a0a0a' ? '#facc15' : s.color,
      opacity: kind === 'highlight' ? 0.35 : s.opacity,
      strokeWidth: s.strokeWidth,
      text: kind === 'text' ? s.textValue : '',
      fontSize: s.fontSize,
      fontFamily: 'Helvetica',
      imageBytes: kind === 'signature' ? new Uint8Array(s.activeSigBytes) : undefined,
      imageAspect: kind === 'signature' ? s.activeSigAspect : undefined,
      imageFormat: 'png'
    };
    if (ovEntry.kind === 'signature') {
      getOverlaySignatureBlobUrl(ovEntry);
    }
    s.overlays.push(ovEntry);
    s.selectedOverlayId = id;
    workspace.emit('tool');
  };

  /**
   * Auto-captures a drawn or typed signature if the user taps the PDF page directly
   * before clicking "Use & Save Signature".
   */
  const autoCaptureAndPlaceSignature = async (nx, ny) => {
    if (s.activeSigBytes) {
      placeOverlayAt('signature', nx, ny, 0.28, 0.1);
      return;
    }
    if (s.sigMode === 'draw') {
      const trimmed = await trimCanvasToTransparentPng(padCanvas, 6);
      if (trimmed) {
        applyNewSignatureAsset(trimmed, 'Drawn', true);
        placeOverlayAt('signature', nx, ny, 0.28, 0.1);
        return;
      }
    } else if (s.sigMode === 'type' && s.typedText.trim()) {
      const rendered = await renderTypedSignaturePng(s.typedText, s.typedStyle, s.color);
      if (rendered) {
        applyNewSignatureAsset(rendered, s.typedText.trim().slice(0, 14), true);
        placeOverlayAt('signature', nx, ny, 0.28, 0.1);
        return;
      }
    }
    workspace.showNotice('warning', 'Create Signature First', 'Draw, type, or upload a signature before placing.');
  };

  const draftOverlayEl = el('div', {
    className: 'hidden absolute border-2 border-dashed border-[#ff4d8b] bg-[#ff4d8b]/15 pointer-events-none'
  });

  const stageWrap = el(
    'div',
    {
      id: 'sign-canvas-stage',
      className:
        'relative inline-block select-none touch-none bg-white rounded-[8px] shadow-md overflow-hidden max-w-full',
      onPointerdown: (e) => {
        if (/** @type {HTMLElement} */ (e.target).closest('[data-overlay-item]')) return;
        const stage = /** @type {HTMLElement} */ (e.currentTarget);
        const rect = stage.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) return;

        if (s.activeKind === 'signature') {
          const cx = (e.clientX - rect.left) / rect.width;
          const cy = (e.clientY - rect.top) / rect.height;
          void autoCaptureAndPlaceSignature(cx - 0.14, cy - 0.05);
          return;
        }

        stage.setPointerCapture?.(e.pointerId);
        const startX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const startY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        let curX = startX;
        let curY = startY;
        draftOverlayEl.classList.remove('hidden');

        const syncDraft = () => {
          draftOverlayEl.style.left = `${Math.min(startX, curX)}px`;
          draftOverlayEl.style.top = `${Math.min(startY, curY)}px`;
          draftOverlayEl.style.width = `${Math.abs(curX - startX)}px`;
          draftOverlayEl.style.height = `${Math.abs(curY - startY)}px`;
        };
        syncDraft();

        const onMove = (ev) => {
          curX = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          curY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
          syncDraft();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          draftOverlayEl.classList.add('hidden');
          const w = Math.abs(curX - startX);
          const h = Math.abs(curY - startY);
          if (w < 8 && h < 8) {
            placeOverlayAt(
              s.activeKind,
              startX / rect.width - 0.1,
              startY / rect.height - 0.03,
              0.22,
              0.06
            );
          } else {
            placeOverlayAt(
              s.activeKind,
              Math.min(startX, curX) / rect.width,
              Math.min(startY, curY) / rect.height,
              Math.max(0.04, w / rect.width),
              Math.max(0.03, h / rect.height)
            );
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      }
    },
    s.previewLoading
      ? el('div', { className: 'w-[420px] h-[540px] flex items-center justify-center text-[13px] text-[#6a6a6a]' }, 'Rendering page preview...')
      : sanitizeImageSrc(s.previewUrl)
        ? el('img', {
            src: sanitizeImageSrc(s.previewUrl),
            alt: `Annotate page ${safePageIdx + 1}`,
            draggable: false,
            className: 'block max-h-[70vh] w-auto pointer-events-none'
          })
        : el('div', { className: 'w-[420px] h-[540px] flex items-center justify-center text-[13px] text-[#6a6a6a]' }, 'Select a PDF to sign.'),
    ...pageOverlays.map((ov) => {
      const isSel = ov.id === s.selectedOverlayId;
      let innerPreview = null;
      const sigImgUrl = ov.kind === 'signature' ? sanitizeImageSrc(getOverlaySignatureBlobUrl(ov)) : null;
      if (ov.kind === 'signature' && sigImgUrl) {
        innerPreview = el('img', {
          src: sigImgUrl,
          alt: 'Placed signature',
          draggable: false,
          className: 'w-full h-full object-contain pointer-events-none'
        });
      } else if (ov.kind === 'text') {
        innerPreview = el(
          'div',
          {
            className: 'w-full h-full flex items-center px-1 leading-tight overflow-hidden pointer-events-none font-medium',
            style: { color: ov.color, fontSize: `${Math.max(10, Math.round((ov.fontSize || 14) * 0.9))}px` }
          },
          ov.text || 'Text'
        );
      } else if (ov.kind === 'highlight') {
        innerPreview = el('div', {
          className: 'w-full h-full pointer-events-none',
          style: { backgroundColor: ov.color, opacity: String(ov.opacity ?? 0.35) }
        });
      } else if (ov.kind === 'rect') {
        innerPreview = el('div', {
          className: 'w-full h-full pointer-events-none',
          style: { border: `${Math.max(1, ov.strokeWidth || 2)}px solid ${ov.color}`, opacity: String(ov.opacity ?? 1) }
        });
      } else if (ov.kind === 'ellipse') {
        innerPreview = el('div', {
          className: 'w-full h-full rounded-full pointer-events-none',
          style: { border: `${Math.max(1, ov.strokeWidth || 2)}px solid ${ov.color}`, opacity: String(ov.opacity ?? 1) }
        });
      } else if (ov.kind === 'line' || ov.kind === 'arrow') {
        innerPreview = el(
          'div',
          { className: 'w-full h-full flex items-center pointer-events-none relative' },
          el('div', { className: 'w-full', style: { height: `${Math.max(2, ov.strokeWidth || 2)}px`, backgroundColor: ov.color } }),
          ov.kind === 'arrow'
            ? el('span', { className: 'text-[14px] font-bold leading-none -ml-1', style: { color: ov.color } }, '▸')
            : null
        );
      } else if (ov.kind === 'check') {
        innerPreview = el(
          'div',
          { className: 'w-full h-full flex items-center justify-center font-bold text-[18px] pointer-events-none', style: { color: ov.color } },
          '✓'
        );
      }

      const boxEl = el(
        'div',
        {
          dataset: { overlayItem: ov.id },
          className: `absolute cursor-move ${isSel ? 'ring-2 ring-[#ff4d8b] bg-[#ff4d8b]/5' : 'hover:ring-1 hover:ring-[#0a0a0a]/40'}`,
          style: {
            left: `${ov.nx * 100}%`,
            top: `${ov.ny * 100}%`,
            width: `${ov.nw * 100}%`,
            height: `${ov.nh * 100}%`,
            transform: `rotate(${ov.rotation || 0}deg)`,
            transformOrigin: 'center center'
          },
          onPointerdown: (e) => {
            if (/** @type {HTMLElement} */ (e.target).dataset.resizeHandle) return;
            e.stopPropagation();
            s.selectedOverlayId = ov.id;
            const stageEl = document.getElementById('sign-canvas-stage');
            if (!stageEl) return;
            const sRect = stageEl.getBoundingClientRect();
            const originNx = ov.nx;
            const originNy = ov.ny;
            const startClientX = e.clientX;
            const startClientY = e.clientY;
            let moved = false;

            const onMove = (ev) => {
              moved = true;
              const dx = (ev.clientX - startClientX) / Math.max(1, sRect.width);
              const dy = (ev.clientY - startClientY) / Math.max(1, sRect.height);
              ov.nx = Math.max(0, Math.min(1 - ov.nw, originNx + dx));
              ov.ny = Math.max(0, Math.min(1 - ov.nh, originNy + dy));
              boxEl.style.left = `${ov.nx * 100}%`;
              boxEl.style.top = `${ov.ny * 100}%`;
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              if (moved || s.selectedOverlayId === ov.id) {
                workspace.emit('tool');
              }
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }
        },
        innerPreview,
        isSel
          ? el('div', {
              dataset: { resizeHandle: 'se' },
              title: 'Drag to resize',
              className: 'absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#ff4d8b] border-2 border-white cursor-se-resize shadow',
              onPointerdown: (e) => {
                e.stopPropagation();
                const stageEl = document.getElementById('sign-canvas-stage');
                if (!stageEl) return;
                const sRect = stageEl.getBoundingClientRect();
                const startW = ov.nw;
                const startH = ov.nh;
                const sx = e.clientX;
                const sy = e.clientY;
                const onMove = (ev) => {
                  const dw = (ev.clientX - sx) / Math.max(1, sRect.width);
                  const dh = (ev.clientY - sy) / Math.max(1, sRect.height);
                  const nextW = Math.max(0.04, Math.min(1 - ov.nx, startW + dw));
                  if (ov.kind === 'signature' && ov.imageAspect > 0) {
                    const stageRatio = sRect.width / Math.max(1, sRect.height);
                    const lockedH = (nextW * stageRatio) / ov.imageAspect;
                    if (ov.ny + lockedH <= 1) {
                      ov.nw = nextW;
                      ov.nh = Math.max(0.03, lockedH);
                    }
                  } else {
                    ov.nw = nextW;
                    ov.nh = Math.max(0.02, Math.min(1 - ov.ny, startH + dh));
                  }
                  boxEl.style.width = `${ov.nw * 100}%`;
                  boxEl.style.height = `${ov.nh * 100}%`;
                };
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                  workspace.emit('tool');
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              }
            })
          : null
      );
      return boxEl;
    }),
    draftOverlayEl
  );

  const modalAside = el(
    'aside',
    {
      className:
        'lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[#e5e5e5] p-4 overflow-y-auto space-y-3 bg-[#fffaf0]',
      onScroll: (e) => {
        signAsideScrollTop = /** @type {HTMLElement} */ (e.currentTarget).scrollTop;
      }
    },
    el(
      'div',
      { className: 'grid grid-cols-4 gap-1.5' },
      ...[
        ['signature', 'Sign'],
        ['text', 'Text'],
        ['highlight', 'Highlight'],
        ['rect', 'Rect'],
        ['ellipse', 'Ellipse'],
        ['arrow', 'Arrow'],
        ['line', 'Line'],
        ['check', 'Check ✓']
      ].map(([kind, label]) =>
        el(
          'button',
          {
            type: 'button',
            className: `h-8 rounded-[8px] text-[11px] font-medium border ${
              s.activeKind === kind
                ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]'
                : 'bg-white text-[#1a1a1a] border-[#e5e5e5]'
            }`,
            onClick: () => {
              s.activeKind = kind;
              workspace.emit('tool');
            }
          },
          label
        )
      )
    ),
    s.activeKind === 'signature'
      ? el(
          'div',
          { className: 'p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] space-y-2.5' },
          el(
            'div',
            { className: 'grid grid-cols-3 gap-1' },
            ...['draw', 'type', 'upload'].map((m) =>
              el(
                'button',
                {
                  type: 'button',
                  className: `h-7 rounded-[7px] text-[11px] font-medium ${
                    s.sigMode === m ? 'bg-[#0a0a0a] text-white' : 'bg-white border border-[#e5e5e5]'
                  }`,
                  onClick: () => {
                    s.sigMode = m;
                    workspace.emit('tool');
                  }
                },
                m.charAt(0).toUpperCase() + m.slice(1)
              )
            )
          ),
          s.sigMode === 'draw'
            ? el(
                'div',
                { className: 'space-y-2' },
                padCanvas,
                el(
                  'div',
                  { className: 'flex gap-1.5' },
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn-secondary !h-8 !px-2.5 !text-[11px]',
                      onClick: () => {
                        const ctx = padCanvas.getContext('2d');
                        ctx?.clearRect(0, 0, padCanvas.width, padCanvas.height);
                      }
                    },
                    'Clear'
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn-primary !h-8 flex-1 !text-[11px]',
                      onClick: async () => {
                        const trimmed = await trimCanvasToTransparentPng(padCanvas, 6);
                        if (!trimmed) {
                          workspace.showNotice('warning', 'Pad Empty', 'Draw your signature inside the pad first.');
                          return;
                        }
                        applyNewSignatureAsset(trimmed, 'Drawn', true);
                        workspace.showNotice(
                          'success',
                          'Signature Ready',
                          'Tap anywhere on the page preview or click "+ Place" to stamp it.'
                        );
                      }
                    },
                    'Use & Save Signature'
                  )
                ),
                el(
                  'p',
                  { className: 'text-[10px] text-[#6a6a6a]' },
                  'Draw above, then tap anywhere on the PDF page preview (or click + Place).'
                )
              )
            : s.sigMode === 'type'
              ? el(
                  'div',
                  { className: 'space-y-2' },
                  (() => {
                    const inp = /** @type {HTMLInputElement} */ (
                      el('input', {
                        type: 'text',
                        value: s.typedText,
                        placeholder: 'Type full name...',
                        className: 'input-clay !h-9 text-[13px]',
                        onInput: (e) => {
                          s.typedText = /** @type {HTMLInputElement} */ (e.target).value;
                        }
                      })
                    );
                    inp.value = s.typedText;
                    return inp;
                  })(),
                  el(
                    'div',
                    { className: 'grid grid-cols-3 gap-1' },
                    TYPED_SIGNATURE_STYLES.map((st) =>
                      el(
                        'button',
                        {
                          type: 'button',
                          className: `h-7 rounded text-[10px] border ${
                            s.typedStyle === st.id ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]' : 'bg-white border-[#e5e5e5]'
                          }`,
                          onClick: () => {
                            s.typedStyle = st.id;
                            workspace.emit('tool');
                          }
                        },
                        st.label.split(' ')[0]
                      )
                    )
                  ),
                  el(
                    'p',
                    { className: 'text-[10px] text-[#6a6a6a]' },
                    'Offline canvas typography (drop optional local cursive .ttf files in public/fonts/).'
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'btn-primary !h-8 w-full !text-[11px]',
                      onClick: async () => {
                        const rendered = await renderTypedSignaturePng(s.typedText, s.typedStyle, s.color);
                        if (!rendered) {
                          workspace.showNotice('warning', 'Name Empty', 'Enter your name before rendering.');
                          return;
                        }
                        applyNewSignatureAsset(rendered, s.typedText.slice(0, 14), true);
                        workspace.showNotice(
                          'success',
                          'Signature Ready',
                          'Tap anywhere on the page preview or click "+ Place" to stamp it.'
                        );
                      }
                    },
                    'Render & Use Typed Signature'
                  )
                )
              : el(
                  'div',
                  { className: 'space-y-2' },
                  el('input', {
                    type: 'file',
                    accept: 'image/png,image/webp,image/jpeg',
                    className: 'input-clay !h-9 !py-1.5 text-[11px]',
                    onChange: async (e) => {
                      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
                      if (!file) return;
                      const normalized = await normalizeSignatureImageFile(file);
                      applyNewSignatureAsset(normalized, file.name, true);
                    }
                  })
                ),
          sanitizeImageSrc(s.activeSigPreviewUrl)
            ? el(
                'div',
                { className: 'flex items-center justify-between gap-2 p-2 rounded bg-white border border-[#e5e5e5]' },
                el(
                  'div',
                  { className: 'flex items-center gap-2 min-w-0' },
                  el('img', { src: sanitizeImageSrc(s.activeSigPreviewUrl), alt: 'Active signature', className: 'h-8 max-w-[120px] object-contain' }),
                  el('span', { className: 'text-[10px] font-semibold text-[#15803d]' }, 'Ready')
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'btn-compact !h-7 shrink-0',
                    onClick: () => placeOverlayAt('signature', 0.35, 0.72, 0.28, 0.1)
                  },
                  '+ Place'
                )
              )
            : null,
          savedTrays.length > 0
            ? el(
                'div',
                { className: 'space-y-1 pt-1' },
                el(
                  'div',
                  { className: 'flex items-center justify-between text-[11px]' },
                  el('span', { className: 'text-[#6a6a6a] font-medium' }, 'Saved Local Tray'),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'text-[#ef4444] hover:underline',
                      onClick: () => {
                        clearSavedSignaturesLocally();
                        workspace.emit('tool');
                      }
                    },
                    'Clear Tray'
                  )
                ),
                el(
                  'div',
                  { className: 'flex flex-wrap gap-1.5' },
                  savedTrays.map((tray) => {
                    const trayUrl = getSavedSignatureBlobUrl(tray);
                    return el(
                      'button',
                      {
                        type: 'button',
                        className: 'p-1 rounded border border-[#e5e5e5] bg-white hover:border-[#0a0a0a]',
                        title: `Load ${tray.label || 'saved signature'}`,
                        onClick: () => {
                          const bytes = pngDataUrlToBytes(tray.dataUrl);
                          applyNewSignatureAsset(
                            { bytes, dataUrl: tray.dataUrl, width: tray.width || 240, height: tray.height || 90 },
                            tray.label,
                            false
                          );
                        }
                      },
                      el('img', { src: sanitizeImageSrc(trayUrl), alt: tray.label || 'Saved', className: 'h-6 w-auto object-contain' })
                    );
                  })
                )
              )
            : null
        )
      : null,
    s.activeKind === 'text'
      ? el(
          'div',
          { className: 'space-y-2' },
          (() => {
            const ti = /** @type {HTMLInputElement} */ (
              el('input', {
                type: 'text',
                value: s.textValue,
                placeholder: 'Annotation text...',
                className: 'input-clay !h-9 text-[12px]',
                onInput: (e) => {
                  s.textValue = /** @type {HTMLInputElement} */ (e.target).value;
                  if (selected && selected.kind === 'text') {
                    selected.text = s.textValue;
                  }
                }
              })
            );
            ti.value = selected?.kind === 'text' ? selected.text : s.textValue;
            return ti;
          })(),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-secondary !h-8 w-full !text-[11px]',
              onClick: () => placeOverlayAt('text', 0.2, 0.2, 0.35, 0.07)
            },
            '+ Place Text Callout'
          )
        )
      : null,
    el(
      'div',
      { className: 'grid grid-cols-2 gap-2' },
      el(
        'label',
        { className: 'text-[11px] text-[#6a6a6a] block' },
        'Color',
        el('input', {
          type: 'color',
          value: selected ? selected.color : s.color,
          className: 'input-clay !h-9 !p-1 mt-1 cursor-pointer',
          onInput: (e) => {
            const val = /** @type {HTMLInputElement} */ (e.target).value;
            s.color = val;
            if (selected) {
              selected.color = val;
              workspace.emit('tool');
            }
          }
        })
      ),
      el(
        'label',
        { className: 'text-[11px] text-[#6a6a6a] block' },
        'Stroke/Font',
        el('input', {
          type: 'number',
          min: '1',
          max: '48',
          value: String(selected ? (selected.kind === 'text' ? selected.fontSize : selected.strokeWidth) : (s.activeKind === 'text' ? s.fontSize : s.strokeWidth)),
          className: 'input-clay !h-9 mt-1',
          onInput: (e) => {
            const v = Number(/** @type {HTMLInputElement} */ (e.target).value) || 2;
            if (s.activeKind === 'text' || selected?.kind === 'text') {
              s.fontSize = v;
              if (selected) selected.fontSize = v;
            } else {
              s.strokeWidth = v;
              if (selected) selected.strokeWidth = v;
            }
          }
        })
      )
    ),
    selected
      ? el(
          'div',
          { className: 'p-2.5 rounded-[12px] bg-white border border-[#e5e5e5] space-y-2' },
          el(
            'div',
            { className: 'flex items-center justify-between text-[11px]' },
            el('span', { className: 'font-semibold' }, `Selected: ${selected.kind}`),
            el(
              'button',
              {
                type: 'button',
                className: 'text-[#ef4444] font-semibold',
                onClick: () => {
                  s.overlays = s.overlays.filter((o) => o.id !== selected.id);
                  s.selectedOverlayId = null;
                  workspace.emit('tool');
                }
              },
              'Delete'
            )
          ),
          el(
            'label',
            { className: 'text-[11px] text-[#6a6a6a] block' },
            `Rotation (${selected.rotation || 0}°)`,
            el('input', {
              type: 'range',
              min: '-180',
              max: '180',
              step: '5',
              value: String(selected.rotation || 0),
              className: 'w-full accent-[#0a0a0a]',
              onInput: (e) => {
                selected.rotation = Number(/** @type {HTMLInputElement} */ (e.target).value) || 0;
                const node = document.querySelector(`[data-overlay-item="${selected.id}"]`);
                if (node) /** @type {HTMLElement} */ (node).style.transform = `rotate(${selected.rotation}deg)`;
              }
            })
          )
        )
      : null,
    el(
      'button',
      {
        type: 'button',
        id: 'sign-export-btn',
        className: 'btn-primary w-full',
        disabled: s.overlays.length === 0,
        onClick: runSignAnnotateJob
      },
      'Apply Overlays & Download PDF'
    )
  );

  const modalStagePane = el(
    'div',
    {
      className: 'lg:col-span-8 bg-[#f5f0e0] overflow-auto p-4 sm:p-6 flex items-start justify-center',
      onScroll: (e) => {
        signStageScrollTop = /** @type {HTMLElement} */ (e.currentTarget).scrollTop;
      }
    },
    stageWrap
  );

  queueMicrotask(() => {
    modalAside.scrollTop = signAsideScrollTop;
    modalStagePane.scrollTop = signStageScrollTop;
  });

  return el(
    'div',
    {
      id: 'sign-studio-backdrop',
      className: 'fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'e-Signature and Vector Annotator Studio',
      onClick: (e) => {
        if (e.target === e.currentTarget) {
          s.modalOpen = false;
          workspace.emit('tool');
        }
      }
    },
    el(
      'div',
      {
        className:
          'w-full max-w-6xl max-h-[92vh] rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] shadow-2xl flex flex-col overflow-hidden'
      },
      el(
        'div',
        { className: 'px-5 py-3.5 border-b border-[#e5e5e5] flex flex-wrap items-center justify-between gap-3 bg-white' },
        el(
          'div',
          { className: 'flex items-center gap-2.5' },
          el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'e-Signature & Vector Annotator'),
          el('span', { className: 'badge-pill bg-[#ff4d8b] text-white' }, `${s.overlays.length} overlay${s.overlays.length === 1 ? '' : 's'}`)
        ),
        el(
          'div',
          { className: 'flex items-center gap-2' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn-compact',
              disabled: safePageIdx <= 0,
              onClick: () => {
                s.activePageIndex = Math.max(0, safePageIdx - 1);
                loadSignPreview();
              }
            },
            '← Prev'
          ),
          el('span', { className: 'text-[12px] font-medium px-2' }, `Page ${safePageIdx + 1} / ${pageCount}`),
          el(
            'button',
            {
              type: 'button',
              className: 'btn-compact',
              disabled: safePageIdx >= pageCount - 1,
              onClick: () => {
                s.activePageIndex = Math.min(pageCount - 1, safePageIdx + 1);
                loadSignPreview();
              }
            },
            'Next →'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'sign-modal-close',
              className: 'btn-compact',
              onClick: () => {
                s.modalOpen = false;
                workspace.emit('tool');
              }
            },
            'Close'
          )
        )
      ),
      el(
        'div',
        { className: 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden' },
        modalAside,
        modalStagePane
      )
    )
  );
}

/**
 * Renders the interactive Visual & Text Diff Studio modal (FEAT-03).
 * @returns {HTMLElement|null}
 */
export function renderCompareStudioModal() {
  const cmp = workspace.tools.compare;
  if (!cmp.modalOpen) return null;

  const pdfSources = [...workspace.sourceFiles.values()].filter((s) => s.type === 'pdf');
  const results = cmp.results;
  const visiblePages = results
    ? (cmp.changedOnly ? results.pages.filter((p) => p.status !== 'unchanged') : results.pages)
    : [];
  const safeActiveIdx = Math.max(0, Math.min(Math.max(0, visiblePages.length - 1), cmp.activePageIndex || 0));
  const activePage = visiblePages[safeActiveIdx] || null;

  const buildUploadZone = (slot, label, entry) =>
    el(
      'div',
      { className: 'p-3 rounded-[12px] bg-[#faf5e8] border border-[#e5e5e5] space-y-2' },
      el(
        'div',
        { className: 'flex items-center justify-between gap-2' },
        el('span', { className: 'text-[12px] font-semibold text-[#0a0a0a]' }, label),
        entry ? el('span', { className: 'text-[11px] text-[#6a6a6a]' }, formatBytes(entry.byteSize)) : null
      ),
      el(
        'p',
        { className: 'text-[12px] text-[#1a1a1a] truncate font-medium' },
        entry ? entry.name : 'No PDF loaded'
      ),
      el(
        'div',
        { className: 'flex flex-wrap gap-1.5' },
        el(
          'label',
          { className: 'btn-secondary !h-8 !px-2.5 !text-[11px] cursor-pointer inline-flex items-center' },
          'Choose PDF',
          el('input', {
            id: `compare-file-${slot.toLowerCase()}`,
            type: 'file',
            accept: '.pdf,application/pdf',
            className: 'hidden',
            onChange: async (e) => {
              const f = /** @type {HTMLInputElement} */ (e.target).files?.[0];
              if (f) await setCompareFile(slot, f);
            }
          })
        ),
        pdfSources.length > 0
          ? el(
              'button',
              {
                type: 'button',
                className: 'btn-compact !h-8',
                onClick: () => useWorkspacePdfForCompare(slot, pdfSources[0].id)
              },
              `Use ${pdfSources[0].name.slice(0, 12)}`
            )
          : null
      )
    );

  // Synchronized scroll panes
  const paneA = el('div', { className: 'flex-1 overflow-auto bg-white rounded-[10px] border border-[#e5e5e5] p-2 max-h-[60vh]' });
  const paneB = el('div', { className: 'flex-1 overflow-auto bg-white rounded-[10px] border border-[#e5e5e5] p-2 max-h-[60vh]' });
  let syncingScroll = false;
  const bindSync = (from, to) => {
    from.addEventListener('scroll', () => {
      if (syncingScroll) return;
      syncingScroll = true;
      to.scrollTop = from.scrollTop;
      to.scrollLeft = from.scrollLeft;
      syncingScroll = false;
    });
  };
  bindSync(paneA, paneB);
  bindSync(paneB, paneA);

  let viewerContent = el(
    'div',
    { className: 'h-full min-h-[320px] flex items-center justify-center text-[13px] text-[#6a6a6a] text-center p-6' },
    'Load Original (v1) and Revised (v2) PDFs above, then click Compare PDFs.'
  );

  if (activePage) {
    if (cmp.viewMode === 'side-by-side') {
      paneA.appendChild(el('p', { className: 'text-[11px] font-semibold text-[#6a6a6a] mb-1.5' }, `v1: ${cmp.fileA?.name || 'Original'}`));
      paneA.appendChild(
        sanitizeImageSrc(activePage.imageAUrl)
          ? el('img', { src: sanitizeImageSrc(activePage.imageAUrl), alt: 'Original v1 page', className: 'w-full h-auto block' })
          : el('div', { className: 'p-8 text-center text-[12px] text-[#ef4444]' }, 'Page absent in Original (Added in Revised)')
      );
      paneB.appendChild(el('p', { className: 'text-[11px] font-semibold text-[#6a6a6a] mb-1.5' }, `v2: ${cmp.fileB?.name || 'Revised'}`));
      paneB.appendChild(
        sanitizeImageSrc(activePage.imageBUrl)
          ? el('img', { src: sanitizeImageSrc(activePage.imageBUrl), alt: 'Revised v2 page', className: 'w-full h-auto block' })
          : el('div', { className: 'p-8 text-center text-[12px] text-[#ef4444]' }, 'Page removed in Revised')
      );
      viewerContent = el('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-3 w-full' }, paneA, paneB);
    } else if (cmp.viewMode === 'overlay') {
      viewerContent = el(
        'div',
        { className: 'w-full flex flex-col items-center gap-2' },
        el('div', { className: 'flex items-center gap-3 text-[11px]' },
          el('span', { className: 'inline-flex items-center gap-1' }, el('span', { className: 'w-2.5 h-2.5 rounded-full bg-[#ef4444]' }), 'Removed (v1)'),
          el('span', { className: 'inline-flex items-center gap-1' }, el('span', { className: 'w-2.5 h-2.5 rounded-full bg-[#22c55e]' }), 'Added (v2)')
        ),
        sanitizeImageSrc(activePage.diffUrl)
          ? el('img', { src: sanitizeImageSrc(activePage.diffUrl), alt: 'Visual pixel diff map', className: 'max-h-[62vh] w-auto rounded-[10px] border border-[#e5e5e5] bg-white shadow' })
          : null
      );
    } else if (cmp.viewMode === 'curtain') {
      const topLayer = el(
        'div',
        {
          className: 'absolute inset-0 overflow-hidden pointer-events-none',
          style: { clipPath: `inset(0 ${100 - (cmp.splitPercent || 50)}% 0 0)` }
        },
        sanitizeImageSrc(activePage.imageAUrl)
          ? el('img', { src: sanitizeImageSrc(activePage.imageAUrl), alt: 'v1 curtain', className: 'w-full h-auto block' })
          : null
      );
      const divider = el('div', {
        className: 'absolute top-0 bottom-0 w-0.5 bg-[#ff4d8b] pointer-events-none',
        style: { left: `${cmp.splitPercent || 50}%` }
      });
      viewerContent = el(
        'div',
        { className: 'w-full max-w-2xl mx-auto space-y-2' },
        el(
          'div',
          { className: 'relative rounded-[10px] overflow-hidden border border-[#e5e5e5] bg-white' },
          sanitizeImageSrc(activePage.imageBUrl)
            ? el('img', { src: sanitizeImageSrc(activePage.imageBUrl), alt: 'v2 base', className: 'w-full h-auto block' })
            : el('div', { className: 'h-64 flex items-center justify-center text-[12px]' }, 'Page absent in v2'),
          topLayer,
          divider
        ),
        el('input', {
          type: 'range',
          min: '0',
          max: '100',
          value: String(cmp.splitPercent || 50),
          className: 'w-full accent-[#0a0a0a] cursor-pointer',
          onInput: (e) => {
            const p = Number(/** @type {HTMLInputElement} */ (e.target).value) || 50;
            cmp.splitPercent = p;
            topLayer.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
            divider.style.left = `${p}%`;
          }
        })
      );
    } else {
      // Text Myers Diff
      const diffRows = activePage.textDiff || [];
      viewerContent = el(
        'div',
        { className: 'w-full bg-white rounded-[12px] border border-[#e5e5e5] p-3 max-h-[60vh] overflow-y-auto space-y-1 font-mono text-[12px]' },
        diffRows.length === 0
          ? el('p', { className: 'text-[#6a6a6a]' }, 'No extractable text layer on this page.')
          : diffRows.map((row) =>
              el(
                'div',
                {
                  className: `px-2 py-1 rounded ${
                    row.type === 'removed'
                      ? 'bg-[#fef2f2] text-[#991b1b]'
                      : row.type === 'added'
                        ? 'bg-[#f0fdf4] text-[#166534]'
                        : 'text-[#3a3a3a]'
                  }`
                },
                `${row.type === 'removed' ? '- ' : row.type === 'added' ? '+ ' : '  '}${row.value}`
              )
            )
      );
    }
  }

  return el(
    'div',
    {
      id: 'compare-studio-backdrop',
      className: 'fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-5',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Visual and Text Diff Studio',
      onClick: (e) => {
        if (e.target === e.currentTarget) {
          cmp.modalOpen = false;
          workspace.emit('tool');
        }
      }
    },
    el(
      'div',
      { className: 'w-full max-w-6xl max-h-[92vh] rounded-[24px] bg-[#fffaf0] border border-[#e5e5e5] shadow-2xl flex flex-col overflow-hidden' },
      el(
        'div',
        { className: 'px-5 py-3.5 border-b border-[#e5e5e5] flex flex-wrap items-center justify-between gap-3 bg-white' },
        el(
          'div',
          { className: 'flex items-center gap-2.5' },
          el('h3', { className: 'type-title-md text-[#0a0a0a]' }, 'Visual & Text Diff (Compare PDF)'),
          results
            ? el('span', { className: 'badge-pill bg-[#b8a4ed] text-[#0a0a0a]' }, `${results.pagesA}p vs ${results.pagesB}p`)
            : null
        ),
        el(
          'div',
          { className: 'flex items-center gap-2' },
          results
            ? el(
                'button',
                {
                  type: 'button',
                  id: 'compare-export-report-btn',
                  className: 'btn-secondary !h-8 !px-3 !text-[12px]',
                  onClick: runExportDiffReportJob
                },
                'Export Diff Report PDF'
              )
            : null,
          el(
            'button',
            {
              type: 'button',
              className: 'btn-compact',
              onClick: clearCompareResults
            },
            'Reset'
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'compare-modal-close',
              className: 'btn-compact',
              onClick: () => {
                cmp.modalOpen = false;
                workspace.emit('tool');
              }
            },
            'Close'
          )
        )
      ),
      el(
        'div',
        { className: 'p-4 border-b border-[#e5e5e5] grid grid-cols-1 md:grid-cols-3 gap-3 items-center bg-[#fffaf0]' },
        buildUploadZone('A', 'Original (v1)', cmp.fileA),
        buildUploadZone('B', 'Revised (v2)', cmp.fileB),
        el(
          'div',
          { className: 'space-y-2' },
          el(
            'label',
            { className: 'text-[11px] text-[#6a6a6a] block' },
            `Pixel Sensitivity (${cmp.sensitivity})`,
            el('input', {
              type: 'range',
              min: '5',
              max: '60',
              value: String(cmp.sensitivity),
              className: 'w-full accent-[#0a0a0a] mt-1',
              onInput: (e) => {
                cmp.sensitivity = Number(/** @type {HTMLInputElement} */ (e.target).value) || 24;
              }
            })
          ),
          el(
            'button',
            {
              type: 'button',
              id: 'compare-run-btn',
              className: 'btn-primary !h-9 w-full',
              disabled: !cmp.fileA || !cmp.fileB,
              onClick: runComparePdfJob
            },
            'Compare PDFs'
          )
        )
      ),
      el(
        'div',
        { className: 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden' },
        results
          ? el(
              'aside',
              { className: 'lg:col-span-3 border-b lg:border-b-0 lg:border-r border-[#e5e5e5] p-3 overflow-y-auto space-y-2 bg-[#fffaf0]' },
              el(
                'label',
                { className: 'flex items-center gap-2 text-[12px] font-medium cursor-pointer pb-1' },
                el('input', {
                  type: 'checkbox',
                  checked: Boolean(cmp.changedOnly),
                  className: 'w-4 h-4 accent-[#0a0a0a]',
                  onChange: (e) => {
                    cmp.changedOnly = /** @type {HTMLInputElement} */ (e.target).checked;
                    cmp.activePageIndex = 0;
                    workspace.emit('tool');
                  }
                }),
                'Show changed pages only'
              ),
              visiblePages.map((p, idx) =>
                el(
                  'button',
                  {
                    type: 'button',
                    className: `w-full text-left px-2.5 py-2 rounded-[10px] border text-[12px] flex items-center justify-between ${
                      idx === safeActiveIdx
                        ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]'
                        : 'bg-white text-[#1a1a1a] border-[#e5e5e5]'
                    }`,
                    onClick: () => {
                      cmp.activePageIndex = idx;
                      workspace.emit('tool');
                    }
                  },
                  el('span', { className: 'font-medium' }, `Page ${p.pageNumber}`),
                  el(
                    'span',
                    {
                      className: `text-[11px] font-semibold ${
                        idx === safeActiveIdx
                          ? 'text-white'
                          : p.status === 'unchanged'
                            ? 'text-[#6a6a6a]'
                            : p.status === 'removed'
                              ? 'text-[#ef4444]'
                              : 'text-[#16a34a]'
                      }`
                    },
                    p.status === 'unchanged' ? '0%' : `${p.changePercent}%`
                  )
                )
              )
            )
          : null,
        el(
          'div',
          { className: `${results ? 'lg:col-span-9' : 'lg:col-span-12'} bg-[#f5f0e0] p-4 overflow-auto flex flex-col gap-3` },
          results
            ? el(
                'div',
                { className: 'flex flex-wrap gap-1.5' },
                ...[
                  ['side-by-side', 'Side-by-Side Sync'],
                  ['overlay', 'Overlay Diff Map'],
                  ['curtain', 'Split-Slider Curtain'],
                  ['text', 'Text Myers Diff']
                ].map(([mode, label]) =>
                  el(
                    'button',
                    {
                      type: 'button',
                      className: `h-8 px-3 rounded-[9px] text-[12px] font-medium border ${
                        cmp.viewMode === mode
                          ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]'
                          : 'bg-white text-[#1a1a1a] border-[#e5e5e5]'
                      }`,
                      onClick: () => {
                        cmp.viewMode = mode;
                        workspace.emit('tool');
                      }
                    },
                    label
                  )
                )
              )
            : null,
          viewerContent
        )
      )
    )
  );
}
