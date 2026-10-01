/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  classifyMixedContent,
  mixedContentProduct,
  evaluateHsts,
  hstsProduct,
  findSecurityDetails,
  evaluateCertificate,
  certificateProduct,
  MAX_ROWS,
} = require('../../src/lib/transport-security.js');

const PAGE = 'https://example.com/';

/**
 * @param {string} url
 * @param {string} resourceType
 * @param {string} [resolutionStatus]
 */
const issue = (url, resourceType, resolutionStatus = 'MixedContentBlocked') => ({
  insecureURL: url,
  resourceType,
  resolutionStatus,
});

/**
 * @param {Array<any>} issues
 * @param {Array<any>} [records]
 * @param {string} [pageUrl]
 */
const classify = (issues, records = [], pageUrl = PAGE) =>
  classifyMixedContent({issues, records, pageUrl});

describe('classifyMixedContent', () => {
  it('is null for a page that is not https', () => {
    expect(classify([issue('http://a.test/x.js', 'Script')], [], 'http://example.com/')).toBeNull();
    expect(classify([], [], 'not a url')).toBeNull();
  });

  it('is empty for a page with no insecure resources', () => {
    expect(classify([])).toEqual({items: [], failing: 0, notes: 0});
  });

  it.each(['Script', 'Stylesheet', 'Frame', 'XMLHttpRequest', 'Font', 'Form', 'Worker', 'Import'])(
    'treats %s as active',
    type => {
      const result = classify([issue('http://a.test/r', type, 'MixedContentWarning')]);
      expect(result.items[0].kind).toBe('active');
      expect(result.failing).toBe(1);
    }
  );

  it.each(['Image', 'Audio', 'Video', 'Track', 'Favicon', 'PluginData'])(
    'treats %s as passive',
    type => {
      const result = classify([issue('http://a.test/r', type, 'MixedContentWarning')]);
      expect(result.items[0].kind).toBe('passive');
      expect(result.failing).toBe(0);
      expect(result.notes).toBe(1);
    }
  );

  it('treats a type it does not know as active, and a missing type as Unknown', () => {
    const odd = classify([issue('http://a.test/r', 'BrandNewThing', 'MixedContentWarning')]);
    expect(odd.items[0].kind).toBe('active');
    const none = classify([
      {insecureURL: 'http://a.test/r', resolutionStatus: 'MixedContentWarning'},
    ]);
    expect(none.items[0]).toMatchObject({type: 'Unknown', kind: 'active'});
  });

  it('maps the three Chrome resolutions', () => {
    const result = classify([
      issue('http://a.test/1', 'Image', 'MixedContentBlocked'),
      issue('http://a.test/2', 'Image', 'MixedContentAutomaticallyUpgraded'),
      issue('http://a.test/3', 'Image', 'MixedContentWarning'),
    ]);
    const by = Object.fromEntries(result.items.map(i => [i.url, i.resolution]));
    expect(by).toEqual({
      'http://a.test/1': 'blocked',
      'http://a.test/2': 'auto-upgraded',
      'http://a.test/3': 'allowed',
    });
  });

  it('fails on a blocked passive resource, but not on an upgraded or warned one', () => {
    expect(classify([issue('http://a.test/i.png', 'Image', 'MixedContentBlocked')]).failing).toBe(
      1
    );
    expect(
      classify([issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded')]).failing
    ).toBe(0);
    expect(classify([issue('http://a.test/i.png', 'Image', 'MixedContentWarning')]).failing).toBe(
      0
    );
  });

  it('picks up an http request that raised no issue, as allowed', () => {
    const result = classify([], [{url: 'http://a.test/s.js', resourceType: 'Script'}]);
    expect(result.items).toEqual([
      {url: 'http://a.test/s.js', type: 'Script', kind: 'active', resolution: 'allowed'},
    ]);
    expect(result.failing).toBe(1);
  });

  it('understands the network record vocabulary too (Media, XHR, Document)', () => {
    const result = classify(
      [],
      [
        {url: 'http://a.test/v.mp4', resourceType: 'Media'},
        {url: 'http://a.test/api', resourceType: 'XHR'},
        {url: 'http://a.test/frame', resourceType: 'Document'},
      ]
    );
    const kinds = Object.fromEntries(result.items.map(i => [i.url, i.kind]));
    expect(kinds).toEqual({
      'http://a.test/v.mp4': 'passive',
      'http://a.test/api': 'active',
      'http://a.test/frame': 'active',
    });
  });

  it('lets the issue win when a URL is in both sources, and counts it once', () => {
    const result = classify(
      [issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded')],
      [{url: 'http://a.test/i.png', resourceType: 'Image'}]
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].resolution).toBe('auto-upgraded');
  });

  it('ignores https and data: records', () => {
    const result = classify(
      [issue('data:image/png;base64,AAAA', 'Image', 'MixedContentWarning')],
      [
        {url: 'https://a.test/ok.png', resourceType: 'Image'},
        {url: 'data:image/png;base64,AAAA', resourceType: 'Image'},
      ]
    );
    expect(result.items).toEqual([]);
  });

  it('lists active items first, then by URL', () => {
    const result = classify([
      issue('http://a.test/b.png', 'Image', 'MixedContentWarning'),
      issue('http://a.test/z.js', 'Script', 'MixedContentBlocked'),
      issue('http://a.test/a.png', 'Image', 'MixedContentWarning'),
      issue('http://a.test/c.css', 'Stylesheet', 'MixedContentBlocked'),
    ]);
    expect(result.items.map(i => i.url)).toEqual([
      'http://a.test/c.css',
      'http://a.test/z.js',
      'http://a.test/a.png',
      'http://a.test/b.png',
    ]);
  });
});

describe('mixedContentProduct', () => {
  it('is not applicable when the page is not https', () => {
    expect(mixedContentProduct(null)).toEqual({score: 1, notApplicable: true});
  });

  it('passes with nothing to report', () => {
    expect(mixedContentProduct({items: [], failing: 0, notes: 0})).toEqual({score: 1});
  });

  it('fails on an active item and explains each row', () => {
    const product = mixedContentProduct(
      classify([
        issue('http://a.test/app.js', 'Script', 'MixedContentBlocked'),
        issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded'),
      ])
    );
    expect(product.score).toBe(0);
    expect(product.displayValue).toBe('2 insecure resources');
    expect(product.explanation).toMatch(/1 active or blocked/);
    const items = /** @type {any} */ (product.details).items;
    expect(items[0]).toMatchObject({kind: 'Active', resolution: 'Blocked'});
    expect(items[0].impact).toMatch(/did not load/);
    expect(items[1]).toMatchObject({kind: 'Passive', resolution: 'Auto-upgraded'});
    expect(items[1].impact).toMatch(/upgraded it to https/);
  });

  it('passes, with the rows shown as notes, when only passive content was upgraded or warned', () => {
    const product = mixedContentProduct(
      classify([
        issue('http://a.test/i.png', 'Image', 'MixedContentAutomaticallyUpgraded'),
        issue('http://a.test/j.png', 'Image', 'MixedContentWarning'),
      ])
    );
    expect(product.score).toBe(1);
    expect(product.displayValue).toBe('2 insecure resources');
    expect(product.explanation).toBeUndefined();
  });

  it('uses the singular for one resource', () => {
    const product = mixedContentProduct(
      classify([issue('http://a.test/i.png', 'Image', 'MixedContentWarning')])
    );
    expect(product.displayValue).toBe('1 insecure resource');
  });

  it(`caps the table at ${MAX_ROWS} rows and says how many were left out`, () => {
    const issues = Array.from({length: MAX_ROWS + 7}, (_, i) =>
      issue(`http://a.test/${String(i).padStart(3, '0')}.js`, 'Script', 'MixedContentBlocked')
    );
    const product = mixedContentProduct(classify(issues));
    const items = /** @type {any} */ (product.details).items;
    expect(items).toHaveLength(MAX_ROWS + 1);
    expect(items[MAX_ROWS].url).toBe('7 more not shown');
    expect(product.displayValue).toBe(`${MAX_ROWS + 7} insecure resources`);
  });
});

describe('evaluateHsts', () => {
  const problems = (/** @type {any} */ r) =>
    r.findings
      .filter((/** @type {any} */ f) => f.severity === 'problem')
      .map((/** @type {any} */ f) => f.directive);
  const notes = (/** @type {any} */ r) =>
    r.findings
      .filter((/** @type {any} */ f) => f.severity === 'note')
      .map((/** @type {any} */ f) => f.directive);

  it('fails when the header is absent', () => {
    const r = evaluateHsts([]);
    expect(r).toMatchObject({present: false, passes: false, headerCount: 0});
    expect(problems(r)).toEqual(['strict-transport-security']);
  });

  it('passes a one-year max-age with includeSubDomains', () => {
    const r = evaluateHsts(['max-age=31536000; includeSubDomains']);
    expect(r).toMatchObject({
      passes: true,
      maxAge: 31536000,
      includeSubDomains: true,
      preload: false,
    });
    expect(problems(r)).toEqual([]);
    expect(notes(r)).toEqual(['preload']);
  });

  it('passes at exactly one year and fails one second below', () => {
    expect(evaluateHsts(['max-age=31536000']).passes).toBe(true);
    const below = evaluateHsts(['max-age=31535999']);
    expect(below.passes).toBe(false);
    expect(problems(below)).toEqual(['max-age']);
  });

  it('notes, but does not fail, a missing includeSubDomains', () => {
    const r = evaluateHsts(['max-age=63072000']);
    expect(r.passes).toBe(true);
    expect(notes(r)).toContain('includeSubDomains');
  });

  it('fails a missing max-age, including an empty header value', () => {
    expect(problems(evaluateHsts(['includeSubDomains']))).toEqual(['max-age']);
    expect(problems(evaluateHsts(['']))).toEqual(['max-age']);
    expect(evaluateHsts(['']).present).toBe(true);
  });

  it('fails max-age=0 once, as "turns HSTS off"', () => {
    const r = evaluateHsts(['max-age=0']);
    expect(problems(r)).toEqual(['max-age']);
    expect(r.findings.find(f => f.severity === 'problem')?.finding).toMatch(/turns HSTS off/);
  });

  it('fails a malformed max-age', () => {
    for (const v of ['max-age=abc', 'max-age=-5', 'max-age=1.5', 'max-age=']) {
      const r = evaluateHsts([v]);
      expect(r.passes).toBe(false);
      expect(r.maxAge).toBeNull();
    }
  });

  it('accepts a quoted max-age, any case, extra spaces and trailing semicolons', () => {
    const r = evaluateHsts(['  MAX-AGE="31536000" ;  IncludeSubDomains ; ']);
    expect(r).toMatchObject({passes: true, maxAge: 31536000, includeSubDomains: true});
  });

  it('fails preload without includeSubDomains, and preload under one year', () => {
    expect(problems(evaluateHsts(['max-age=31536000; preload']))).toEqual(['preload']);
    expect(problems(evaluateHsts(['max-age=86400; includeSubDomains; preload']))).toEqual([
      'max-age',
      'preload',
    ]);
  });

  it('passes a complete preload-ready header with no notes about it', () => {
    const r = evaluateHsts(['max-age=63072000; includeSubDomains; preload']);
    expect(r.passes).toBe(true);
    expect(notes(r)).toEqual([]);
  });

  it('judges only the first of several headers and notes the rest', () => {
    const r = evaluateHsts(['max-age=31536000', 'max-age=0']);
    expect(r.passes).toBe(true);
    expect(r.headerCount).toBe(2);
    expect(notes(r)).toContain('strict-transport-security');
    expect(evaluateHsts(['max-age=0', 'max-age=31536000']).passes).toBe(false);
  });

  it('ignores a repeated max-age within one header and unknown directives', () => {
    const r = evaluateHsts(['max-age=31536000; max-age=1; frobnicate=1']);
    expect(r).toMatchObject({passes: true, maxAge: 31536000});
  });
});

describe('hstsProduct', () => {
  it('is not applicable on an http page', () => {
    expect(hstsProduct(evaluateHsts([]), {isHttps: false})).toEqual({
      score: 1,
      notApplicable: true,
    });
  });

  it('passes with a "present and sufficient" row first', () => {
    const product = hstsProduct(evaluateHsts(['max-age=31536000; includeSubDomains']), {
      isHttps: true,
    });
    expect(product.score).toBe(1);
    expect(product.explanation).toBeUndefined();
    const items = /** @type {any} */ (product.details).items;
    expect(items[0]).toMatchObject({directive: 'max-age', value: '31536000'});
    expect(items.some((/** @type {any} */ i) => /^Note: /.test(i.finding))).toBe(true);
  });

  it('fails with the problems as the explanation', () => {
    const product = hstsProduct(evaluateHsts([]), {isHttps: true});
    expect(product.score).toBe(0);
    expect(product.explanation).toMatch(/No Strict-Transport-Security header/);
    expect(/** @type {any} */ (product.details).items).toHaveLength(1);
  });
});

describe('findSecurityDetails', () => {
  const response = (/** @type {string} */ requestId, /** @type {any} */ securityDetails) => ({
    method: 'Network.responseReceived',
    params: {requestId, response: {url: 'https://example.com/', securityDetails}},
  });

  it('returns the details of the matching response', () => {
    const log = [
      {method: 'Network.requestWillBeSent', params: {requestId: 'A'}},
      response('B', {validTo: 1}),
      response('A', {validTo: 2}),
    ];
    expect(findSecurityDetails(log, 'A')).toEqual({validTo: 2});
  });

  it('takes the last matching response when a request id repeats', () => {
    expect(
      findSecurityDetails([response('A', {validTo: 1}), response('A', {validTo: 2})], 'A')
    ).toEqual({
      validTo: 2,
    });
  });

  it('is null with no match, no details, or a log that is not an array', () => {
    expect(findSecurityDetails([response('B', {validTo: 1})], 'A')).toBeNull();
    expect(findSecurityDetails([response('A', undefined)], 'A')).toBeNull();
    expect(findSecurityDetails([response('A', 'nope')], 'A')).toBeNull();
    expect(findSecurityDetails(undefined, 'A')).toBeNull();
    expect(findSecurityDetails({}, 'A')).toBeNull();
  });

  it('tolerates malformed entries', () => {
    const log = [
      null,
      7,
      {},
      {method: 'Network.responseReceived'},
      {method: 'Network.responseReceived', params: {requestId: 'A'}},
      response('A', {validTo: 3}),
    ];
    expect(findSecurityDetails(log, 'A')).toEqual({validTo: 3});
  });
});

describe('evaluateCertificate', () => {
  const DAY = 86_400;
  const NOW = 1_800_000_000;
  const cert = (/** @type {number} */ fromOffset, /** @type {number} */ toOffset, extra = {}) => ({
    subjectName: 'example.com',
    issuer: 'Test CA',
    validFrom: NOW + fromOffset,
    validTo: NOW + toOffset,
    ...extra,
  });

  it('is null without usable dates', () => {
    expect(evaluateCertificate(null, NOW)).toBeNull();
    expect(evaluateCertificate({}, NOW)).toBeNull();
    expect(evaluateCertificate({validFrom: NOW, validTo: NaN}, NOW)).toBeNull();
    expect(evaluateCertificate({validFrom: 'soon', validTo: NOW}, NOW)).toBeNull();
    expect(evaluateCertificate({validFrom: NOW, validTo: ''}, NOW)).toBeNull();
  });

  it('is ok well before expiry', () => {
    expect(evaluateCertificate(cert(-DAY, 60 * DAY), NOW)).toMatchObject({
      state: 'ok',
      daysRemaining: 60,
      subject: 'example.com',
      issuer: 'Test CA',
    });
  });

  it('warns at exactly 15 days and passes at 16', () => {
    expect(evaluateCertificate(cert(-DAY, 15 * DAY), NOW)?.state).toBe('expiring-soon');
    expect(evaluateCertificate(cert(-DAY, 16 * DAY), NOW)?.state).toBe('ok');
    expect(evaluateCertificate(cert(-DAY, 16 * DAY - 1), NOW)?.state).toBe('expiring-soon');
  });

  it('is expired at and after validTo, with a negative day count', () => {
    expect(evaluateCertificate(cert(-90 * DAY, 0), NOW)?.state).toBe('expired');
    const past = evaluateCertificate(cert(-90 * DAY, -3 * DAY), NOW);
    expect(past).toMatchObject({state: 'expired', daysRemaining: -3});
  });

  it('is not yet valid before validFrom', () => {
    expect(evaluateCertificate(cert(2 * DAY, 90 * DAY), NOW)?.state).toBe('not-yet-valid');
  });

  it('accepts dates given as numeric strings, and nulls out non-string names', () => {
    const r = evaluateCertificate(
      {validFrom: String(NOW - DAY), validTo: String(NOW + 30 * DAY), subjectName: 5, issuer: ''},
      NOW
    );
    expect(r).toMatchObject({state: 'ok', subject: null, issuer: null});
  });
});

describe('certificateProduct', () => {
  const DAY = 86_400;
  const NOW = 1_800_000_000;
  const product = (/** @type {number} */ toOffset, fromOffset = -90 * DAY) =>
    certificateProduct(
      evaluateCertificate(
        {
          subjectName: 'example.com',
          issuer: 'Test CA',
          validFrom: NOW + fromOffset,
          validTo: NOW + toOffset,
        },
        NOW
      )
    );

  it('is not applicable, with a reason, when there are no dates', () => {
    const p = certificateProduct(null);
    expect(p).toMatchObject({score: 1, notApplicable: true});
    expect(p.explanation).toMatch(/no certificate dates/);
  });

  it('passes with days remaining and no warning', () => {
    const p = product(60 * DAY);
    expect(p).toMatchObject({score: 1, displayValue: '60 days remaining'});
    expect(p.warnings).toBeUndefined();
    expect(/** @type {any} */ (p.details).items[0]).toMatchObject({
      subject: 'example.com',
      daysRemaining: 60,
    });
  });

  it('scores 0.5 with a warning inside the 15-day band', () => {
    const p = product(10 * DAY);
    expect(p.score).toBe(0.5);
    expect(p.displayValue).toBe('10 days remaining');
    expect(p.warnings).toHaveLength(1);
    expect(String(p.warnings && p.warnings[0])).toMatch(/example\.com .* renew/);
  });

  it('uses the singular for one day', () => {
    expect(product(DAY).displayValue).toBe('1 day remaining');
  });

  it('scores 0 when expired, saying when', () => {
    const p = product(-2 * DAY);
    expect(p.score).toBe(0);
    expect(p.displayValue).toBe('Expired');
    expect(p.explanation).toMatch(/expired on \d{4}-\d{2}-\d{2}/);
  });

  it('scores 0 when not yet valid', () => {
    const p = product(90 * DAY, 2 * DAY);
    expect(p.score).toBe(0);
    expect(p.explanation).toMatch(/not valid until/);
  });
});

describe('strings that come from the audited site are bounded', () => {
  const HUGE = 250_000;

  it('shortens an insecure URL in the mixed-content table', () => {
    const url = `http://insecure.test/${'a'.repeat(HUGE)}`;
    const product = mixedContentProduct(classify([issue(url, 'Script', 'MixedContentBlocked')]));
    const row = /** @type {any} */ (product.details).items[0];
    expect(row.url.length).toBeLessThan(1_200);
    expect(row.url.startsWith('http://insecure.test/aaa')).toBe(true);
    expect(row.url).toMatch(/more characters\)$/);
  });

  it('keeps the whole mixed-content product small however many long URLs there are', () => {
    const issues = Array.from({length: 80}, (_, i) =>
      issue(`http://insecure.test/${i}/${'a'.repeat(HUGE)}`, 'Script', 'MixedContentBlocked')
    );
    expect(JSON.stringify(mixedContentProduct(classify(issues))).length).toBeLessThan(100_000);
  });

  it('leaves a normal URL untouched', () => {
    const url = 'http://insecure.test/app.js?v=1';
    const row = /** @type {any} */ (
      mixedContentProduct(classify([issue(url, 'Script', 'MixedContentBlocked')])).details
    ).items[0];
    expect(row.url).toBe(url);
  });

  it('shortens a malformed max-age value echoed back from the header', () => {
    const product = hstsProduct(evaluateHsts([`max-age=${'x'.repeat(HUGE)}`]), {isHttps: true});
    expect(JSON.stringify(product).length).toBeLessThan(5_000);
  });

  it('shortens a certificate subject and issuer', () => {
    const r = evaluateCertificate(
      {
        subjectName: 's'.repeat(HUGE),
        issuer: 'i'.repeat(HUGE),
        validFrom: 1_700_000_000,
        validTo: 1_800_000_000,
      },
      1_750_000_000
    );
    expect(r && r.subject && r.subject.length).toBeLessThan(400);
    expect(r && r.issuer && r.issuer.length).toBeLessThan(400);
    expect(JSON.stringify(certificateProduct(r)).length).toBeLessThan(5_000);
  });
});
