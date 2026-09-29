/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The first audit in this package that fetches a second URL discovered on the page (the web app
 * manifest's `href`) rather than only reading data Lighthouse's own page load already collected.
 * See `../lib/safe-fetch.js`'s module doc for the SSRF/DoS protections this relies on, and
 * `.ai-agents/prompts/security-checklist.md` for why this needed that care in the first place.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {manifestLink, buildManifestIconsResult} from '../lib/favicon.js';
import {safeFetchJson} from '../lib/safe-fetch.js';

const UIStrings = {
  title: 'Web app manifest has an adequately-sized icon',
  failureTitle: 'Web app manifest is missing an adequately-sized icon',
  description:
    'Chrome requires at least one icon of 192x192px or larger (or a scalable SVG) in the web ' +
    'app manifest before it will offer to install the page as an app. Not-applicable when the ' +
    'page has no `<link rel="manifest">` at all — most pages aren\'t meant to be installable, ' +
    "and that's a legitimate choice, not a problem to flag.",
};

// @ts-expect-error - FaviconLinks isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ManifestIcons extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'manifest-icons',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['FaviconLinks'],
    };
  }

  /**
   * Deliberately thin — see the robots-directives audits' equivalent method doc for the same
   * "pure logic lives in lib/, this method's only job is wiring" reasoning. Here that's doubly
   * true: the fetch itself can't be meaningfully unit-tested without either hitting the real
   * network or reimplementing safe-fetch.js's own already-tested logic, so it's verified only by
   * the live `lhci collect` run (see docs/qa/favicon-and-manifest.md).
   * @param {{FaviconLinks: import('../gatherers/favicon-links.js').FaviconLinksArtifact}} artifacts
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts) {
    const manifest = manifestLink(artifacts.FaviconLinks);
    if (!manifest || !manifest.href) {
      return {score: null, notApplicable: true};
    }

    try {
      const parsed = await safeFetchJson(manifest.href);
      return buildManifestIconsResult(parsed);
    } catch (err) {
      return buildManifestIconsResult(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

export default ManifestIcons;
export {UIStrings};
