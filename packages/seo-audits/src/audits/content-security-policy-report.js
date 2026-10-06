/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {headerValues, describeCsp, cspProduct} from '../lib/security-headers.js';
import {resolveMainDocumentHeaders} from '../lib/transport-security-sources.js';

const UIStrings = {
  title: 'Content-Security-Policy is reported',
  failureTitle: 'Content-Security-Policy is reported',
  description:
    'Informational (never fails a build). Reports whether the main document sends a Content-Security-Policy ' +
    '(or only a report-only one), whether it restricts scripts, allows `unsafe-inline` or `unsafe-eval`, and sets ' +
    '`frame-ancestors`. Lighthouse core has its own informational `csp-xss` audit; this one is shorter and does not ' +
    'judge. It is not a Google ranking requirement.',
};

class ContentSecurityPolicyReport extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'content-security-policy-report',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      scoreDisplayMode: Audit.SCORING_MODES.INFORMATIVE,
      requiredArtifacts: ['DevtoolsLog', 'URL'],
      supportedModes: ['navigation'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/security-headers.js`, unit-tested there.
   * @param {{DevtoolsLog: unknown, URL: unknown}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const {headers} = await resolveMainDocumentHeaders(artifacts, context);
    return cspProduct(
      describeCsp(
        headerValues(headers, 'content-security-policy'),
        headerValues(headers, 'content-security-policy-report-only')
      )
    );
  }
}

export default ContentSecurityPolicyReport;
export {UIStrings};
