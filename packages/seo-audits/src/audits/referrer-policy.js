/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {headerValues, evaluateReferrerPolicy, headerProduct} from '../lib/security-headers.js';
import {resolveMainDocumentHeaders} from '../lib/transport-security-sources.js';

const UIStrings = {
  title: 'The Referrer-Policy does not leak full addresses',
  failureTitle: 'The Referrer-Policy is `unsafe-url`',
  description:
    'Advice, not a failure (a partial score). Only `unsafe-url` is faulted: it sends the full address of the page, ' +
    'path and query included, to every other site. A missing header is not faulted (every current browser defaults to ' +
    '`strict-origin-when-cross-origin`); the old default `no-referrer-when-downgrade` and unrecognised values are ' +
    'notes. A list of fallbacks is judged by its last recognised value, as browsers do. Only the main document is checked.',
};

class ReferrerPolicy extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'referrer-policy',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
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
    return headerProduct(
      evaluateReferrerPolicy(headerValues(headers, 'referrer-policy')),
      'Referrer-Policy'
    );
  }
}

export default ReferrerPolicy;
export {UIStrings};
