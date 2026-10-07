/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import BaseGatherer from 'lighthouse/core/gather/base-gatherer.js';
import {resolveSerpPixelBudgetsRuleset} from '../rule-engine/registry.js';

/* eslint-env browser */

/**
 * @typedef {{text: string, widthPx: number, prefixWidths: number[]} | null} PixelWidthMeasurement
 * `prefixWidths[i]` is the width of the first `i + 1` characters (code points), for the first 400 only; the SERP preview
 * uses it to find where a text stops fitting.
 */
/**
 * @typedef {{
 *   title: PixelWidthMeasurement,
 *   description: PixelWidthMeasurement,
 *   titleElementCount: number,
 * }} PixelWidthArtifact
 */

// A real architectural exception, documented in docs/audit-specs/pixel-width-truncation.md: every
// other gatherer in this package is rule-agnostic. This one isn't, because the *font* used to
// measure pixel width is itself an assumption about Google's SERP rendering — there is no way to
// measure "pixel width" without first picking a font, so the gatherer resolves the ruleset for
// font values only. The pixel budget (maxWidthPx) stays the audit's own concern, resolved
// separately there.
const serpPixelBudgetsRuleset = resolveSerpPixelBudgetsRuleset();

/* c8 ignore start */
/**
 * @param {string} titleFont
 * @param {string} descriptionFont
 */
function collectPixelWidth(titleFont, descriptionFont) {
  const canvas = document.createElement('canvas');
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  /**
   * @param {string | null | undefined} text
   * @param {string} font
   */
  function measure(text, font) {
    if (!text) return null;
    ctx.font = font;
    /** @type {number[]} */
    const prefixWidths = [];
    let prefix = '';
    for (const character of Array.from(text).slice(0, 400)) {
      prefix += character;
      prefixWidths.push(Math.round(ctx.measureText(prefix).width * 10) / 10);
    }
    return {text, widthPx: ctx.measureText(text).width, prefixWidths};
  }

  const descriptionEl = document.querySelector('meta[name="description"]');

  return {
    title: measure(document.title, titleFont),
    description: measure(descriptionEl && descriptionEl.getAttribute('content'), descriptionFont),
    // Not pixel-width-related, but reads the same DOM in the same round-trip rather than paying
    // for a second gatherer/evaluate call for one integer. `document.title` only ever reflects
    // the *first* <title> element per the HTML spec, so a page with more than one needs this
    // separate count to even be detectable — document-title-quality's "multiple <title>
    // elements" check is why this field exists.
    // An inline SVG can carry its own <title> (an accessible name); only document titles count.
    titleElementCount: Array.from(document.querySelectorAll('title')).filter(t => !t.closest('svg'))
      .length,
  };
}
/* c8 ignore stop */

/**
 * Measures the rendered pixel width of the page's <title> and meta description, using an
 * off-screen canvas inside the page's own browser context — real font-metric measurement, not a
 * character-count approximation. Does not check presence/absence of either field (that's
 * document-title's and missing-meta-description's concern); a missing field is simply reported
 * as `null`. Also reports how many <title> elements the page has, for
 * document-title-quality's "multiple <title> elements" check.
 */
class PixelWidth extends BaseGatherer {
  /** @type {import('lighthouse/types/gatherer.js').default.GathererMeta} */
  meta = {
    supportedModes: ['snapshot', 'navigation'],
  };

  /**
   * @param {import('lighthouse/types/gatherer.js').default.Context} passContext
   * @return {Promise<PixelWidthArtifact>}
   */
  // @ts-expect-error - see the equivalent @ts-expect-error in gatherers/structured-data-json-ld.js
  // for why third-party gatherers can't satisfy Lighthouse's own closed GathererArtifacts union.
  getArtifact(passContext) {
    const driver = passContext.driver;

    return driver.executionContext.evaluate(collectPixelWidth, {
      args: [serpPixelBudgetsRuleset.title.font, serpPixelBudgetsRuleset.description.font],
      useIsolation: true,
      deps: [],
    });
  }
}

export default PixelWidth;
