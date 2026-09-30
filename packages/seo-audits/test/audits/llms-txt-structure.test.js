/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {default: LlmsTxtStructure} = require('../../src/audits/llms-txt-structure.js');

const run = (state, text = null) =>
  LlmsTxtStructure.audit({
    LlmsTxt: {
      url: 'https://example.com/llms.txt',
      state,
      status: state === 'present' ? 200 : 404,
      reason: null,
      text,
    },
  });

describe('llms-txt-structure audit', () => {
  it('passes a valid file and summarizes what it found', () => {
    const result = run('present', '# Site\n> summary\n\n## Docs\n- [a](https://e.com/a)\n');
    expect(result.score).toBe(1);
    expect(result.displayValue).toBe('1 link(s) in 1 section(s).');
    expect(result.details).toBeUndefined();
  });

  it('passes a minimal H1-only file and shows the optional-part notes without failing', () => {
    const result = run('present', '# Site\n');
    expect(result.score).toBe(1);
    expect(result.details.items.map(i => i.kind)).toEqual(['Note', 'Note']);
  });

  it('fails a file with no H1 and reports it as a Problem', () => {
    const result = run('present', 'Just some words.\n');
    expect(result.score).toBe(0);
    expect(result.explanation).toBe('1 problem(s) found in llms.txt.');
    expect(result.details.items[0]).toEqual({
      kind: 'Problem',
      line: '',
      detail: 'no H1 title (the only part the format requires)',
    });
  });

  it('fails malformed list items with their line numbers, listing problems before notes', () => {
    const result = run('present', '# Site\n\n## Docs\n- [ok](https://e.com/ok)\n- [broken link]\n');
    expect(result.score).toBe(0);
    expect(result.details.items[0]).toEqual({
      kind: 'Problem',
      line: '5',
      detail: 'list item in "Docs" starts like a link but is not in [name](url) form',
    });
    expect(result.details.items.slice(1).every(i => i.kind === 'Note')).toBe(true);
  });

  it('fails an HTML page served as llms.txt', () => {
    const result = run('present', '<!doctype html><html><body>App</body></html>');
    expect(result.score).toBe(0);
    expect(result.details.items[0].detail).toContain('HTML page, not markdown');
  });

  it('does not fail a file with a plain-list section, but shows it as a note (a real major-site file)', () => {
    const result = run(
      'present',
      '# Site\n> s\n## Docs\n- [a](https://e.com/a)\n## Languages\n- English\n- French\n'
    );
    expect(result.score).toBe(1);
    expect(result.details.items).toEqual([
      expect.objectContaining({
        kind: 'Note',
        detail: expect.stringContaining('section "Languages" has no links'),
      }),
    ]);
  });

  it('caps the problem rows at 30 and says how many more there are, keeping the true count', () => {
    const items = Array.from({length: 45}, (_, i) => `- [a${i}]()`).join('\n');
    const result = run('present', `# Site\n> s\n## Docs\n${items}\n`);
    expect(result.score).toBe(0);
    expect(result.explanation).toBe('45 problem(s) found in llms.txt.');
    const problems = result.details.items.filter(i => i.kind === 'Problem');
    expect(problems).toHaveLength(31);
    expect(problems[30].detail).toBe('and 15 more');
  });

  it.each([['absent'], ['unavailable']])('is notApplicable when the file is %s', state => {
    expect(run(state)).toEqual({score: null, notApplicable: true});
  });

  it('says in its own description that it is a proposal and makes no claim about use', () => {
    const description = LlmsTxtStructure.meta.description;
    expect(description).toContain('community proposal, not a ratified standard');
    expect(description).toContain('does not claim any search engine or AI system uses it');
    expect(description).toContain('A missing file is not a failure');
  });
});
