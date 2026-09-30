/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads the `LlmsTxt` artifact (see `../gatherers/llms-txt.js`); fetches nothing. The structural
 * rules live in `../lib/llms-txt.js`.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';
import {analyzeLlmsTxt} from '../lib/llms-txt.js';

const MAX_PROBLEM_ROWS = 30;

const UIStrings = {
  title: 'llms.txt follows the llms.txt format',
  failureTitle: 'llms.txt does not follow the llms.txt format',
  description:
    'Checks `/llms.txt`, if the site has one, against the format at llmstxt.org: an H1 title (the ' +
    'only required part), and any list items under H2 sections written as `[name](url)` links. A ' +
    'file that is really an HTML page (a single-page app answering every path with its index ' +
    'page) also fails. **llms.txt is a community proposal, not a ratified standard, and this audit ' +
    'does not claim any search engine or AI system uses it**: it only checks that a file you chose ' +
    'to publish is well-formed. A missing file is not a failure (the audit is not-applicable), ' +
    'because nothing requires one. Only `/llms.txt` at the site root is checked, and its links are ' +
    'not fetched.',
};

// @ts-expect-error - LlmsTxt isn't part of Lighthouse's own closed Artifacts type from an
// out-of-tree package — same boundary already documented in the other audits in this package.
class LlmsTxtStructure extends Audit {
  /**
   * @return {import('lighthouse/types/audit.js').default.Meta}
   */
  static get meta() {
    return {
      id: 'llms-txt-structure',
      title: UIStrings.title,
      failureTitle: UIStrings.failureTitle,
      description: UIStrings.description,
      // @ts-expect-error - see the class-level @ts-expect-error above.
      requiredArtifacts: ['LlmsTxt'],
    };
  }

  /**
   * @param {{LlmsTxt: import('../gatherers/llms-txt.js').LlmsTxtArtifact}} artifacts
   * @return {import('lighthouse/types/audit.js').default.Product}
   */
  static audit(artifacts) {
    const {state, text} = artifacts.LlmsTxt;
    if (state !== 'present' || text === null) {
      return {score: null, notApplicable: true};
    }

    const analysis = analyzeLlmsTxt(text);

    /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
    const headings = [
      {key: 'kind', valueType: 'text', label: 'Type'},
      {key: 'line', valueType: 'text', label: 'Line'},
      {key: 'detail', valueType: 'text', label: 'Detail'},
    ];
    const rows = [
      ...analysis.problems.slice(0, MAX_PROBLEM_ROWS).map(p => ({
        kind: 'Problem',
        line: p.line === null ? '' : String(p.line),
        detail: p.problem,
      })),
      ...analysis.notes.map(note => ({kind: 'Note', line: '', detail: note})),
    ];
    const hidden = analysis.problems.length - MAX_PROBLEM_ROWS;
    if (hidden > 0) {
      rows.splice(MAX_PROBLEM_ROWS, 0, {kind: 'Problem', line: '', detail: `and ${hidden} more`});
    }
    const details = rows.length ? Audit.makeTableDetails(headings, rows) : undefined;

    if (analysis.problems.length === 0) {
      const summary = `${analysis.linkCount} link(s) in ${analysis.sectionCount} section(s).`;
      return details
        ? {score: 1, displayValue: summary, details}
        : {score: 1, displayValue: summary};
    }
    return {
      score: 0,
      explanation: `${analysis.problems.length} problem(s) found in llms.txt.`,
      details,
    };
  }
}

export default LlmsTxtStructure;
export {UIStrings};
