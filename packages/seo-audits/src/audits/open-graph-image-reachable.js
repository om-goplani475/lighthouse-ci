/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Confirms the page's `og:image` URL actually resolves — a broken share image is a real,
 * user-visible defect (a blank/placeholder box on every shared link) that pure markup validation
 * can't catch. Fetches via `../lib/safe-fetch.js`'s `safeFetchStatus`, reusing the same
 * SSRF-protected request path `manifest-icons.js` already uses, extended to a status-only mode
 * that never downloads the image body (see safe-fetch.js's module doc).
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {safeFetchStatus} from '../lib/safe-fetch.js';

const UIStrings = {
  title: '`og:image` resolves successfully',
  failureTitle: '`og:image` does not resolve',
  description:
    'A broken or unreachable `og:image` URL means every social/chat share of this page shows a ' +
    'blank or broken preview image. Not-applicable when the page has no `og:image` at all — that ' +
    "absence is `open-graph-completeness`'s concern, not this audit's.",
};

class OpenGraphImageReachable extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'open-graph-image-reachable',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['MetaElements'],
    };
  }

  /**
   * Deliberately thin — the fetch itself can't be meaningfully unit-tested without either hitting
   * the real network or reimplementing safe-fetch.js's own already-tested logic (same reasoning
   * as manifest-icons.js's equivalent method doc), so it's verified only by the live `lhci
   * collect` run.
   * @param {{MetaElements: Array<{content?: string, property?: string, name?: string}>}} artifacts
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts) {
    const ogImage = artifacts.MetaElements.find(
      meta => (meta.property === 'og:image' || meta.name === 'og:image') && meta.content
    )?.content;

    if (!ogImage) {
      return {score: null, notApplicable: true};
    }

    let status;
    try {
      ({status} = await safeFetchStatus(ogImage));
    } catch (err) {
      return {
        score: 0,
        explanation: `og:image ("${ogImage}") could not be fetched: ${err.message}`,
      };
    }

    if (status >= 200 && status < 300) {
      return {score: 1};
    }

    return {
      score: 0,
      explanation: `og:image ("${ogImage}") returned HTTP ${status}.`,
    };
  }
}

export default OpenGraphImageReachable;
export {UIStrings};
