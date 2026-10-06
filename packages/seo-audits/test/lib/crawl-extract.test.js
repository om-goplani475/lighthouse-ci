/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {createHash} = require('crypto');
const {extractPage, emptyExtract} = require('../../src/lib/crawl-extract.js');

const PAGE = 'https://example.com/shop/shoes';
const sha = (/** @type {string} */ s) => createHash('sha256').update(s).digest('hex');
const run = (/** @type {string | Buffer} */ html, truncated = false) =>
  extractPage(html, PAGE, {truncated});
const doc = (/** @type {string} */ head, /** @type {string} */ body) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('head fields', () => {
  it('reads title, description, canonical and robots metas', () => {
    const r = run(
      doc(
        '<title>  My  Shoes </title><meta name="description" content="Great   shoes"><link rel="canonical" href="/shop/shoes"><meta name="robots" content="noindex, follow"><meta name="GoogleBot" content="noarchive">',
        '<p>x</p>'
      )
    );
    expect(r.title).toBe('My Shoes');
    expect(r.description).toBe('Great shoes');
    expect(r.canonicals).toEqual(['/shop/shoes']);
    expect(r.robotsMetas).toEqual([
      {name: 'robots', content: 'noindex, follow'},
      {name: 'googlebot', content: 'noarchive'},
    ]);
  });

  it('is null / empty when the head has nothing', () => {
    const r = run(doc('', '<p>x</p>'));
    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
    expect(r.canonicals).toEqual([]);
    expect(r.robotsMetas).toEqual([]);
  });

  it('stops storing links once their URLs use up the per-page byte budget', () => {
    const long = (/** @type {number} */ n) =>
      `/p/${String(n).padStart(4, '0')}/${'a'.repeat(1_900)}`;
    const html = `<body>${Array.from(
      {length: 200},
      (_, n) => `<a href="${long(n)}">x${n}</a>`
    ).join('')}</body>`;
    const r = run(html);
    expect(r.links.length).toBeGreaterThan(10);
    expect(r.links.length).toBeLessThan(25);
    expect(r.links.reduce((sum, l) => sum + l.url.length, 0)).toBeLessThanOrEqual(40_000);
    expect(run('<body><a href="/a">a</a><a href="/b">b</a></body>').links).toHaveLength(2);
  });

  it('keeps the first title and the first description only', () => {
    const r = run(
      doc(
        '<title>One</title><title>Two</title><meta name="description" content="a"><meta name="description" content="b">',
        ''
      )
    );
    expect(r.title).toBe('One');
    expect(r.description).toBe('a');
  });

  it('matches rel tokens case-insensitively and ignores a link without href', () => {
    expect(run(doc('<link rel="Alternate CANONICAL" href="/c">', '')).canonicals).toEqual(['/c']);
    expect(run(doc('<link rel="canonical">', '')).canonicals).toEqual([]);
    expect(run(doc('<link rel="stylesheet" href="/a.css">', '')).canonicals).toEqual([]);
  });

  it('ignores head tags that are not really there: comments, script strings, noscript, template', () => {
    const r = run(
      doc(
        '<!-- <title>no</title><meta name="robots" content="noindex"> --><script>var s = \'<link rel="canonical" href="/no">\'</script><noscript><meta name="robots" content="noindex"></noscript><template><title>t</title></template><title>Real</title>',
        ''
      )
    );
    expect(r.title).toBe('Real');
    expect(r.robotsMetas).toEqual([]);
    expect(r.canonicals).toEqual([]);
  });

  it('does not read head fields from the body', () => {
    const r = run(
      doc(
        '',
        '<meta name="robots" content="noindex"><link rel="canonical" href="/x"><title>Body title</title>'
      )
    );
    expect(r.robotsMetas).toEqual([]);
    expect(r.canonicals).toEqual([]);
    expect(r.title).toBeNull();
  });

  it('decodes entities in the title and description', () => {
    const r = run(
      doc(
        '<title>Tom &amp; Jerry &#8211; 100&nbsp;%</title><meta name="description" content="a &lt;b&gt;">',
        ''
      )
    );
    expect(r.title).toBe('Tom & Jerry – 100 %');
    expect(r.description).toBe('a <b>');
  });

  it('caps the length of title, description and robots content, and the count of canonicals and metas', () => {
    const r = run(
      doc(
        `<title>${'t'.repeat(5000)}</title><meta name="description" content="${'d'.repeat(
          5000
        )}">${'<link rel="canonical" href="/c">'.repeat(
          20
        )}${'<meta name="robots" content="noindex">'.repeat(50)}`,
        ''
      )
    );
    expect(r.title && r.title.length).toBe(1000);
    expect(r.description && r.description.length).toBe(1000);
    expect(r.canonicals).toHaveLength(5);
    expect(r.robotsMetas).toHaveLength(20);
  });

  it('drops a canonical href that is absurdly long', () => {
    expect(
      run(doc(`<link rel="canonical" href="https://example.com/${'a'.repeat(5000)}">`, ''))
        .canonicals
    ).toEqual([]);
  });
});

