/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildDeviceParityProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'Mobile and desktop get the same page',
  failureTitle: 'Mobile and desktop get a different page',
  description:
    'Fetches the audited page twice (a mobile and a desktop user-agent, each with an lhci-seo-audits/1.0 token, 512 KiB, no redirect followed, LHCI_SEO_DEVICE_PARITY=0 switches it off) and fails when the title, meta description, canonical or noindex differs, or when mobile has over half fewer words. Internal links missing on mobile are a note (a responsive site often has a smaller mobile menu). Server HTML only: differences made by CSS or JavaScript between screen sizes are not seen.',
};

class DeviceContentParity extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'device-content-parity',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - custom artifacts are not part of Lighthouse's closed Artifacts type.
      requiredArtifacts: ['DeviceFetches'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/rendering.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildDeviceParityProduct(artifacts.DeviceFetches);
  }
}

export default DeviceContentParity;
export {UIStrings};
