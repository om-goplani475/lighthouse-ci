/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A comparison key for "is this the same page": scheme, host and port, the path without a trailing slash,
 * and the query, with the fragment dropped. Letter case in the path is kept (paths are case-sensitive);
 * the host is lower-cased by the URL parser. Used where a trailing-slash difference alone must not make
 * two references to one page look different (hreflang return links, sitemap alternates).
 * @param {unknown} href
 * @param {string} [base]
 * @return {string | null} Null for anything that is not an http(s) URL.
 */
function looseKey(href, base) {
  if (typeof href !== 'string' || href.trim() === '') return null;
  let url;
  try {
    url = new URL(href.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A loop, not /\/+$/: that pattern is quadratic on a long run of slashes.
  let end = url.pathname.length;
  while (end > 1 && url.pathname.charCodeAt(end - 1) === 47) end--;
  return `${url.protocol}//${url.host}${url.pathname.slice(0, end)}${url.search}`;
}

export {looseKey};
