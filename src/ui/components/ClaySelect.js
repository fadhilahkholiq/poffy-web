import { el, svgEl } from '../utils/dom.js';

let selectSeq = 0;

/** @type {(() => void)|null} */
let activeCloseCallback = null;

/**
 * Splits container layout utility tokens from visual button tokens so spacing
 * (`mt-*`, `flex-1`, width helpers) applies to the outer wrapper while height
 * and typography tokens apply directly to the trigger button.
 * @param {string} className
 * @returns {{ wrapperClasses: string[], triggerClasses: string[] }}
 */
function splitControlClasses(className) {
  const wrapperClasses = [];
  const triggerClasses = [];
  for (const token of String(className || '').split(/\s+/).filter(Boolean)) {
    if (token === 'input-clay') continue;
    if (/^(mt-|mb-|my-|mx-|ml-|mr-|flex-1|shrink-0|w-|min-w-|max-w-|sm:)/.test(token)) {
      wrapperClasses.push(token);
    } else {
      triggerClasses.push(token);
    }
  }
  return { wrapperClasses, triggerClasses };
}

/**
 * Renders a crafted, keyboard-accessible Clay dropdown control with portal menu
 * positioning so options never clip inside overflow containers or sticky panels.
 * @param {Object} params
 * @param {string} [params.id='']
 * @param {string} [params.className='']
 * @param {string|number} params.currentValue
 * @param {Array<[string|number, string] | [string|number, string, boolean]>} params.options
 * @param {(val: string) => void} params.onChange
 * @returns {HTMLElement}
 */
export function createClaySelect({ id = '', className = '', currentValue, options, onChange }) {
  selectSeq += 1;
  const listboxId = `clay-listbox-${selectSeq}`;
  const normalized = options.map((entry) => ({
    value: String(entry[0]),
    label: String(entry[1]),
    disabled: Boolean(entry[2])
  }));

  let selectedVal = String(currentValue);
  if (!normalized.some((o) => o.value === selectedVal) && normalized.length > 0) {
    selectedVal = normalized[0].value;
  }

  const { wrapperClasses, triggerClasses } = splitControlClasses(className);
  const labelSpan = el(
    'span',
    { className: 'truncate text-left flex-1 min-w-0' },
    normalized.find((o) => o.value === selectedVal)?.label || ''
  );
  const chevron = svgEl(
    'svg',
    {
      width: 15,
      height: 15,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.25,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      className: 'clay-select-chevron shrink-0 text-[#0a0a0a]',
      'aria-hidden': 'true'
    },
    svgEl('path', { d: 'm6 9 6 6 6-6' })
  );

  const trigger = /** @type {HTMLButtonElement} */ (
    el(
      'button',
      {
        id: id || undefined,
        type: 'button',
        role: 'combobox',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-controls': listboxId,
        className: ['clay-select-trigger', ...triggerClasses].join(' ')
      },
      labelSpan,
      chevron
    )
  );

  let isOpen = false;
  /** @type {HTMLUListElement|null} */
  let menuEl = null;

  const detachGlobalListeners = () => {
    document.removeEventListener('pointerdown', handleOutsidePointer, true);
    window.removeEventListener('scroll', handleGlobalScroll, true);
    window.removeEventListener('resize', closeMenu);
  };

  const closeMenu = () => {
    if (!isOpen) return;
    isOpen = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
    if (menuEl && menuEl.parentNode) {
      menuEl.parentNode.removeChild(menuEl);
    }
    menuEl = null;
    detachGlobalListeners();
    if (activeCloseCallback === closeMenu) {
      activeCloseCallback = null;
    }
  };

  /** @param {PointerEvent} ev */
  const handleOutsidePointer = (ev) => {
    const target = /** @type {Node|null} */ (ev.target);
    if (!target) return;
    if (trigger.contains(target) || (menuEl && menuEl.contains(target))) return;
    closeMenu();
  };

  /** @param {Event} ev */
  const handleGlobalScroll = (ev) => {
    const target = /** @type {Node|null} */ (ev.target);
    if (menuEl && target && menuEl.contains(target)) return;
    closeMenu();
  };

  /** @param {string} val */
  const commitSelection = (val) => {
    const match = normalized.find((o) => o.value === val && !o.disabled);
    if (!match) return;
    selectedVal = match.value;
    labelSpan.textContent = match.label;
    closeMenu();
    onChange(match.value);
  };

  const openMenu = () => {
    if (!trigger.isConnected) return;
    if (activeCloseCallback && activeCloseCallback !== closeMenu) {
      activeCloseCallback();
    }
    isOpen = true;
    activeCloseCallback = closeMenu;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('is-open');

    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 10;
    const spaceAbove = rect.top - 10;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxMenuHeight = Math.max(120, Math.min(280, openUpward ? spaceAbove : spaceBelow));
    const menuWidth = Math.min(Math.max(rect.width, 168), Math.min(360, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));

    menuEl = /** @type {HTMLUListElement} */ (
      el(
        'ul',
        {
          id: listboxId,
          role: 'listbox',
          className: 'clay-select-menu',
          style: {
            position: 'fixed',
            left: `${Math.round(left)}px`,
            width: `${Math.round(menuWidth)}px`,
            maxHeight: `${Math.round(maxMenuHeight)}px`,
            ...(openUpward
              ? { bottom: `${Math.round(window.innerHeight - rect.top + 6)}px` }
              : { top: `${Math.round(rect.bottom + 6)}px` })
          }
        },
        normalized.map((opt) => {
          const isSelected = opt.value === selectedVal;
          const checkIcon = isSelected
            ? svgEl(
                'svg',
                {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  'stroke-width': 2.5,
                  'stroke-linecap': 'round',
                  'stroke-linejoin': 'round',
                  className: 'shrink-0',
                  'aria-hidden': 'true'
                },
                svgEl('polyline', { points: '20 6 9 17 4 12' })
              )
            : null;

          return el(
            'li',
            { role: 'presentation' },
            el(
              'button',
              {
                type: 'button',
                role: 'option',
                disabled: opt.disabled,
                'aria-selected': String(isSelected),
                className: `clay-select-option ${isSelected ? 'is-selected' : ''}`,
                onClick: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!opt.disabled) {
                    commitSelection(opt.value);
                    trigger.focus();
                  }
                }
              },
              el('span', { className: 'truncate text-left flex-1 min-w-0' }, opt.label),
              checkIcon
            )
          );
        })
      )
    );

    document.body.appendChild(menuEl);
    const activeOpt = menuEl.querySelector('.clay-select-option.is-selected');
    if (activeOpt instanceof HTMLElement) {
      activeOpt.scrollIntoView({ block: 'nearest' });
    }

    document.addEventListener('pointerdown', handleOutsidePointer, true);
    window.addEventListener('scroll', handleGlobalScroll, true);
    window.addEventListener('resize', closeMenu);
  };

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      const enabled = normalized.filter((o) => !o.disabled);
      if (enabled.length === 0) return;
      const curIdx = enabled.findIndex((o) => o.value === selectedVal);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = enabled[(Math.max(0, curIdx) + step + enabled.length) % enabled.length];
      commitSelection(next.value);
    }
  });

  return el(
    'div',
    {
      className: ['clay-select relative w-full', ...wrapperClasses].join(' ')
    },
    trigger
  );
}
