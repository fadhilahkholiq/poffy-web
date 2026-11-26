import { workspace } from '../../state/workspace.js';

/**
 * Enables smooth HTML5 drag-and-drop page reordering on a page grid container.
 * Mutates only the lightweight Virtual Page Graph (never triggers pdf-lib).
 * @param {HTMLElement} gridEl
 * @returns {() => void} Cleanup callback
 */
export function bindSortablePageGrid(gridEl) {
  /** @type {number|null} */
  let dragFromIndex = null;

  const clearMarkers = () => {
    gridEl.querySelectorAll('.page-thumb-card').forEach((el) => {
      el.classList.remove('is-dragging', 'is-drag-target');
    });
  };

  const onDragStart = (e) => {
    const card = /** @type {HTMLElement|null} */ (e.target.closest('[data-page-index]'));
    if (!card || !e.dataTransfer) return;
    dragFromIndex = Number(card.dataset.pageIndex);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-poffy-page', String(dragFromIndex));
    card.classList.add('is-dragging');
  };

  const onDragOver = (e) => {
    if (dragFromIndex === null) return;
    const card = /** @type {HTMLElement|null} */ (e.target.closest('[data-page-index]'));
    if (!card) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    gridEl.querySelectorAll('.is-drag-target').forEach((el) => el.classList.remove('is-drag-target'));
    const targetIdx = Number(card.dataset.pageIndex);
    if (targetIdx !== dragFromIndex) {
      card.classList.add('is-drag-target');
    }
  };

  const onDrop = (e) => {
    if (dragFromIndex === null) return;
    const card = /** @type {HTMLElement|null} */ (e.target.closest('[data-page-index]'));
    e.preventDefault();
    if (card) {
      const toIndex = Number(card.dataset.pageIndex);
      workspace.reorderPage(dragFromIndex, toIndex);
    }
    dragFromIndex = null;
    clearMarkers();
  };

  const onDragEnd = () => {
    dragFromIndex = null;
    clearMarkers();
  };

  gridEl.addEventListener('dragstart', onDragStart);
  gridEl.addEventListener('dragover', onDragOver);
  gridEl.addEventListener('drop', onDrop);
  gridEl.addEventListener('dragend', onDragEnd);

  return () => {
    gridEl.removeEventListener('dragstart', onDragStart);
    gridEl.removeEventListener('dragover', onDragOver);
    gridEl.removeEventListener('drop', onDrop);
    gridEl.removeEventListener('dragend', onDragEnd);
  };
}
