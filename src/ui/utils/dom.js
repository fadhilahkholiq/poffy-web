/**
 * Safe DOM element builder utilities using createElement/textContent/setAttribute only.
 * Eliminates innerHTML/outerHTML/insertAdjacentHTML sinks across the UI layer.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Validates that an image URL is strictly a safe local blob: or same-origin relative path.
 * Blocks javascript:, data:, file:, vbscript:, and external origins.
 * @param {string|null|undefined} rawUrl
 * @returns {string|null}
 */
export function sanitizeImageSrc(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('blob:')) {
    return trimmed;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  return null;
}

/**
 * Sanitizes an external/link URL (strictly http: or https: only).
 * @param {string|null|undefined} rawUrl
 * @returns {string|null}
 */
export function sanitizeExternalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Applies properties, styles, dataset, and event listeners to a DOM node safely.
 * @param {Element} node
 * @param {Record<string, any>} [props={}]
 */
function applyProps(node, props = {}) {
  for (const [key, val] of Object.entries(props)) {
    if (val === undefined || val === null || val === false) continue;

    if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'className') {
      node.setAttribute('class', String(val));
    } else if (key === 'style' && typeof val === 'object') {
      Object.assign(/** @type {HTMLElement} */ (node).style, val);
    } else if (key === 'dataset' && typeof val === 'object') {
      for (const [dKey, dVal] of Object.entries(val)) {
        if (dVal !== undefined && dVal !== null) {
          /** @type {HTMLElement} */ (node).dataset[dKey] = String(dVal);
        }
      }
    } else if (
      key === 'checked' ||
      key === 'disabled' ||
      key === 'selected' ||
      key === 'value' ||
      key === 'draggable'
    ) {
      node[key] = val;
    } else if (val === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(val));
    }
  }
}

/**
 * Appends nested child nodes or text strings safely via createTextNode.
 * @param {Element} parent
 * @param {any[]} children
 */
function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/**
 * Creates an HTML element safely without innerHTML.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/**
 * Creates an SVG element safely in the SVG namespace without innerHTML.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {SVGElement}
 */
export function svgEl(tag, props = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  appendChildren(node, children);
  return node;
}

/**
 * Replaces a container's children safely using replaceChildren().
 * @param {Element} container
 * @param {...(Node|string|null|undefined|false)} nodes
 */
export function mount(container, ...nodes) {
  const flat = [];
  for (const n of nodes) {
    if (n === null || n === undefined || n === false) continue;
    if (n instanceof Node) flat.push(n);
    else flat.push(document.createTextNode(String(n)));
  }
  container.replaceChildren(...flat);
}