describe('h1', () => {
  it('reads the first five non-empty h1 texts, collapsed and capped', () => {
    const r = run(
      doc(
        '',
        '<h1>  One\n two </h1><h1></h1><h1><span>Three</span></h1><h1>4</h1><h1>5</h1><h1>6</h1><h1>7</h1>'
      )
    );
    expect(r.h1).toEqual(['One two', 'Three', '4', '5', '6']);
    const long = run(doc('', `<h1>${'x'.repeat(2000)}</h1>`));
    expect(long.h1[0].length).toBe(300);
  });

  it('ignores an h1 that is hidden or inside a script or template', () => {
    const r = run(
      doc(
        '',
        '<h1 hidden>no</h1><template><h1>no</h1></template><script>"<h1>no</h1>"</script><h1>yes</h1>'
      )
    );
    expect(r.h1).toEqual(['yes']);
  });
});

describe('visible text, hash and word count', () => {
  it('excludes script, style, noscript, template, hidden elements and the head', () => {
    const r = run(
      doc(
        '<title>Not body text</title>',
        '<p>Hello</p><script>var secret = 1</script><style>.a{}</style><noscript>enable js</noscript><template><p>tpl</p></template><div hidden><p>gone <b>deep</b></p></div><p>World</p>'
      )
    );
    expect(r.textHash).toBe(sha('hello world'));
    expect(r.textLength).toBe(11);
    expect(r.wordCount).toBe(2);
  });

  it('collapses whitespace, lower-cases, and decodes entities', () => {
    const r = run(doc('', '<p>  Hello \n\t WORLD &amp; friends&nbsp;now </p>'));
    expect(r.textHash).toBe(sha('hello world & friends now'));
  });

  it('separates block elements but not inline ones', () => {
    expect(run(doc('', '<p>a</p><p>b</p>')).textHash).toBe(sha('a b'));
    expect(run(doc('', '<div>a</div>b')).textHash).toBe(sha('a b'));
    expect(run(doc('', '<b>wor</b>d <i>x</i><span>y</span>')).textHash).toBe(sha('word xy'));
    expect(run(doc('', 'one<br>two')).textHash).toBe(sha('one two'));
  });

  it('gives the same hash to the same text in different markup, and different hashes to different text', () => {
    const a = run(doc('<title>A</title>', '<div><p>Same text here</p></div>'));
    const b = run(
      doc(
        '<title>B</title><meta name="description" content="x">',
        '<section><span>Same</span> <em>text</em> here</section>'
      )
    );
    const c = run(doc('', '<p>Different text here</p>'));
    expect(a.textHash).toBe(b.textHash);
    expect(a.textHash).not.toBe(c.textHash);
  });

  it('handles an empty or text-free document', () => {
    const empty = run('');
    expect(empty).toEqual({...emptyExtract()});
    expect(empty.textHash).toBe(sha(''));
    expect(empty.wordCount).toBe(0);
    expect(run(doc('', '<img src="a.png"><script>x</script>')).textLength).toBe(0);
  });

  it('reads text from a page that has no <head> or <body> tags', () => {
    expect(run('<h1>Hi</h1><p>there world</p>').textHash).toBe(sha('hi there world'));
  });

  it('ends an unclosed <head> where the body starts', () => {
    const r = run('<html><head><title>T</title><body><p>visible text</p></body>');
    expect(r.textHash).toBe(sha('visible text'));
    expect(r.title).toBe('T');
  });

  it('counts words after normalising', () => {
    expect(run(doc('', '<p>one two  three\nfour</p>')).wordCount).toBe(4);
  });

  it('accepts a Buffer, a BOM, and invalid UTF-8 without throwing', () => {
    expect(run(Buffer.from(doc('<title>Buf</title>', '<p>x</p>'))).title).toBe('Buf');
    expect(run(String.fromCharCode(0xfeff) + doc('<title>Bom</title>', '')).title).toBe('Bom');
    const bad = Buffer.concat([
      Buffer.from('<p>caf'),
      Buffer.from([0xe9, 0xff, 0xfe]),
      Buffer.from('</p>'),
    ]);
    expect(() => run(bad)).not.toThrow();
  });
});

