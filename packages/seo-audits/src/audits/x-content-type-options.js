/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {headerValues, evaluateContentTypeOptions, headerProduct} from '../lib/security-headers.js';
import {resolveMainDocumentHeaders} from '../lib/transport-security-sources.js';

const UIStrings = {
  title: 'The page sends X-Content-Type-Options: nosniff',
  failureTitle: 'X-Content-Type-Options is missing or wrong',
  description:
    'Advice, not a failure (a partial score). `X-Content-Type-Options: nosniff` stops browsers guessing a file type ' +
    'that differs from the one declared, a common route for script injection through uploads. It is a hygiene ' +
    'signal, not a Google ranking requirement. Only the first value of the header is read, as browsers do; ' +
    'only the main document is checked.',
};

class XContentTypeOptions extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'x-content-type-options',
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
      evaluateContentTypeOptions(headerValues(headers, 'x-content-type-options')),
      'X-Content-Type-Options'
    );
  }
}

export default XContentTypeOptions;
export {UIStrings};
