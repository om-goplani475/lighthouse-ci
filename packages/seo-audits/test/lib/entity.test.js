/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  isEntity,
  parseMaxChecks,
  evaluateSameAs,
  sameAsValuesProduct,
  sameAsReachableProduct,
  findIdentityConflicts,
  identityConsistencyProduct,
  disambiguationProduct,
} = require('../../src/lib/entity.js');
const {ents, page, snapshot, artifact} = require('./vertical-fixtures.js');

const PAGE = 'https://www.acme.example/about';
const org = (over = {}) => ({
  '@type': 'Organization',
  '@id': 'https://www.acme.example/#org',
  name: 'Acme',
  url: 'https://www.acme.example/',
  logo: 'https://www.acme.example/logo.png',
  sameAs: ['https://www.facebook.com/acme', 'https://www.linkedin.com/company/acme'],
  ...over,
});
const problems = (over, url = PAGE) =>
  evaluateSameAs(ents(org(over)), url)
    .findings.filter(f => f.severity === 'problem')
    .map(f => f.detail);
const notes = (over, url = PAGE) =>
  evaluateSameAs(ents(org(over)), url)
    .findings.filter(f => f.severity === 'note')
    .map(f => f.detail);

describe('entity types', () => {
  it('recognises organizations and their subtypes, local businesses and people, but not articles or products', () => {
    for (const type of [
      'Organization',
      'NewsMediaOrganization',
      'Corporation',
      'Person',
      'Restaurant',
      'LocalBusiness',
    ]) {
      expect(isEntity(ents({'@type': type})[0])).toBe(true);
    }
    for (const type of ['Article', 'Product', 'WebSite', 'BreadcrumbList']) {
      expect(isEntity(ents({'@type': type})[0])).toBe(false);
    }
  });
});

describe('entity-same-as-values', () => {
  it('is not applicable without an entity that has a sameAs list, and passes good addresses', () => {
    expect(
      sameAsValuesProduct(ents({'@type': 'Organization', name: 'x'}), PAGE).notApplicable
    ).toBe(true);
    expect(
      sameAsValuesProduct(ents({'@type': 'Article', sameAs: ['https://x.example/a']}), PAGE)
        .notApplicable
    ).toBe(true);
    expect(sameAsValuesProduct([], PAGE).notApplicable).toBe(true);
    const ok = sameAsValuesProduct(ents(org()), PAGE);
    expect(ok.score).toBe(1);
    expect(ok.displayValue).toBe('1 entity checked');
  });

  it('flags a missing scheme, a non-http address, an invalid address, and a non-public host', () => {
    expect(problems({sameAs: ['facebook.com/acme']})[0]).toMatch(/has no scheme/);
    expect(problems({sameAs: ['mailto:hello@acme.example']})[0]).toMatch(
      /not an http\(s\) address/
    );
    expect(problems({sameAs: ['javascript:alert(1)']})[0]).toMatch(/not an http\(s\) address/);
    expect(problems({sameAs: ['not an address']})[0]).toMatch(/not a valid address/);
    for (const bad of [
      'https://localhost/a',
      'https://127.0.0.1/a',
      'https://intranet/a',
      'https://[::1]/a',
    ]) {
      expect(problems({sameAs: [bad]})[0]).toMatch(/not a public web address/);
    }
    expect(sameAsValuesProduct(ents(org({sameAs: ['facebook.com/acme']})), PAGE).score).toBe(0.5);
  });

  it('only notes http, duplicates, the page itself, the same site, and a very long list', () => {
    expect(notes({sameAs: ['http://www.facebook.com/acme']}).join(' ')).toMatch(/uses http/);
    expect(
      notes({sameAs: ['https://www.facebook.com/acme', 'https://www.facebook.com/acme/']}).join(' ')
    ).toMatch(/more than once/);
    expect(notes({sameAs: [PAGE]}).join(' ')).toMatch(/points to this page or entity itself/);
    expect(notes({sameAs: ['https://www.acme.example/#org']}).join(' ')).toMatch(
      /itself|same site/
    );
    expect(notes({sameAs: ['https://www.acme.example/other']}).join(' ')).toMatch(/same site/);
    expect(notes({sameAs: ['https://acme.example/other']}).join(' ')).toMatch(/same site/);
    expect(
      notes({sameAs: Array.from({length: 16}, (_, i) => `https://s${i}.example/acme`)}).join(' ')
    ).toMatch(/16 sameAs addresses/);
    expect(
      sameAsValuesProduct(ents(org({sameAs: ['http://www.facebook.com/acme']})), PAGE).score
    ).toBe(1);
  });

  it('handles a single string sameAs, a @graph, and hostile values', () => {
    expect(
      evaluateSameAs(ents(org({sameAs: 'https://www.facebook.com/acme'})), PAGE).findings
    ).toEqual([]);
    expect(() =>
      evaluateSameAs(ents(org({sameAs: [1, null, {}, [], 'https://']})), PAGE)
    ).not.toThrow();
    expect(() => evaluateSameAs(ents(org()), 'not a url')).not.toThrow();
  });

  it('lists the addresses on other sites worth requesting, without duplicates', () => {
    const r = evaluateSameAs(
      ents(
        org({
          sameAs: [
            'https://www.facebook.com/acme',
            'https://www.facebook.com/acme',
            'https://www.acme.example/x',
            'facebook.com/bad',
          ],
        })
      ),
      PAGE
    );
    expect(r.reachable).toEqual(['https://www.facebook.com/acme']);
  });
});

