/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {extractHeadSignals} = require('../../src/lib/html-head-signals.js');

const page = head =>
  `<!doctype html><html><head><title>T</title>${head}</head><body><h1>Hi</h1></body></html>`;
const extract = (html, truncated = false) => extractHeadSignals(Buffer.from(html), {truncated});

describe('extractHeadSignals — meta robots', () => {
  it('reads robots, googlebot and bingbot meta tags with their content', () => {
    const {metas} = extract(
      page(
        '<meta name="robots" content="noindex, follow"><meta name="googlebot" content="nofollow"><meta name="bingbot" content="none">'
      )
    );
    expect(metas).toEqual([
      {name: 'robots', content: 'noindex, follow'},
      {name: 'googlebot', content: 'nofollow'},
      {name: 'bingbot', content: 'none'},
    ]);
  });

  it('is case-insensitive on tag and attribute names and lowercases the name', () => {
    const {metas} = extract('<HTML><HEAD><META NAME="Robots" CONTENT="NoIndex"></HEAD></HTML>');
    expect(metas).toEqual([{name: 'robots', content: 'NoIndex'}]);
  });

  it('handles unquoted, single-quoted and reordered attributes', () => {
    const {metas} = extract(
      page("<meta content=noindex name=robots><meta content='none' name='googlebot'>")
    );
    expect(metas).toEqual([
      {name: 'robots', content: 'noindex'},
      {name: 'googlebot', content: 'none'},
    ]);
  });

  it('ignores other meta names and meta tags with no name', () => {
    const {metas} = extract(
      page(
        '<meta name="description" content="x"><meta charset="utf-8"><meta name="viewport" content="w"><meta property="og:title" content="t">'
      )
    );
    expect(metas).toEqual([]);
  });

  it('ignores a meta robots that only appears inside a comment, a script string, noscript or a template', () => {
    const {metas} = extract(
      page(
        '<!-- <meta name="robots" content="noindex"> -->' +
          '<script>var s = \'<meta name="robots" content="noindex">\';</script>' +
          '<style>/* <meta name="robots" content="noindex"> */</style>' +
          '<noscript><meta name="robots" content="noindex"></noscript>' +
          '<template><meta name="robots" content="noindex"></template>'
      )
    );
    expect(metas).toEqual([]);
  });

  it('ignores a meta robots in the body (not honored by search engines)', () => {
    const {metas} = extract(
      '<html><head><title>T</title></head><body><meta name="robots" content="noindex"></body></html>'
    );
    expect(metas).toEqual([]);
  });

  it('caps the number of metas and the content length', () => {
    const many = Array.from({length: 40}, () => '<meta name="robots" content="index">').join('');
    expect(extract(page(many)).metas).toHaveLength(20);
    const long = extract(page(`<meta name="robots" content="${'x'.repeat(5000)}">`)).metas[0];
    expect(long.content).toHaveLength(1000);
  });

  it('gives an empty content string for a meta with no content attribute', () => {
    expect(extract(page('<meta name="robots">')).metas).toEqual([{name: 'robots', content: ''}]);
  });
});

describe('extractHeadSignals — canonical', () => {
  it('reads an absolute and a relative canonical href', () => {
    expect(extract(page('<link rel="canonical" href="https://example.com/a">')).canonicals).toEqual(
      ['https://example.com/a']
    );
    expect(extract(page('<link rel="canonical" href="/relative/path">')).canonicals).toEqual([
      '/relative/path',
    ]);
  });

  it('matches rel tokens case-insensitively and among several tokens', () => {
    const {canonicals} = extract(
      page(
        '<link rel="Canonical" href="/a"><link rel="alternate canonical" href="/b"><link rel="canonicalx" href="/no"><link rel="stylesheet" href="/s.css">'
      )
    );
    expect(canonicals).toEqual(['/a', '/b']);
  });

  it('decodes entities in the href', () => {
    expect(
      extract(page('<link rel="canonical" href="https://e.com/a?x=1&amp;y=2">')).canonicals
    ).toEqual(['https://e.com/a?x=1&y=2']);
  });

  it('drops an empty or missing href and trims whitespace', () => {
    const {canonicals} = extract(
      page(
        '<link rel="canonical" href=""><link rel="canonical"><link rel="canonical" href="  /ok  ">'
      )
    );
    expect(canonicals).toEqual(['/ok']);
  });

  it('returns every canonical when there are several, capped at 5', () => {
    const links = Array.from({length: 9}, (_, i) => `<link rel="canonical" href="/c${i}">`).join(
      ''
    );
    expect(extract(page(links)).canonicals).toHaveLength(5);
  });

  it('ignores a canonical in a comment, a script string and the body', () => {
    const {canonicals} = extract(
      '<html><head><!-- <link rel="canonical" href="/c"> --><script>var l=\'<link rel="canonical" href="/s">\'</script></head><body><link rel="canonical" href="/b"></body></html>'
    );
    expect(canonicals).toEqual([]);
  });
});