describe('links', () => {
  const links = (/** @type {string} */ body) => run(doc('', body)).links;

  it('keeps same-origin http(s) links, resolved, deduplicated, without the fragment', () => {
    expect(
      links(
        '<a href="/a">1</a><a href="/a#top">1</a><a href="b">3</a><a href="https://example.com/c?x=1">4</a><a href="//example.com/d">5</a>'
      ).map(l => l.url)
    ).toEqual([
      'https://example.com/a',
      'https://example.com/shop/b',
      'https://example.com/c?x=1',
      'https://example.com/d',
    ]);
  });

  it('drops cross-origin, other schemes, empty and credentialed links', () => {
    expect(
      links(
        '<a href="https://other.test/x">1</a><a href="http://example.com/x">2</a><a href="https://example.com:8443/">3</a><a href="mailto:a@b.c">4</a><a href="javascript:alert(1)">5</a><a href="tel:1">6</a><a href="">7</a><a>8</a><a href="https://u:p@example.com/">9</a><a href="https://example.com.evil.test/">10</a>'
      )
    ).toEqual([]); // an empty href is not a link to anything
  });

  it('notes nofollow, case-insensitively, among other rel tokens', () => {
    const l = links('<a href="/a" rel="NoFollow noopener">1</a><a href="/b" rel="noopener">2</a>');
    expect(l.map(x => [x.url, x.nofollow])).toEqual([
      ['https://example.com/a', true],
      ['https://example.com/b', false],
    ]);
  });

  it('ignores links that are hidden or inside a script, template or noscript', () => {
    expect(
      links(
        '<a hidden href="/a">1</a><template><a href="/b">2</a></template><noscript><a href="/c">3</a></noscript><script>"<a href=/d>"</script><div hidden><a href="/e">5</a></div>'
      )
    ).toEqual([]);
  });

  it('caps the number of links and drops absurdly long ones', () => {
    const many = Array.from({length: 500}, (_, i) => `<a href="/p/${i}">x</a>`).join('');
    expect(links(many)).toHaveLength(200);
    expect(links(`<a href="/${'a'.repeat(5000)}">x</a>`)).toEqual([]);
  });
});