describe('parseMaxChecks', () => {
  it('defaults to 8, allows 0 to switch off, caps at 20, and ignores junk', () => {
    expect(parseMaxChecks({})).toBe(8);
    expect(parseMaxChecks({LHCI_SEO_SAMEAS_MAX_CHECKS: '0'})).toBe(0);
    expect(parseMaxChecks({LHCI_SEO_SAMEAS_MAX_CHECKS: '5'})).toBe(5);
    expect(parseMaxChecks({LHCI_SEO_SAMEAS_MAX_CHECKS: '500'})).toBe(20);
    for (const junk of ['abc', '-1', '1.5', '']) {
      expect(parseMaxChecks({LHCI_SEO_SAMEAS_MAX_CHECKS: junk})).toBe(8);
    }
    expect(parseMaxChecks(undefined)).toBe(8);
  });
});

describe('entity-same-as-reachable', () => {
  const siteOf = host => host.split('.').slice(-2).join('.');
  const run = (over, fetchStatus, max = 8) =>
    sameAsReachableProduct(ents(org(over)), PAGE, fetchStatus, siteOf, max);
  const ok = async () => ({status: 200});

  it('is not applicable when switched off, or without an address on another site', async () => {
    expect((await run({}, ok, 0)).explanation).toMatch(/switched off/);
    expect((await run({sameAs: undefined}, ok)).notApplicable).toBe(true);
    expect((await run({sameAs: ['https://www.acme.example/x']}, ok)).notApplicable).toBe(true);
  });

  it('passes when every address answers, using the public-only path for other sites', async () => {
    const calls = [];
    const r = await run({}, async (url, firstParty) => {
      calls.push([url, firstParty]);
      return {status: 200};
    });
    expect(r.score).toBe(1);
    expect(calls.map(c => c[1])).toEqual([false, false]);
  });

  it('warns for a 404, a 410 and a missing host, and only notes the refusals social networks give', async () => {
    expect(
      (await run({sameAs: ['https://www.facebook.com/gone']}, async () => ({status: 404}))).score
    ).toBe(0.5);
    expect(
      (await run({sameAs: ['https://x.example/gone']}, async () => ({status: 410}))).explanation
    ).toMatch(/profile page is gone/);
    const dns = await run({sameAs: ['https://nope.example/a']}, async () => {
      throw new Error('getaddrinfo ENOTFOUND nope.example');
    });
    expect(dns.score).toBe(0.5);
    for (const status of [401, 403, 429, 999, 503]) {
      const r = await run({sameAs: ['https://www.linkedin.com/company/acme']}, async () => ({
        status,
      }));
      expect(r.score).toBe(1);
      expect(r.details.items[0].result).toMatch(/^Note: answered/);
    }
  });

  it('describes a redirect as a redirect, not as a social network refusal', async () => {
    const r = await run({sameAs: ['http://www.example.org/profile']}, async () => ({status: 301}));
    expect(r.score).toBe(1);
    expect(r.details.items[0].result).toBe(
      'Note: answered 301, a redirect (not followed, so not judged).'
    );
  });

  it('checks no more than the budget, and says how many were not checked', async () => {
    const urls = Array.from({length: 12}, (_, i) => `https://s${i}.example/acme`);
    let calls = 0;
    const r = await run(
      {sameAs: urls},
      async () => {
        calls++;
        return {status: 200};
      },
      3
    );
    expect(calls).toBe(3);
    expect(r.displayValue).toMatch(/9 more addresses not checked/);
  });
});

// ---- crawl

const at = (url, entity, over = {}) => page(url, {entities: ents(entity), ...over});
const A = 'https://acme.example/a';
const B = 'https://acme.example/b';
const C = 'https://acme.example/c';

