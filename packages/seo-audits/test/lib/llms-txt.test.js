/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {analyzeLlmsTxt} = require('../../src/lib/llms-txt.js');

const VALID = `# Example Project

> A short summary of the project.

Some free-form notes.

## Docs

- [Quick start](https://example.com/docs/start.md): how to begin
- [API](https://example.com/docs/api.md)

## Optional

- [Changelog](/changelog.md): history
`;

describe('analyzeLlmsTxt', () => {
  it('accepts a complete file with no problems and no notes', () => {
    const result = analyzeLlmsTxt(VALID);
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result).toMatchObject({title: 'Example Project', sectionCount: 2, linkCount: 3});
  });

  it('accepts just an H1: it is the only required part, everything else is a note', () => {
    const result = analyzeLlmsTxt('# My Site\n');
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual([
      'no blockquote summary (optional)',
      'no H2 sections of links (optional)',
    ]);
  });

  it('fails a file with no H1, and an empty file', () => {
    const noH1 = analyzeLlmsTxt('> summary\n\n## Docs\n- [a](https://e.com/a)\n');
    expect(noH1.problems[0]).toEqual({
      line: null,
      problem: 'no H1 title (the only part the format requires)',
    });
    expect(analyzeLlmsTxt('').problems).toHaveLength(1);
    expect(analyzeLlmsTxt('   \n\n').problems[0].problem).toContain('no H1');
  });

  it('does not count an H2 as the H1', () => {
    expect(analyzeLlmsTxt('## Not a title\n').problems[0].problem).toContain('no H1');
  });

  it('fails an item that starts like a link but is not one, with its line', () => {
    const result = analyzeLlmsTxt(
      '# T\n\n## Docs\n- [ok](https://e.com/ok)\n- [no url]\n- [spaced] (https://e.com/x)\n'
    );
    expect(result.problems).toEqual([
      {line: 5, problem: 'list item in "Docs" starts like a link but is not in [name](url) form'},
      {line: 6, problem: 'list item in "Docs" starts like a link but is not in [name](url) form'},
    ]);
  });

  it('only notes, never fails, plain-text items and mid-sentence links in a link section (real files do this)', () => {
    const result = analyzeLlmsTxt(
      '# T\n> s\n## Docs\n- [a](https://e.com/a)\n- just some text\n- https://e.com/bare\n- The [Checkout API](https://e.com/c) to [build a page](https://e.com/p).\n'
    );
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual([
      '3 list item(s) in link sections are not [name](url) links (first at line 5)',
    ]);
  });

  it('ignores indented sub-bullets, which real files use as notes under a link', () => {
    const result = analyzeLlmsTxt(
      '# T\n> s\n## Docs\n- [a](https://e.com/a): main note\n  - a sub-bullet with [inline](https://e.com/i) links\n  - and plain text\n    - deeper still\n'
    );
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.linkCount).toBe(1);
  });

  it('does not fail a section that has no links at all: plain lists are free-form markdown (a real file does this)', () => {
    const result = analyzeLlmsTxt(
      '# T\n> s\n\n## Docs\n- [ok](https://e.com/ok)\n\n## Available Languages\n- English\n- French\n- German\n'
    );
    expect(result.problems).toEqual([]);
    expect(result.notes).toContain(
      'section "Available Languages" has no links (its 3 list item(s) are plain text, which the format allows)'
    );
  });

  it('flags an empty link URL and a non-http(s) scheme, but allows relative paths', () => {
    const result = analyzeLlmsTxt(
      '# T\n## Docs\n- [a]()\n- [b](mailto:x@e.com)\n- [c](javascript:alert(1))\n- [d](/relative.md)\n- [e](docs/rel.md)\n'
    );
    expect(result.problems.map(p => p.problem)).toEqual([
      'the link has an empty URL in "Docs"',
      'the link uses the "mailto:" scheme in "Docs"',
      'the link uses the "javascript:" scheme in "Docs"',
    ]);
    expect(result.linkCount).toBe(2);
  });

  it('notes text after a link that does not start with a colon, as one summary and never a failure', () => {
    const items = Array.from(
      {length: 40},
      (_, i) => `- [a${i}](https://e.com/${i}) extra words`
    ).join('\n');
    const result = analyzeLlmsTxt(`# T\n> s\n## Docs\n${items}\n`);
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual([
      '40 link(s) are followed by text that does not start with a colon (first at line 4)',
    ]);
  });

  it('ignores list items before the first H2 and inside code fences', () => {
    const result = analyzeLlmsTxt(
      '# T\n\n- free-form bullet, not a link\n\n```\n## Fake\n- not a link either\n```\n\n## Docs\n- [a](https://e.com/a)\n'
    );
    expect(result.problems).toEqual([]);
    expect(result.sectionCount).toBe(1);
  });

  it('accepts numbered and other bullet styles', () => {
    const result = analyzeLlmsTxt(
      '# T\n> s\n## Docs\n* [a](https://e.com/a)\n+ [b](https://e.com/b)\n1. [c](https://e.com/c)\n'
    );
    expect(result.problems).toEqual([]);
    expect(result.linkCount).toBe(3);
  });

  it('fails an HTML page served at /llms.txt, with one clear problem instead of a misleading "no H1"', () => {
    for (const html of [
      '<!DOCTYPE html><html><head></head></html>',
      '\n  <html lang="en"><body></body></html>',
    ]) {
      const result = analyzeLlmsTxt(html);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].problem).toContain('HTML page, not markdown');
    }
  });

  it('notes, but does not fail, an H1 that is not first, multiple H1s, and empty sections', () => {
    const result = analyzeLlmsTxt('> summary first\n# Title\n# Another\n## Empty\n');
    expect(result.problems).toEqual([]);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        'the H1 is not the first thing in the file',
        '2 H1 headings (the format has one)',
        'section "Empty" has no links',
      ])
    );
  });

  it('handles a BOM (the format allows one) and CRLF line endings', () => {
    const result = analyzeLlmsTxt(
      '﻿# Title\r\n\r\n> summary\r\n\r\n## Docs\r\n- [a](https://e.com/a)\r\n'
    );
    expect(result.problems).toEqual([]);
    expect(result.title).toBe('Title');
  });

  it('does not throw on odd input', () => {
    for (const input of ['\0\0\0', '#', '# ', '##', '- [', '[](', '```', '> > >']) {
      expect(() => analyzeLlmsTxt(input)).not.toThrow();
    }
  });
});