describe('anchor text, rel flags and repeated links', () => {
  const links = (/** @type {string} */ body) => run(doc('', body)).links;

  it('records the anchor text, collapsed, with text from nested inline elements', () => {
    expect(links('<a href="/a">  Buy   <b>red</b>\n shoes </a>').map(l => l.anchor)).toEqual([
      'Buy red shoes',
    ]);
  });

  it('uses the image alt text when the link has no text of its own, and the text when it has both', () => {
    expect(links('<a href="/a"><img src="x.png" alt="Company logo"></a>')[0].anchor).toBe(
      'Company logo'
    );
    expect(links('<a href="/a">Home<img src="x.png" alt="ignored"></a>')[0].anchor).toBe('Home');
    expect(links('<a href="/a"><img src="x.png"></a>')[0].anchor).toBe('');
  });

  it('falls back to the accessible name (aria-label, then title) for an icon link with no text or alt', () => {
    expect(links('<a href="/a" aria-label="Open the cart"><svg></svg></a>')[0].anchor).toBe(
      'Open the cart'
    );
    expect(links('<a href="/a" title="Contact us"><svg></svg></a>')[0].anchor).toBe('Contact us');
    expect(links('<a href="/a" aria-label="Cart" title="Basket"></a>')[0].anchor).toBe('Cart');
    expect(links('<a href="/a" aria-label="Cart">Shop</a>')[0].anchor).toBe('Shop');
    expect(links('<a href="/a"><img alt="Logo"></a>')[0].anchor).toBe('Logo');
  });

  it('decodes entities and caps a long anchor at 100 characters', () => {
    expect(links('<a href="/a">Fish &amp; chips</a>')[0].anchor).toBe('Fish & chips');
    expect(links(`<a href="/a">${'word '.repeat(200)}</a>`)[0].anchor).toHaveLength(100);
  });

  it('keeps the same target once per distinct anchor text, so anchor diversity can be judged', () => {
    const l = links(
      '<a href="/a">click here</a><a href="/a">click here</a><a href="/a">our shoes</a>'
    );
    expect(l.map(x => x.anchor)).toEqual(['click here', 'our shoes']);
  });

  it('reads nofollow, sponsored and ugc independently', () => {
    const l = links(
      '<a href="/a" rel="sponsored">1</a><a href="/b" rel="UGC nofollow">2</a><a href="/c">3</a>'
    );
    expect(l.map(x => [x.nofollow, x.sponsored, x.ugc])).toEqual([
      [false, true, false],
      [true, false, true],
      [false, false, false],
    ]);
  });

  it('ends an unclosed link where the next one starts and at the end of the document', () => {
    const l = links('<a href="/a">first <a href="/b">second');
    expect(l.map(x => [x.url, x.anchor])).toEqual([
      ['https://example.com/a', 'first'],
      ['https://example.com/b', 'second'],
    ]);
  });

  it('does not attach text outside a link to the previous link', () => {
    expect(links('<a href="/a">in</a> out <p>more</p>')[0].anchor).toBe('in');
  });

  it('gives a link without a usable href no anchor of its own', () => {
    expect(links('<a>plain</a><a href="mailto:a@b.c">m</a>')).toEqual([]);
  });
});

describe('external links', () => {
  const ext = (/** @type {string} */ body) => run(doc('', body)).externalLinks;

  it('records other-origin http(s) links with their anchor and nofollow, once per URL', () => {
    expect(
      ext(
        '<a href="https://other.test/x#frag" rel="nofollow">Other</a><a href="https://other.test/x">Again</a><a href="http://example.com/x">Scheme</a><a href="https://example.com:8443/">Port</a>'
      )
    ).toEqual([
      {url: 'https://other.test/x', anchor: 'Other', nofollow: true},
      {url: 'http://example.com/x', anchor: 'Scheme', nofollow: false},
      {url: 'https://example.com:8443/', anchor: 'Port', nofollow: false},
    ]);
  });

  it('ignores other schemes, credentials, hidden and scripted links, and keeps same-origin links out', () => {
    expect(
      ext(
        '<a href="mailto:a@b.c">1</a><a href="javascript:x">2</a><a href="https://u:p@other.test/">3</a><a hidden href="https://other.test/h">4</a><script>"<a href=https://other.test/s>"</script><a href="/inside">5</a>'
      )
    ).toEqual([]);
  });

  it('caps the list at 20 per page and drops an absurdly long URL', () => {
    const many = Array.from({length: 100}, (_, i) => `<a href="https://o${i}.test/">x</a>`).join(
      ''
    );
    expect(ext(many)).toHaveLength(20);
    expect(ext(`<a href="https://other.test/${'a'.repeat(5000)}">x</a>`)).toEqual([]);
  });
});

describe('pagination links', () => {
  const pag = (/** @type {string} */ head, /** @type {string} */ body = '') =>
    run(doc(head, body)).pagination;

  it('reads <link rel=next|prev> from the head, resolved', () => {
    expect(
      pag('<link rel="next" href="/shop/shoes?page=3"><link rel="prev" href="?page=1">')
    ).toEqual({
      next: ['https://example.com/shop/shoes?page=3'],
      prev: ['https://example.com/shop/shoes?page=1'],
    });
  });

  it('reads rel=next|prev|previous on links in the body, case-insensitively, among other tokens', () => {
    expect(
      pag(
        '',
        '<a href="/p/3" rel="Next nofollow">n</a><a href="/p/1" rel="PREVIOUS">p</a><a href="/x">x</a>'
      )
    ).toEqual({next: ['https://example.com/p/3'], prev: ['https://example.com/p/1']});
  });

  it('deduplicates, caps at 5 each, and ignores an unusable or hidden link', () => {
    const body = Array.from({length: 20}, (_, i) => `<a href="/p/${i}" rel="next">x</a>`).join('');
    expect(pag('', body).next).toHaveLength(5);
    expect(pag('<link rel="next" href="/a"><link rel="next" href="/a">').next).toEqual([
      'https://example.com/a',
    ]);
    expect(
      pag('', '<a hidden href="/h" rel="next">x</a><a href="mailto:a@b.c" rel="next">m</a>')
    ).toEqual({
      next: [],
      prev: [],
    });
  });

  it('does not treat a body <link> as a head signal', () => {
    expect(pag('', '<link rel="next" href="/late">').next).toEqual([]);
  });
});

