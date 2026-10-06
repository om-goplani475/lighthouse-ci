/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builders for the Phase 10 image audits: alt text quality, filename quality, lazy-loading
 * above the fold, missing width/height attributes, oversized images, legacy formats and images that fail to
 * load. They read Lighthouse's own `ImageElements` and `ViewportDimensions` artifacts, the `ImageAltText`
 * gatherer, and the network records of the page load; nothing here makes a request. No I/O, never throws.
 *
 * Rules, chosen with the developer: every audit fails on any single offender (binary, the table lists up to
 * 50). A "content image" is one rendered at least 50 x 50 px; smaller ones (icons, tracking pixels) and
 * images hidden from assistive technology or marked decorative are not judged for alt text. CSS background
 * images have no alt text, so only the filename rule reads them. These overlap Lighthouse core's own
 * unsized-images, image-size-responsive and modern-image-formats on purpose, with different thresholds.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{url: string, problem: string, note?: boolean}} Offender A `note` is listed but never fails. */

const MIN_CONTENT_PX = 50;
const MAX_ALT_CHARS = 125;
const MIN_REPEATED_ALT = 3;
// 3x assets are normal for 3x-density phones (700 px for a 233 px slot), so only more than 3.5x counts.
const OVERSIZE_FACTOR = 3.5;
const OVERSIZE_MIN_EXTRA_PX = 100;
const FIRST_SCREEN_SHARE = 0.75;
const LEGACY_MIN_BYTES = 10 * 1024;
const LEGACY_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif']);
const MAX_ROWS = 50;
const MAX_CELL_CHARS = 200;

const PLACEHOLDER_ALT = new Set([
  'image',
  'img',
  'picture',
  'pic',
  'photo',
  'graphic',
  'banner',
  'thumbnail',
  'thumb',
  'untitled',
  'placeholder',
  'spacer',
  'alt',
  'alt text',
  'image alt',
  'null',
  'undefined',
  'default',
]);
const GENERIC_NAMES = new Set([
  'image',
  'img',
  'photo',
  'picture',
  'pic',
  'banner',
  'untitled',
  'download',
  'unnamed',
  'placeholder',
  'default',
  'spacer',
  'pixel',
  'blank',
  'noname',
  'no-name',
]);
const CAMERA_NAME =
  /^(img|dsc|dscn|dscf|pxl|mvimg|image|photo|screenshot|capture|scan|wp|untitled)[-_ ]?\d+/i;

/**
 * @param {string} text
 * @param {number} [max]
 * @return {string}
 */
function clip(text, max = MAX_CELL_CHARS) {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

/**
 * @param {unknown} value
 * @return {boolean}
 */
function isRealUrl(value) {
  return typeof value === 'string' && value !== '' && !value.startsWith('data:');
}

/**
 * The file name of an image URL without its extension, decoded; empty when there is none.
 * @param {string} src
 * @return {string}
 */
function baseName(src) {
  let path = src;
  try {
    path = new URL(src).pathname;
  } catch {
    // keep the raw text
  }
  let name = path.slice(path.lastIndexOf('/') + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw name
  }
  return name.replace(/\.[a-z0-9]{2,5}$/i, '');
}

/**
 * @param {Offender[]} offenders
 * @param {{pass: string, fail: string, explain: (n: number) => string}} text
 * @param {string} [urlLabel]
 * @return {Product}
 */
function offenderProduct(offenders, text, urlLabel = 'Image') {
  if (offenders.length === 0) {
    return {score: 1, numericValue: 0, numericUnit: 'unitless', displayValue: text.pass};
  }
  const failing = offenders.filter(o => !o.note);
  const notes = offenders.length - failing.length;
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'url', valueType: 'text', label: urlLabel},
    {key: 'problem', valueType: 'text', label: 'Problem'},
  ];
  const ordered = [...failing, ...offenders.filter(o => o.note)];
  const shown = ordered
    .slice(0, MAX_ROWS)
    .map(o => ({url: clip(o.url), problem: o.note ? `note: ${o.problem}` : o.problem}));
  const items = [...shown];
  if (ordered.length > shown.length) {
    items.push({url: `${ordered.length - shown.length} more not shown`, problem: ''});
  }
  const details = Audit.makeTableDetails(headings, items);
  if (failing.length === 0) {
    return {
      score: 1,
      numericValue: 0,
      numericUnit: 'unitless',
      displayValue: `${text.pass}; ${notes} ${notes === 1 ? 'note' : 'notes'}`,
      details,
    };
  }
  return {
    score: 0,
    numericValue: failing.length,
    numericUnit: 'unitless',
    displayValue: `${failing.length} ${text.fail}`,
    explanation: text.explain(failing.length),
    details,
  };
}

