/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {classifyMixedContent, mixedContentProduct} from '../lib/transport-security.js';
import {
  resolveInsecureRecords,
  resolveMainDocumentSecurity,
} from '../lib/transport-security-sources.js';

const UIStrings = {
  title: 'No insecure (mixed) content on this HTTPS page',
  failureTitle: 'Insecure (mixed) content found on this HTTPS page',
  description:
    'An HTTPS page that loads a resource over plain http:// lets anyone on the network change it. ' +
    'Active content (scripts, stylesheets, frames, fetch/XHR, fonts, forms) fails this audit: ' +
    'browsers block it, which breaks the page, and where they do not an attacker can take the page ' +
    'over. Passive content (images, audio, video) that Chrome upgraded to https:// or allowed is ' +
    'listed as a note and does not fail, unless the browser blocked it. Based on what Chrome ' +
    'reported and requested during this load, so a resource requested only after the page settles ' +
    "can be missed. Lighthouse's own `is-on-https` audit lists the same requests without this " +
    'active/passive split and stays in the report.',
};

class MixedContent extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'mixed-content',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['DevtoolsLog', 'InspectorIssues', 'URL'],
      supportedModes: ['navigation'],
    };
  }

  /**
   * Deliberately thin: the classification, scoring and table live in `lib/transport-security.js`,
   * unit-tested there. This method only resolves Lighthouse artifacts, which is verified by the live
   * `lhci collect` run instead (the same split as `robots-directives-report`).
   * @param {{
   *   DevtoolsLog: unknown,
   *   URL: unknown,
   *   InspectorIssues: {mixedContentIssue?: Array<{
   *     resourceType?: string, resolutionStatus: string, insecureURL: string,
   *   }>},
   * }} artifacts
   * @param {import('lighthouse/types/audit.js').default.Context} context
   * @return {Promise<import('lighthouse/types/audit.js').default.Product>}
   */
  static async audit(artifacts, context) {
    const {finalUrl} = await resolveMainDocumentSecurity(artifacts, context);
    const records = await resolveInsecureRecords(artifacts, context);
    const issues = artifacts.InspectorIssues.mixedContentIssue || [];
    return mixedContentProduct(classifyMixedContent({issues, records, pageUrl: finalUrl}));
  }
}

export default MixedContent;
export {UIStrings};
