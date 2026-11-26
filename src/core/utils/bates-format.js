/**
 * Pure, dependency-free Bates & page number token formatter.
 * Safe for both Web Workers and main-thread live UI previews.
 */

/**
 * Formats a Bates / page numbering label using supported dynamic tokens:
 * `{prefix}`, `{counter:pad}`, `{counter:N}`, `{counter}`, `{suffix}`, `{filename}`, `{n}`, `{total}`, `{date}`.
 * @param {string} template
 * @param {Object} vars
 * @param {string} [vars.prefix='']
 * @param {string} [vars.suffix='']
 * @param {number} [vars.counter=1]
 * @param {number} [vars.padding=5]
 * @param {string} [vars.filename='']
 * @param {number} [vars.n=1]
 * @param {number} [vars.total=1]
 * @param {string} [vars.date]
 * @returns {string}
 */
export function formatBatesLabel(template, vars = {}) {
  const padWidth = Math.max(1, Math.min(12, Math.floor(Number(vars.padding ?? 5))));
  const counterNum = Math.max(0, Math.floor(Number(vars.counter ?? 1)));
  const dateStr = vars.date || new Date().toISOString().slice(0, 10);

  return String(template || '{prefix}{counter:pad}{suffix}')
    .replaceAll('{prefix}', String(vars.prefix ?? ''))
    .replaceAll('{suffix}', String(vars.suffix ?? ''))
    .replaceAll('{filename}', String(vars.filename ?? ''))
    .replaceAll('{n}', String(vars.n ?? 1))
    .replaceAll('{total}', String(vars.total ?? 1))
    .replaceAll('{date}', dateStr)
    .replaceAll('{counter:pad}', String(counterNum).padStart(padWidth, '0'))
    .replace(/\{counter:(\d+)\}/g, (_, digits) =>
      String(counterNum).padStart(Math.max(1, Math.min(12, Number(digits) || padWidth)), '0')
    )
    .replaceAll('{counter}', String(counterNum));
}