/**
 * Whether an image comes from the audited page's own site (same registrable domain, so a CDN subdomain counts).
 * Unknown page URL or unparseable URLs count as first party, so nothing is hidden by mistake.
 * @param {string} src
 * @param {string | undefined} pageUrl
 * @return {boolean}
 */
function isFirstParty(src, pageUrl) {
  if (!pageUrl) return true;
  try {
    return siteOf(new URL(src).hostname) === siteOf(new URL(pageUrl).hostname);
  } catch {
    return true;
  }
}

/**
 * @param {string} host
 * @return {string} The last two labels (three under a short second-level suffix such as co.uk).
 */
function siteOf(host) {
  const labels = host.toLowerCase().split('.');
  if (labels.length <= 2) return host.toLowerCase();
  const sld = labels[labels.length - 2];
  const short =
    labels[labels.length - 1].length === 2 &&
    ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(sld);
  return labels.slice(short ? -3 : -2).join('.');
}

/**
 * @param {string} explanation
 * @return {Product}
 */
function notApplicable(explanation) {
  return {score: 1, notApplicable: true, explanation};
}

/**
 * @param {any} elements
 * @return {any[]}
 */
function usable(elements) {
  return Array.isArray(elements) ? elements.filter(e => e && typeof e === 'object') : [];
}

/**
 * @param {any} el An ImageElements entry.
 * @return {boolean}
 */
function isContentElement(el) {
  return (
    isRealUrl(el.src) &&
    Number(el.displayedWidth) >= MIN_CONTENT_PX &&
    Number(el.displayedHeight) >= MIN_CONTENT_PX
  );
}

/**
 * @param {{images?: any[]} | null | undefined} artifact
 * @return {Product}
 */
function buildAltQualityProduct(artifact) {
  if (!artifact || !Array.isArray(artifact.images)) {
    return notApplicable('The image alt text was not collected.');
  }
  const content = usable(artifact.images).filter(
    i =>
      !i.hidden &&
      !i.decorative &&
      isRealUrl(i.src) &&
      Number(i.width) >= MIN_CONTENT_PX &&
      Number(i.height) >= MIN_CONTENT_PX &&
      typeof i.alt === 'string'
  );
  if (content.length === 0) {
    return notApplicable('The page has no content images with alt text to judge.');
  }

  /** @type {Offender[]} */
  const offenders = [];
  /** @type {Map<string, Set<string>>} */
  const byAlt = new Map();
  for (const img of content) {
    const alt = img.alt.trim();
    if (alt === '') continue; // an empty alt is a valid decorative choice
    const lowered = alt
      .toLowerCase()
      .replace(/[.:!]+$/g, '')
      .trim();
    const name = baseName(img.src).toLowerCase();
    /** @type {string | null} */
    let problem = null;
    if (/\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i.test(alt)) {
      problem = 'the alt text is a file name';
    } else if (name.length > 3 && lowered === name) {
      problem = 'the alt text repeats the file name';
    } else if (
      PLACEHOLDER_ALT.has(lowered) ||
      /^(image|photo|picture|graphic) ?\d+$/.test(lowered)
    ) {
      problem = 'the alt text is a placeholder word';
    }
    if (problem) offenders.push({url: img.src, problem});
    else if (alt.length > MAX_ALT_CHARS) {
      // A screen-reader convention, not a search rule: a note.
      offenders.push({
        url: img.src,
        problem: `the alt text is ${alt.length} characters (over ${MAX_ALT_CHARS})`,
        note: true,
      });
    }
    const key = alt.toLowerCase();
    const sources = byAlt.get(key) || new Set();
    sources.add(img.src);
    byAlt.set(key, sources);
  }
  for (const [alt, sources] of byAlt) {
    if (sources.size < MIN_REPEATED_ALT) continue;
    for (const src of sources) {
      if (!offenders.some(o => o.url === src)) {
        offenders.push({
          url: src,
          problem: `the same alt text ("${clip(alt, 60)}") is on ${sources.size} different images`,
          note: true,
        });
      }
    }
  }
  return offenderProduct(offenders, {
    pass: `Alt text looks meaningful on ${content.length} content images`,
    fail: offenders.length === 1 ? 'image has poor alt text' : 'images have poor alt text',
    explain: n =>
      `${n} of ${content.length} content ${
        n === 1 ? 'image has' : 'images have'
      } alt text that is a file name, or a placeholder word (a very long alt text, or the same alt on ${MIN_REPEATED_ALT} or more images, is only a note). Describe what the image shows, briefly; use alt="" for a purely decorative one.`,
  });
}

