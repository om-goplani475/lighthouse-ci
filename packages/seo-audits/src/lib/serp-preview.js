/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * A model of how a search result for a page may look: its address trail, its title and its description, each cut where it
 * would stop fitting in the approximate pixel budget of `pixel-width-truncation`. Pure: no I/O.
 *
 * It is an approximation, not Google's rendering: Google does not publish its font or its widths, and it often rewrites
 * titles and descriptions. The widths come from the browser measuring the real text in the real font of the page's own
 * ruleset (`rules/serp-pixel-budgets`), so a cut is placed where *that* model says the text stops fitting.
 */

/** Characters measured per text: a title or a description is never this long in practice, and the report stays small. */
const MAX_MEASURED = 400;
const MAX_SHOWN = 400;

/**
 * @typedef {{text: string, widthPx: number, prefixWidths?: number[]} | null | undefined} MeasuredText
 * `prefixWidths[i]` is the width of the first `i + 1` characters (code points), up to the first 400.
 * @typedef {{shown: string, truncated: boolean, widthPx: number | null}} ShownText
 * @typedef {{title: ShownText | null, description: ShownText | null}} DevicePreview
 * @typedef {{
 *   version: 1, url: string, displayUrl: string,
 *   devices: {desktop: DevicePreview, mobile: DevicePreview},
 * }} SerpPreview
 */

/**
 * @param {string} font For example `400 20px Arial, sans-serif`.
 * @return {number} The font size in pixels (a widths-based ellipsis is as wide as one em), or 16 when it cannot be read.
 */
function fontSizePx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font));
  return m ? Number(m[1]) : 16;
}

/**
 * @param {string} text
 * @param {number} max
 * @return {string}
 */
function clip(text, max) {
  const chars = Array.from(String(text));
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('')}`;
}

/**
 * @param {MeasuredText} measured
 * @param {number} budgetPx
 * @param {number} ellipsisPx
 * @return {ShownText | null}
 */
function cutToBudget(measured, budgetPx, ellipsisPx) {
  if (!measured || typeof measured.text !== 'string' || !measured.text.trim()) return null;
  const chars = Array.from(measured.text);
  const widthPx = typeof measured.widthPx === 'number' ? measured.widthPx : null;
  const prefix = Array.isArray(measured.prefixWidths) ? measured.prefixWidths : [];
  const measuredAll = chars.length <= MAX_MEASURED;
  const fits = widthPx !== null ? widthPx <= budgetPx : false;
  if (fits && measuredAll) {
    return {shown: clip(measured.text, MAX_SHOWN), truncated: false, widthPx};
  }

  // Without measured prefixes (or with an unknown width) the only honest answer is the text as it is, marked unknown.
  if (prefix.length === 0) {
    return {shown: clip(measured.text, MAX_SHOWN), truncated: widthPx !== null && !fits, widthPx};
  }

  // The longest prefix that still leaves room for the ellipsis.
  let keep = 0;
  while (
    keep < prefix.length &&
    keep < chars.length &&
    typeof prefix[keep] === 'number' &&
    prefix[keep] + ellipsisPx <= budgetPx
  ) {
    keep++;
  }
  let cut = chars.slice(0, keep).join('');
  // Prefer to end on a whole word, when one ends close to the cut.
  if (keep < chars.length) {
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= cut.length * 0.5 && !/\s/.test(chars[keep])) cut = cut.slice(0, lastSpace);
  }
  cut = cut.replace(/[\s,;:\-–—|·]+$/u, '');
  return {shown: `${clip(cut, MAX_SHOWN)}…`, truncated: true, widthPx};
}

/**
 * @param {string} url
 * @return {string} `host › first › second` (at most two path parts, each clipped), or the text itself when it is not a URL.
 */
function displayUrlOf(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2)
      .map(p => {
        try {
          return decodeURIComponent(p);
        } catch (_) {
          return p;
        }
      })
      .map(p => clip(p, 30));
    return [u.host, ...parts].join(' › ');
  } catch (_) {
    return clip(String(url), 60);
  }
}

/**
 * @param {{
 *   url: string, title?: MeasuredText, description?: MeasuredText,
 *   budgets: {title: {desktop: number, mobile: number}, description: {desktop: number, mobile: number}},
 *   fonts: {title: string, description: string},
 * }} input
 * @return {SerpPreview}
 */
function buildSerpPreview({url, title, description, budgets, fonts}) {
  const titleEllipsis = fontSizePx(fonts.title);
  const descriptionEllipsis = fontSizePx(fonts.description);
  /** @param {'desktop' | 'mobile'} device @return {DevicePreview} */
  const device = device => ({
    title: cutToBudget(title, budgets.title[device], titleEllipsis),
    description: cutToBudget(description, budgets.description[device], descriptionEllipsis),
  });
  return {
    version: 1,
    url: clip(String(url), 2048),
    displayUrl: displayUrlOf(url),
    devices: {desktop: device('desktop'), mobile: device('mobile')},
  };
}

/**
 * What changed in the snippet between two previews of the same page.
 * @param {SerpPreview | null | undefined} before
 * @param {SerpPreview | null | undefined} after
 * @return {{titleChanged: boolean, descriptionChanged: boolean, urlChanged: boolean} | null} Null without both previews.
 */
function compareSerpPreviews(before, after) {
  if (!before || !after || !before.devices || !after.devices) return null;
  const text = (/** @type {SerpPreview} */ p, /** @type {'title' | 'description'} */ f) =>
    (p.devices.desktop[f] && p.devices.desktop[f]?.shown) || '';
  return {
    titleChanged: text(before, 'title') !== text(after, 'title'),
    descriptionChanged: text(before, 'description') !== text(after, 'description'),
    urlChanged: before.displayUrl !== after.displayUrl,
  };
}

/**
 * @param {unknown} value A value read back from storage.
 * @return {SerpPreview | null} The value when it has the shape of a preview, else null.
 */
function reviveSerpPreview(value) {
  const v = /** @type {any} */ (value);
  if (!v || typeof v !== 'object' || v.version !== 1 || typeof v.displayUrl !== 'string') {
    return null;
  }
  if (!v.devices || !v.devices.desktop || !v.devices.mobile) return null;
  const okText = (/** @type {any} */ t) =>
    t === null || (t && typeof t.shown === 'string' && typeof t.truncated === 'boolean');
  for (const d of [v.devices.desktop, v.devices.mobile]) {
    if (!okText(d.title) || !okText(d.description)) return null;
  }
  return v;
}

export {
  buildSerpPreview,
  compareSerpPreviews,
  reviveSerpPreview,
  cutToBudget,
  displayUrlOf,
  fontSizePx,
  MAX_MEASURED,
};
