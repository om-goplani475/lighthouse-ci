/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {evaluateCertificate, certificateProduct} from '../lib/transport-security.js';
import {resolveMainDocumentSecurity} from '../lib/transport-security-sources.js';

const UIStrings = {
  title: 'TLS certificate is valid and not close to expiring',
  failureTitle: 'TLS certificate is expired or not yet valid',
  description:
    "Reads the validity dates of the page's TLS certificate from the browser. Scores 1 with more " +
    'than 15 days left, 0.5 (with a warning) with 15 days or fewer left, and 0 once it has expired ' +
    'or is not yet valid. To fail CI only on expiry but be told at 15 days, assert `minScore: 0.5` ' +
    'as an error and `minScore: 1` as a warning. Chrome refuses to load a page whose certificate has ' +
    'already expired and Lighthouse then stops, so in practice this audit is the early warning ' +
    'before that happens; the 0 score is reachable only when certificate errors are ignored.',
};

class SslCertificateExpiry extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'ssl-certificate-expiry',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['DevtoolsLog', 'URL', 'fetchTime'],
      supportedModes: ['navigation'],
    };
  }

  /**
   * Thin on purpose, as `mixed-content`. "Now" is the run's own fetch time, so re-auditing saved
   * artifacts later gives the same answer as the original run.
   * @param {{DevtoolsLog: unknown, URL: unknown, fetchTime: string}} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const {finalUrl, securityDetails} = await resolveMainDocumentSecurity(artifacts, context);
    if (!finalUrl.startsWith('https:')) return {score: 1, notApplicable: true};
    const parsed = Date.parse(artifacts.fetchTime);
    const nowSeconds = Math.floor((Number.isFinite(parsed) ? parsed : Date.now()) / 1000);
    return certificateProduct(evaluateCertificate(securityDetails, nowSeconds));
  }
}

export default SslCertificateExpiry;
export {UIStrings};
