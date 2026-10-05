/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildFieldVitalsProduct} from '../lib/field-vitals.js';

const UIStrings = {
  title: 'Real-user Core Web Vitals are not poor',
  failureTitle: 'Real-user Core Web Vitals are poor',
  description:
    'Reads real-visitor (field) data from the Chrome UX Report (CrUX), which a lab run cannot see. Judges Largest Contentful Paint, Interaction to Next Paint and Cumulative Layout Shift at the 75th percentile against Google published thresholds, and fails only when one is poor (LCP over 4 s, INP over 500 ms, CLS over 0.25); needs improvement is shown, not failed. OFF unless LHCI_SEO_CRUX_API_KEY is set: then each run sends the page origin and path (no query string, never a private address) to Google, with the key in a header. Not applicable without a key or when CrUX has no data.',
};

class CoreWebVitalsField extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'core-web-vitals-field',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - FieldData is a custom artifact, not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['FieldData'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/field-vitals.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildFieldVitalsProduct(artifacts.FieldData);
  }
}

export default CoreWebVitalsField;
export {UIStrings};
