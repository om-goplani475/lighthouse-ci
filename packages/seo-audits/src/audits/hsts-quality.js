/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {evaluateHsts, hstsProduct} from '../lib/transport-security.js';
import {resolveMainDocumentSecurity} from '../lib/transport-security-sources.js';

const UIStrings = {
  title: 'HSTS is set and strong enough',
  failureTitle: 'HSTS is missing or too weak',
  description:
    'The Strict-Transport-Security header tells browsers to use only HTTPS for this host. It fails ' +
    'here when the header is absent, `max-age` is missing, zero or under one year (31,536,000 ' +
    'seconds), or `preload` is set without the `includeSubDomains` and one-year `max-age` the ' +
    'preload list requires. A missing `includeSubDomains` is a note, not a failure. Only the first ' +
    'header is judged, as browsers do. A browser honours HSTS only over HTTPS and only after a first ' +
    'HTTPS visit; the audit does not check the preload list or other subdomains. ' +
    "Lighthouse's own `has-hsts` audit is informational and stays in the report; this one has a " +
    'pass/fail threshold.',
};

class HstsQuality extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hsts-quality',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['DevtoolsLog', 'URL'],
      supportedModes: ['navigation'],
    };
  }

  /**
   * Thin on purpose, as `mixed-content`: parsing and scoring are in `lib/transport-security.js`.
   * @param {{DevtoolsLog: unknown, URL: unknown}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const {finalUrl, hstsHeaderValues} = await resolveMainDocumentSecurity(artifacts, context);
    const isHttps = finalUrl.startsWith('https:');
    return hstsProduct(evaluateHsts(hstsHeaderValues), {isHttps});
  }
}

export default HstsQuality;
export {UIStrings};
