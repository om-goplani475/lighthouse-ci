/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {articleValuesProduct} from '../lib/news.js';
import {entitiesFromArtifact} from '../lib/structured-facts.js';

const UIStrings = {
  title: 'Article markup values are well formed',
  failureTitle: 'Article markup values need attention',
  description:
    "Advice, not a failure (a partial score). For each Article, NewsArticle or BlogPosting in the page's JSON-LD, applies Google's article guidance: datePublished and dateModified in ISO 8601 (a missing timezone is a note) and dateModified not before datePublished; authors listed one each, as Person or Organization (never Thing), with only the name (no 'by' or 'posted by'); and paywall markup that uses isAccessibleForFree with a hasPart whose cssSelector is a single .class selector. A long headline (over 110 characters, our note, Google gives no limit), a missing author, image or headline are notes. Google documents no NewsArticle-only fields, so the whole article family is judged the same way. A page with no article markup is not applicable.",
};

// @ts-expect-error - StructuredDataJsonLd isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class ArticleValues extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'article-values',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['StructuredDataJsonLd'],
    };
  }

  /**
   * Thin on purpose: the logic is in `lib/news.js`, unit-tested there.
   * @param {{StructuredDataJsonLd: import('../types.js').StructuredDataJsonLdArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    return articleValuesProduct(entitiesFromArtifact(artifacts.StructuredDataJsonLd));
  }
}

export default ArticleValues;
export {UIStrings};