/**
 * @param {any[] | null | undefined} elements ImageElements
 * @param {string} [pageUrl] The audited page; an image from another site is only a note.
 * @return {Product}
 */
function buildFilenameProduct(elements, pageUrl) {
  if (!Array.isArray(elements)) return notApplicable('The page images were not collected.');
  const seen = new Set();
  /** @type {Offender[]} */
  const offenders = [];
  let judged = 0;
  for (const el of usable(elements)) {
    if (!isContentElement(el) || seen.has(el.src)) continue;
    seen.add(el.src);
    judged++;
    const name = baseName(el.src);
    const lowered = name.toLowerCase();
    /** @type {string | null} */
    let problem = null;
    if (name === '') problem = null;
    else if (CAMERA_NAME.test(name)) problem = 'a camera or tool default name';
    else if (/^\d+$/.test(name)) problem = 'a number only';
    else if (
      /^[0-9a-f]{16,}$/i.test(name) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)
    ) {
      problem = 'a hash or ID, not words';
    } else if (GENERIC_NAMES.has(lowered)) problem = 'a generic word';
    if (problem) {
      const own = isFirstParty(el.src, pageUrl);
      offenders.push({
        url: el.src,
        problem: `file name "${clip(name, 60)}" is ${problem}${own ? '' : ' (another site)'}`,
        note: !own,
      });
    }
  }
  if (judged === 0) return notApplicable('The page has no content images to judge.');
  return offenderProduct(offenders, {
    pass: `File names look descriptive on ${judged} content images`,
    fail:
      offenders.length === 1
        ? 'image has a non-descriptive file name'
        : 'images have non-descriptive file names',
    explain: n =>
      `${n} of ${judged} content images (including CSS backgrounds) ${
        n === 1 ? 'has' : 'have'
      } a file name that says nothing about the picture (IMG_1234, a number, a hash or a generic word). Search engines read the file name as a hint; use words such as red-running-shoes.jpg.`,
  });
}

/**
 * @param {any[] | null | undefined} elements ImageElements
 * @param {{innerHeight?: number, innerWidth?: number} | null | undefined} viewport
 * @return {Product}
 */
function buildLazyAboveFoldProduct(elements, viewport) {
  if (!Array.isArray(elements)) return notApplicable('The page images were not collected.');
  const height = viewport && Number(viewport.innerHeight);
  if (!height || height <= 0) return notApplicable('The viewport size was not collected.');
  // A slide of a carousel can sit below the top yet far to the right: it is not on the first screen.
  const width =
    viewport && Number(viewport.innerWidth) > 0 ? Number(viewport.innerWidth) : Infinity;
  const lazy = usable(elements).filter(
    el => !el.isCss && el.loading === 'lazy' && isRealUrl(el.src)
  );
  if (lazy.length === 0) return {score: 1, displayValue: 'No image uses loading="lazy"'};
  /** @type {Offender[]} */
  const offenders = [];
  for (const el of lazy) {
    const rect = el.clientRect;
    if (!rect || !(Number(el.displayedWidth) > 0) || !(Number(el.displayedHeight) > 0)) continue;
    const insideAcross = !(Number(rect.left) >= width) && !(Number(rect.right) <= 0);
    // Chrome loads lazy images well before they scroll in, so only an image that starts in the upper part of the
    // first screen is a real delay; one that starts near its bottom edge is not.
    if (rect.top < height * FIRST_SCREEN_SHARE && rect.bottom > 0 && insideAcross) {
      offenders.push({
        url: el.src,
        problem: `starts ${Math.round(
          rect.top
        )} px from the top of a ${height} px viewport but is lazy-loaded`,
      });
    }
  }
  return offenderProduct(offenders, {
    pass: `${lazy.length} lazy-loaded ${
      lazy.length === 1 ? 'image is' : 'images are'
    } all below the fold`,
    fail:
      offenders.length === 1 ? 'visible image is lazy-loaded' : 'visible images are lazy-loaded',
    explain: n =>
      `${n} ${
        n === 1 ? 'image that is' : 'images that are'
      } inside the first screen carry loading="lazy", which delays them (and can hurt the largest paint). Remove it from images the visitor sees first.`,
  });
}

