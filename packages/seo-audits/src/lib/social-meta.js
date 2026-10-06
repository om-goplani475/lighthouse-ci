/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared meta-tag lookup + Open Graph/Twitter fallback resolution, factored out of
 * twitter-card-completeness.js so social-preview-content.js can reuse the exact same fallback
 * logic rather than reimplementing it — the two audits need to agree on what a platform would
 * actually show, not just agree on whether something is present.
 */

/**
 * @param {Array<{name?: string, content?: string, property?: string}>} metaElements
 * @param {string} name
 * @return {string | undefined}
 */
function twitterContent(metaElements, name) {
  // Twitter documents `name`, but some sites write `property`; scrapers read both.
  return metaElements.find(meta => (meta.name === name || meta.property === name) && meta.content)
    ?.content;
}

/**
 * @param {Array<{name?: string, content?: string, property?: string}>} metaElements
 * @param {string} property
 * @return {string | undefined}
 */
function ogContent(metaElements, property) {
  // The protocol says `property`, but some sites (MDN, for one) write `name`, and scrapers read both.
  return metaElements.find(
    meta => (meta.property === property || meta.name === property) && meta.content
  )?.content;
}

/**
 * Resolves what Twitter/X would actually show for `title`/`description`/`image`, per its
 * documented (see the sourcing caveat in twitter-card-completeness.js) fallback-to-Open-Graph
 * behavior: the `twitter:`-specific tag if present, else the `og:*` equivalent.
 * @param {Array<{name?: string, content?: string, property?: string}>} metaElements
 * @param {'title' | 'description' | 'image'} field
 * @return {string | undefined}
 */
function twitterResolved(metaElements, field) {
  return twitterContent(metaElements, `twitter:${field}`) ?? ogContent(metaElements, `og:${field}`);
}

export {twitterContent, ogContent, twitterResolved};
