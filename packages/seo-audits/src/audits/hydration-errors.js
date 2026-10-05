/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {buildHydrationProduct} from '../lib/rendering.js';

const UIStrings = {
  title: 'No hydration errors in the console',
  failureTitle: 'The console reports hydration errors',
  description:
    'Fails when the browser console logged a hydration mismatch (React, Vue, Angular or similar): the HTML the server sent did not match what JavaScript built, so content can change or disappear after load.',
};

class HydrationErrors extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'hydration-errors',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      requiredArtifacts: ['ConsoleMessages'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/rendering.js`, unit-tested there.
   * @param {any} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return buildHydrationProduct(artifacts.ConsoleMessages);
  }
}

export default HydrationErrors;
export {UIStrings};
