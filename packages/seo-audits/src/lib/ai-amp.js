/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure result builder for the informational `amp-check` audit: is the page an AMP page, does it link to an AMP
 * version, does that version load, and does it name this page as its canonical? Informational (AMP is no longer
 * needed for Google's Top Stories, and its use is declining): it never fails. Not applicable when the page has no
 * AMP involvement. No I/O, never throws.
 */

import {looseKey} from './url-key.js';
import {clip, notApplicable, table} from './content-common.js';

/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {import('../gatherers/amp-page.js').AmpPageArtifact} AmpPageArtifact */

const NOTE =
  'AMP is no longer required for Google Top Stories and its use is declining; this only reports what is there.';

/**
 * @param {unknown} data AmpPage artifact
 * @return {Product}
 */
function buildAmpProduct(data) {
  const d = /** @type {AmpPageArtifact} */ (data);
  if (!d || typeof d !== 'object' || typeof d.pageUrl !== 'string') {
    return notApplicable('The AMP data was not collected.');
  }
  if (!d.isAmp && !d.ampUrl) {
    return notApplicable('The page is not an AMP page and does not link to an AMP version.');
  }
  /** @type {Array<Record<string, string>>} */
  const rows = [];
  if (d.isAmp) {
    rows.push({item: 'This page is AMP', result: 'yes'});
    rows.push({
      item: 'Its canonical',
      result: d.canonical
        ? clip(d.canonical, 100)
        : 'missing (an AMP page should declare a canonical, the non-AMP version or itself)',
    });
  }
  if (d.ampUrl) {
    rows.push({item: 'AMP version it links to', result: clip(d.ampUrl, 100)});
    if (d.state === 'disabled') {
      rows.push({item: 'AMP version loads', result: d.reason || 'not requested'});
    } else if (d.check) {
      const c = d.check;
      rows.push({
        item: 'AMP version loads',
        result:
          c.error !== null
            ? `no answer (${c.error})`
            : c.status !== null && c.status >= 300 && c.status < 400
            ? `redirects${c.redirectLocation ? ` to ${clip(c.redirectLocation, 60)}` : ''}`
            : `answers ${c.status}${c.noindex ? ', but is noindex' : ''}`,
      });
      if (c.bodyRead === 'html') {
        const keys = new Set([looseKey(d.pageUrl), looseKey(d.canonical)].filter(Boolean));
        const back =
          c.canonicals.length === 0
            ? 'declares no canonical'
            : c.canonicals.some(x => keys.has(looseKey(x)))
            ? 'yes'
            : `no (it names ${clip(c.canonicals[0], 80)})`;
        rows.push({item: 'AMP version names this page as its canonical', result: back});
      }
    }
  }
  rows.push({item: 'Note', result: NOTE});
  return {
    score: 1,
    displayValue: d.isAmp ? 'This page is an AMP page' : 'This page links to an AMP version',
    details: table(rows, [
      ['item', 'Item'],
      ['result', 'Result'],
    ]),
  };
}

export {buildAmpProduct};