/**
 * @param {string | null | undefined} attribute
 * @param {string | null | undefined} css
 * @return {boolean} Whether the HTML attribute or the CSS gives this dimension an explicit value.
 */
function hasSize(attribute, css) {
  if (attribute && !String(attribute).startsWith('+') && parseInt(String(attribute), 10) >= 0) {
    return true;
  }
  return !!css && !['auto', 'initial', 'unset', 'inherit'].includes(css);
}

/**
 * An image reserves its space (so it cannot shift the layout) when width and height are both set, or one of them
 * and a CSS aspect-ratio, by attribute or by CSS. Same rule as Lighthouse core `unsized-images`. Unknown CSS rules
 * (the gatherer ran out of time) count as sized, and so do fixed and absolute images, which are out of the flow.
 * @param {any} el
 * @return {boolean}
 */
function isSized(el) {
  const rules = el.cssEffectiveRules;
  if (rules === undefined || rules === null) return !!(el.attributeWidth && el.attributeHeight);
  const position = el.computedStyles && el.computedStyles.position;
  if (position === 'fixed' || position === 'absolute') return true;
  const width = hasSize(el.attributeWidth, rules.width);
  const height = hasSize(el.attributeHeight, rules.height);
  const ratio = hasSize(null, rules.aspectRatio);
  return (width && height) || (width && ratio) || (height && ratio);
}

/**
 * @param {any[] | null | undefined} elements ImageElements
 * @return {Product}
 */
function buildDimensionsProduct(elements) {
  if (!Array.isArray(elements)) return notApplicable('The page images were not collected.');
  const imgs = usable(elements).filter(el => !el.isCss && isContentElement(el));
  if (imgs.length === 0) return notApplicable('The page has no content images to judge.');
  /** @type {Offender[]} */
  const offenders = [];
  const seen = new Set();
  for (const el of imgs) {
    if (seen.has(el.src)) continue;
    seen.add(el.src);
    if (!isSized(el)) {
      const missing = [];
      if (!hasSize(el.attributeWidth, el.cssEffectiveRules && el.cssEffectiveRules.width)) {
        missing.push('width');
      }
      if (!hasSize(el.attributeHeight, el.cssEffectiveRules && el.cssEffectiveRules.height)) {
        missing.push('height');
      }
      offenders.push({
        url: el.src,
        problem: missing.length
          ? `no ${missing.join(' or ')} (attribute or CSS)`
          : 'no width, height or aspect ratio that reserves its space',
      });
    }
  }
  return offenderProduct(offenders, {
    pass: `${seen.size} content images have width and height attributes`,
    fail:
      offenders.length === 1
        ? 'image has no width or height attribute'
        : 'images have no width or height attribute',
    explain: n =>
      `${n} of ${seen.size} content images have no width and height (by attribute or CSS, or one of them plus an aspect ratio), so the browser cannot reserve the space before the file arrives and the layout shifts.`,
  });
}

/**
 * @param {any[] | null | undefined} elements ImageElements
 * @param {string} [pageUrl] The audited page; images from another site are only notes.
 * @return {Product}
 */
function buildOversizedProduct(elements, pageUrl) {
  if (!Array.isArray(elements)) return notApplicable('The page images were not collected.');
  const imgs = usable(elements).filter(
    el => !el.isCss && isContentElement(el) && !/\.svg(\?|$)/i.test(el.src) && el.naturalDimensions
  );
  if (imgs.length === 0) {
    return notApplicable('The page has no raster content images with a known size.');
  }
  /** @type {Offender[]} */
  const offenders = [];
  const seen = new Set();
  for (const el of imgs) {
    if (seen.has(el.src)) continue;
    seen.add(el.src);
    const natural = Number(el.naturalDimensions.width);
    const shown = Number(el.displayedWidth);
    if (natural > shown * OVERSIZE_FACTOR && natural - shown >= OVERSIZE_MIN_EXTRA_PX) {
      offenders.push({
        url: el.src,
        problem: `${natural} px wide, shown at ${Math.round(shown)} px (${(natural / shown).toFixed(
          1
        )}x)${isFirstParty(el.src, pageUrl) ? '' : ', served by another site'}`,
        note: !isFirstParty(el.src, pageUrl),
      });
    }
  }
  return offenderProduct(offenders, {
    pass: `${seen.size} content images are not much larger than they are shown`,
    fail:
      offenders.length === 1
        ? 'image is far larger than it is shown'
        : 'images are far larger than they are shown',
    explain: n =>
      `${n} of ${seen.size} content images are more than ${OVERSIZE_FACTOR}x wider than the space they fill (and at least ${OVERSIZE_MIN_EXTRA_PX} px wider), which wastes bytes. Serve a smaller file or use srcset.`,
  });
}