describe('truncated bodies', () => {
  it('drops the half-written last tag and anything after it', () => {
    const r = run(
      '<html><head><title>T</title></head><body><a href="/ok">x</a><a href="/very-long-pa',
      true
    );
    expect(r.links.map(l => l.url)).toEqual(['https://example.com/ok']);
    expect(r.textHash).not.toBe(sha('x /very-long-pa'));
  });

  it('is empty when there is not a single complete tag', () => {
    expect(run('just text no tags', true).textLength).toBe(0);
  });
});

describe('never throws, and stays fast on hostile input at the 512 KiB cap', () => {
  const CAP = 512 * 1024;
  const cut = (/** @type {string} */ s) => s.slice(0, CAP);
  const hostile = {
    'nested div': () => cut('<div>'.repeat(200_000)),
    'nested ul/li': () => cut('<ul><li>'.repeat(60_000)),
    'misnested b/i': () => cut('<b><i>'.repeat(100_000)),
    'nested table': () => cut('<table><tr><td>'.repeat(30_000)),
    'unclosed a': () => cut('<a href=/x>'.repeat(60_000)),
    'many external links': () => cut('<a href="https://o.test/1">x</a>'.repeat(15_000)),
    'one enormous anchor': () => cut(`<a href="/x">${'word '.repeat(200_000)}</a>`),
    'alt text flood': () =>
      cut(`<a href="/x">${'<img alt="a long alternative text">'.repeat(20_000)}</a>`),
    'pagination flood': () => cut('<a rel="next" href="/p/1">x</a>'.repeat(15_000)),
    '100k links': () => cut('<a href="/p/1">x</a>'.repeat(30_000)),
    '170k p': () => cut('<p>'.repeat(170_000)),
    'entity run': () => cut('&amp;&lt;&#x41;&nbsp;'.repeat(60_000)),
    'comment flood': () => cut('<!--'.repeat(120_000)),
    'huge attributes': () => cut(`<div ${'a=1 '.repeat(200_000)}>`),
    'script full of <': () => cut(`<script>${'if(a<b){x="<div>"}'.repeat(30_000)}`),
    'repeated body tags': () => cut('<body>'.repeat(80_000)),
    'repeated head tags': () => cut('<head>'.repeat(80_000)),
    'head then many bodies': () => cut(`<head>${'<body>'.repeat(60_000)}`),
    'deep hidden nesting': () => cut('<div hidden>'.repeat(40_000)),
    'many titles and h1': () => cut('<title>a</title><h1>b</h1>'.repeat(20_000)),
    'nul and control bytes': () => cut(`<p>${String.fromCharCode(0, 1, 2)}</p>`.repeat(40_000)),
  };

  for (const [name, make] of Object.entries(hostile)) {
    it(`${name}: extracted quickly (no quadratic blow-up) with bounded output`, () => {
      const html = make();
      const started = Date.now();
      const r = run(html);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(r.links.length).toBeLessThanOrEqual(200);
      expect(r.h1.length).toBeLessThanOrEqual(5);
      expect(r.canonicals.length).toBeLessThanOrEqual(5);
      expect(r.externalLinks.length).toBeLessThanOrEqual(20);
      expect(r.pagination.next.length).toBeLessThanOrEqual(5);
      expect(r.pagination.prev.length).toBeLessThanOrEqual(5);
      for (const link of r.links) expect(link.anchor.length).toBeLessThanOrEqual(100);
      expect(r.textHash).toMatch(/^[0-9a-f]{64}$/);
    });
  }

  it('returns an empty extract for input that is not even a string or buffer', () => {
    expect(extractPage(/** @type {any} */ (null), PAGE, {truncated: false})).toEqual(
      emptyExtract()
    );
    expect(extractPage(/** @type {any} */ (undefined), PAGE, {truncated: false})).toEqual(
      emptyExtract()
    );
  });
});