describe('extractHeadSignals — headComplete and truncation', () => {
  it('is true for an untruncated document', () => {
    expect(extract(page('')).headComplete).toBe(true);
  });

  it('is false when the prefix ends inside the head', () => {
    const cut =
      '<!doctype html><html><head><title>T</title><meta name="robots" content="index"><script>var x=1;';
    const result = extract(cut, true);
    expect(result.headComplete).toBe(false);
    expect(result.metas).toEqual([{name: 'robots', content: 'index'}]);
  });

  it('is true when the prefix is truncated but the parser already reached the body', () => {
    const cut =
      '<html><head><title>T</title></head><body><p>a lot of content here that goes on and on';
    expect(extract(cut, true).headComplete).toBe(true);
  });

  it('keeps signals found before a tag that is cut off, and does not invent one from the fragment', () => {
    const cut =
      '<html><head><meta name="robots" content="noindex"><meta name="googlebot" content="no';
    const {metas, headComplete} = extract(cut, true);
    expect(metas.map(m => m.name)).toContain('robots');
    expect(headComplete).toBe(false);
  });

  it('is true for a headless document whose content starts straight away', () => {
    expect(extract('<p>hello</p><p>world</p>', true).headComplete).toBe(true);
  });
});

describe('extractHeadSignals — robustness', () => {
  it.each([[''], ['   '], ['plain text, not html'], ['<'], ['<html'], ['\0\0\0']])(
    'does not throw on %j',
    input => {
      expect(() => extract(input)).not.toThrow();
      expect(extract(input).metas).toEqual([]);
    }
  );

  it('accepts a string as well as a Buffer', () => {
    const html = page('<meta name="robots" content="noindex">');
    expect(extractHeadSignals(html, {truncated: false})).toEqual(extract(html));
  });

  it('handles multi-byte characters in content', () => {
    expect(extract(page('<meta name="robots" content="noindex €">')).metas[0].content).toBe(
      'noindex €'
    );
  });

  describe('adversarial 64 KiB inputs are parsed quickly (parse5 is quadratic in block-element nesting)', () => {
    const SIZE = 64 * 1024;
    const timed = html => {
      const started = Date.now();
      const result = extract(html, true);
      return {ms: Date.now() - started, result};
    };

    it.each([
      ['div'],
      ['ul'],
      ['ol'],
      ['dl'],
      ['nav'],
      ['pre'],
      ['menu'],
      ['main'],
      ['center'],
      ['section'],
    ])('deeply nested <%s>', tag => {
      const {ms} = timed(
        `<html><head><meta name="robots" content="noindex"></head><body>${`<${tag}>`.repeat(
          SIZE / (tag.length + 2)
        )}`
      );
      // 1.6 s before the tag limit; tens of ms after. The margin absorbs a slow CI machine.
      expect(ms).toBeLessThan(2500);
    });

    it.each([
      ['misnested <b><i>', '<b><i>'.repeat(SIZE / 6)],
      ['unclosed <a>', '<a href="x">'.repeat(SIZE / 11)],
      [
        'many attributes on one tag',
        `<div ${Array.from({length: SIZE / 8}, (_, i) => `a${i}=1`).join(' ')}>`,
      ],
      ['a table soup', '<table><tr><td>'.repeat(SIZE / 15)],
      ['unterminated comment', `<!--${'-'.repeat(SIZE)}`],
    ])('%s', (_label, body) => {
      const {ms} = timed(`<html><head><meta name="robots" content="noindex"></head><body>${body}`);
      expect(ms).toBeLessThan(2500);
    });

    it('still finds the head signals ahead of a hostile body, and knows the head was complete', () => {
      const {result} = timed(
        `<html><head><meta name="robots" content="noindex"><link rel="canonical" href="/c"></head><body>${'<div>'.repeat(
          SIZE / 5
        )}`
      );
      expect(result.metas).toEqual([{name: 'robots', content: 'noindex'}]);
      expect(result.canonicals).toEqual(['/c']);
      expect(result.headComplete).toBe(true);
    });

    it('cuts a tag flood but does not lose head signals that precede it, even with no body yet', () => {
      const flood = '<link rel="stylesheet" href="/x.css">'.repeat(3000);
      const result = extract(`<html><head><meta name="robots" content="noindex">${flood}`, true);
      expect(result.metas).toEqual([{name: 'robots', content: 'noindex'}]);
      expect(result.headComplete).toBe(false);
    });

    it('does not cut a normal, large page (a few hundred tags)', () => {
      const body = '<p>text</p>'.repeat(600);
      const result = extract(
        `<html><head><meta name="robots" content="noindex"><link rel="canonical" href="/c"></head><body>${body}</body></html>`
      );
      expect(result.metas).toHaveLength(1);
      expect(result.canonicals).toEqual(['/c']);
      expect(result.headComplete).toBe(true);
    });
  });
});