/**
 * @param {any[] | null | undefined} records Network records of the page load.
 * @return {any[] | null}
 */
function imageRecords(records) {
  if (!Array.isArray(records)) return null;
  return records.filter(r => r && r.resourceType === 'Image' && isRealUrl(r.url));
}

/**
 * @param {any[] | null | undefined} records
 * @param {string} [pageUrl] The audited page; an image from another site (an ad, a widget) is only a note.
 * @return {Product}
 */
function buildLegacyFormatProduct(records, pageUrl) {
  const images = imageRecords(records);
  if (!images) return notApplicable('The network log was not collected.');
  const seen = new Set();
  /** @type {Offender[]} */
  const offenders = [];
  let judged = 0;
  for (const r of images) {
    if (r.failed || seen.has(r.url) || !(r.statusCode >= 200 && r.statusCode < 300)) continue;
    seen.add(r.url);
    judged++;
    const type = String(r.mimeType || '').toLowerCase();
    const bytes = Number(r.resourceSize) || 0;
    if (LEGACY_TYPES.has(type) && bytes > LEGACY_MIN_BYTES) {
      offenders.push({
        url: r.url,
        problem: `${type.replace('image/', '').toUpperCase()} of ${Math.round(
          bytes / 1024
        )} KiB; WebP or AVIF is smaller${isFirstParty(r.url, pageUrl) ? '' : ' (another site)'}`,
        note: !isFirstParty(r.url, pageUrl),
      });
    }
  }
  if (judged === 0) return notApplicable('The page loaded no images.');
  return offenderProduct(offenders, {
    pass: `${judged} loaded images use modern formats or are small`,
    fail: offenders.length === 1 ? 'image uses a legacy format' : 'images use a legacy format',
    explain: n =>
      `${n} of ${judged} loaded images are JPEG, PNG or GIF files over ${
        LEGACY_MIN_BYTES / 1024
      } KiB; WebP or AVIF files are usually 25 to 50% smaller. WebP, AVIF and SVG pass.`,
  });
}

/**
 * @param {any[] | null | undefined} records
 * @param {string} [pageUrl] The audited page; a failing image from another site is only a note.
 * @return {Product}
 */
function buildFailedImagesProduct(records, pageUrl) {
  const images = imageRecords(records);
  if (!images) return notApplicable('The network log was not collected.');
  if (images.length === 0) return notApplicable('The page loaded no images.');
  const seen = new Set();
  /** @type {Offender[]} */
  const offenders = [];
  for (const r of images) {
    if (seen.has(r.url)) continue;
    const status = Number(r.statusCode);
    if (status >= 400) {
      seen.add(r.url);
      offenders.push({
        url: r.url,
        problem: `answered ${status}${isFirstParty(r.url, pageUrl) ? '' : ' (another site)'}`,
        note: !isFirstParty(r.url, pageUrl),
      });
    } else if (
      r.failed &&
      !/ABORTED|BLOCKED|CANCEL/i.test(String(r.localizedFailDescription || ''))
    ) {
      seen.add(r.url);
      offenders.push({
        url: r.url,
        problem: `no response (${clip(String(r.localizedFailDescription || 'failed'), 80)})${
          isFirstParty(r.url, pageUrl) ? '' : ' (another site)'
        }`,
        note: !isFirstParty(r.url, pageUrl),
      });
    }
  }
  return offenderProduct(offenders, {
    pass: `All ${images.length} image requests succeeded`,
    fail: offenders.length === 1 ? 'image failed to load' : 'images failed to load',
    explain: n =>
      `${n} of ${images.length} image requests came back as an error (4xx or 5xx) or got no answer. Broken images hurt users and image search; fix or remove them. Images served by another site (an ad or a widget) are only listed as notes.`,
  });
}

export {
  buildAltQualityProduct,
  buildFilenameProduct,
  buildLazyAboveFoldProduct,
  buildDimensionsProduct,
  buildOversizedProduct,
  buildLegacyFormatProduct,
  buildFailedImagesProduct,
  baseName,
  MAX_ROWS,
  MAX_ALT_CHARS,
  LEGACY_MIN_BYTES,
};