describe('entity-identity-consistency', () => {
  const run = pages => identityConsistencyProduct(artifact(snapshot(pages)));

  it('is not applicable without a crawl, without a shared entity, or when the audited page was refused', () => {
    expect(identityConsistencyProduct(artifact(null, 'disabled')).notApplicable).toBe(true);
    expect(run([at(A, org(), {source: 'audited'}), page(B)]).explanation).toMatch(
      /nothing to compare/
    );
    expect(run([at(A, org(), {source: 'audited', status: 403}), page(B)]).explanation).toMatch(
      /status 403/
    );
  });

  it('passes when the entity is described the same on every page, even if some pages list fewer profiles', () => {
    expect(
      run([
        at(A, org(), {source: 'audited'}),
        at(B, org()),
        at(C, org({sameAs: ['https://www.facebook.com/acme']})),
      ]).score
    ).toBe(1);
  });

  it('flags one @id with different names, logos or profile addresses for the same network', () => {
    const named = findIdentityConflicts(
      snapshot([at(A, org()), at(B, org({name: 'Acme Holdings'}))])
    );
    expect(named.conflicts[0].conflicts[0].field).toBe('name');
    const logo = findIdentityConflicts(
      snapshot([at(A, org()), at(B, org({logo: 'https://www.acme.example/old-logo.png'}))])
    );
    expect(logo.conflicts[0].conflicts.map(c => c.field)).toEqual(['logo']);
    const profile = findIdentityConflicts(
      snapshot([at(A, org()), at(B, org({sameAs: ['https://www.facebook.com/acme-inc']}))])
    );
    expect(profile.conflicts[0].conflicts.map(c => c.field)).toEqual(['sameAs (facebook.com)']);
  });

  it('does not flag a name that differs only by legal form, case or accents', () => {
    expect(
      findIdentityConflicts(snapshot([at(A, org()), at(B, org({name: 'ACME Inc.'}))])).conflicts
    ).toEqual([]);
  });

  it('groups by @id, else by url, and ignores entities with neither', () => {
    const byUrl = findIdentityConflicts(
      snapshot([
        at(A, org({'@id': undefined})),
        at(B, org({'@id': undefined, name: 'Other name entirely'})),
      ])
    );
    expect(byUrl.groups).toBe(1);
    expect(byUrl.conflicts).toHaveLength(1);
    expect(
      findIdentityConflicts(
        snapshot([
          at(A, org({'@id': undefined, url: undefined})),
          at(B, org({'@id': undefined, url: undefined, name: 'Z'})),
        ])
      ).groups
    ).toBe(0);
  });

  it('judges the audited page and lists the rest', () => {
    const audited = run([at(A, org({name: 'Acme Holdings'}), {source: 'audited'}), at(B, org())]);
    expect(audited.score).toBe(0.5);
    expect(audited.explanation).toMatch(
      /described differently on different pages \(name\), including this one/
    );
    const others = run([
      at(C, page(C), {source: 'audited'}),
      at(A, org({name: 'Acme Holdings'})),
      at(B, org()),
    ]);
    expect(others.score).toBe(1);
    expect(others.explanation).toMatch(/not judged/);
  });

  it('ignores noindex and unread pages', () => {
    const snap = snapshot([
      at(A, org()),
      at(B, org({name: 'Different Company'}), {
        robotsMetas: [{name: 'robots', content: 'noindex'}],
      }),
      at(C, org({name: 'Another'}), {status: 404}),
    ]);
    expect(findIdentityConflicts(snap).groups).toBe(0);
  });
});

describe('entity-disambiguation', () => {
  it('is not applicable without an entity, and tabulates the identity signals of each', () => {
    expect(disambiguationProduct(ents({'@type': 'Article'})).notApplicable).toBe(true);
    expect(disambiguationProduct([]).notApplicable).toBe(true);
    const r = disambiguationProduct(
      ents(org({leiCode: '5493001KJTIIGC8Y1R12', duns: '123456789'}), {
        '@type': 'Person',
        name: 'Ann Lee',
      })
    );
    expect(r.score).toBe(1);
    expect(r.displayValue).toBe('2 entities described');
    expect(r.details.items[0]).toMatchObject({
      entity: 'Acme',
      id: 'yes',
      url: 'yes',
      logo: 'yes',
      sameAs: '2',
      identifiers: 'leiCode, duns',
    });
    expect(r.details.items[1]).toMatchObject({
      entity: 'Ann Lee',
      id: 'no',
      url: 'no',
      logo: 'no',
      sameAs: '0',
      identifiers: 'none',
    });
  });
});
