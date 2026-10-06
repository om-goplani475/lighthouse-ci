/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic shared by the three favicon/manifest audits. No Lighthouse-computed-artifact
 * imports, loads directly under Jest.
 */

const ICON_RELS = new Set(['icon', 'shortcut icon']);
const APPLE_TOUCH_RELS = new Set(['apple-touch-icon', 'apple-touch-icon-precomposed']);

/** Chrome's documented minimum icon size for PWA installability. */
const MIN_INSTALLABLE_ICON_SIZE = 192;

/**
 * @param {import('../gatherers/favicon-links.js').FaviconLink[]} links
 * @return {import('../gatherers/favicon-links.js').FaviconLink[]}
 */
function faviconLinks(links) {
  return links.filter(link => ICON_RELS.has(link.rel) && link.href);
}

/**
 * @param {import('../gatherers/favicon-links.js').FaviconLink[]} links
 * @return {import('../gatherers/favicon-links.js').FaviconLink | undefined}
 */
function manifestLink(links) {
  return links.find(link => link.rel === 'manifest' && link.href);
}

/**
 * Parses a `sizes` attribute value (e.g. "32x32", "16x16 32x32 48x48", "any") into the largest
 * single dimension found, for comparison purposes. Returns 0 for "any" or an unparseable value —
 * "any" means scalable/vector, handled separately via `isScalable`, not as a numeric size.
 * @param {string | null} sizes
 * @return {number}
 */
function largestDimension(sizes) {
  if (!sizes) return 0;
  let max = 0;
  for (const token of sizes.trim().split(/\s+/)) {
    const match = token.match(/^(\d+)x(\d+)$/i);
    if (match) {
      max = Math.max(max, Number(match[1]), Number(match[2]));
    }
  }
  return max;
}

/**
 * @param {import('../gatherers/favicon-links.js').FaviconLink} link
 * @return {boolean}
 */
function isScalable(link) {
  return link.type === 'image/svg+xml' || link.sizes === 'any';
}

/**
 * The real Web App Manifest icon shape (per the spec) has a `sizes` string, same format as the
 * favicon `<link sizes>` attribute (e.g. "192x192", "16x16 32x32", "any") — not separate
 * width/height fields. Reuses `largestDimension` rather than re-parsing.
 * @param {{sizes?: unknown, type?: unknown}} icon
 * @return {number}
 */
function manifestIconSize(icon) {
  if (icon.sizes === 'any') return Infinity; // Scalable — always satisfies a minimum-size check.
  return largestDimension(typeof icon.sizes === 'string' ? icon.sizes : null);
}

/**
 * Pure decision logic for manifest-icons, split out so it's unit-testable without faking a
 * network fetch — only the fetch itself (`safe-fetch.js`) is verified live.
 * @param {unknown} manifest the parsed manifest JSON, or an Error if the fetch/parse failed
 * @return {import('lighthouse/types/audit.js').default.Product}
 */
function buildManifestIconsResult(manifest) {
  if (manifest instanceof Error) {
    return {
      score: 0,
      displayValue: 'Manifest could not be read',
      explanation: `Could not fetch or parse the web app manifest: ${manifest.message}`,
    };
  }

  const icons = /** @type {{icons?: unknown}} */ (manifest)?.icons;
  if (!Array.isArray(icons) || icons.length === 0) {
    return {
      score: 0,
      displayValue: 'No icons in the manifest',
      explanation: 'The web app manifest has no "icons" array, or it is empty.',
    };
  }

  const adequate = icons.some(
    icon => manifestIconSize(/** @type {{sizes?: unknown}} */ (icon)) >= MIN_INSTALLABLE_ICON_SIZE
  );
  if (!adequate) {
    return {
      score: 0,
      displayValue: 'No icon large enough to install',
      explanation:
        `None of the manifest's icons are at least ${MIN_INSTALLABLE_ICON_SIZE}x` +
        `${MIN_INSTALLABLE_ICON_SIZE} — Chrome's minimum for PWA installability.`,
    };
  }

  return {score: 1};
}

export {
  faviconLinks,
  manifestLink,
  largestDimension,
  isScalable,
  manifestIconSize,
  buildManifestIconsResult,
  APPLE_TOUCH_RELS,
  MIN_INSTALLABLE_ICON_SIZE,
};
