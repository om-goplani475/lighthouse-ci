/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  evaluateLocalValues,
  localValuesProduct,
  findNapConflicts,
  findNameConflicts,
  napProduct,
  nameProduct,
  localReportProduct,
  localSitemapProduct,
  localPages,
  samePhone,
  addressKey,
  normalizeName,
  openingHoursStringOk,
} = require('../../src/lib/local.js');
const {ents, page, snapshot, artifact, sitemaps} = require('./vertical-fixtures.js');

const business = (over = {}) => ({
  '@type': 'Restaurant',
  name: 'Acme Diner',
  telephone: '+1 555 010 0100',
  priceRange: '$$',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '1 Main St',
    addressLocality: 'Springfield',
    addressRegion: 'IL',
    postalCode: '62701',
    addressCountry: 'US',
  },
  geo: {'@type': 'GeoCoordinates', latitude: 39.78373, longitude: -89.65015},
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday'],
      opens: '09:00',
      closes: '17:00',
    },
  ],
  ...over,
});
const problems = over =>
  evaluateLocalValues(ents(business(over)))
    .findings.filter(f => f.severity === 'problem')
    .map(f => `${f.check}: ${f.detail}`);

describe('local-business-values', () => {
  it('is not applicable without a local business, and passes a complete one', () => {
    expect(localValuesProduct(ents({'@type': 'Organization', name: 'x'})).notApplicable).toBe(true);
    expect(localValuesProduct([]).notApplicable).toBe(true);
    const ok = localValuesProduct(ents(business()));
    expect(ok.score).toBe(1);
    expect(ok.details).toBeUndefined();
  });

  it('recognises local business subtypes', () => {
    for (const type of ['Dentist', 'Store', 'LocalBusiness', 'HairSalon']) {
      expect(evaluateLocalValues(ents(business({'@type': type}))).businesses).toBe(1);
    }
  });

  it('checks the phone number: 7 to 15 digits; a missing country code is only a note', () => {
    expect(problems({telephone: '12345'})[0]).toMatch(/has 5 digits/);
    expect(problems({telephone: '1'.repeat(16)})[0]).toMatch(/has 16 digits/);
    expect(problems({telephone: '(555) 010-0100'})).toEqual([]);
    const note = evaluateLocalValues(ents(business({telephone: '(555) 010-0100'}))).findings;
    expect(note[0]).toMatchObject({severity: 'note'});
    expect(note[0].detail).toMatch(/no country code/);
    expect(localValuesProduct(ents(business({telephone: '(555) 010-0100'}))).score).toBe(1);
  });

  it('checks geo: both values, numeric, in range, not 0,0, at least five decimals', () => {
    expect(problems({geo: {latitude: 39.78373}})[0]).toMatch(/both latitude and longitude/);
    expect(problems({geo: {latitude: 'north', longitude: 'west'}})[0]).toMatch(/not numeric/);
    expect(problems({geo: {latitude: 91.12345, longitude: 10.12345}})[0]).toMatch(
      /outside the valid range/
    );
    expect(problems({geo: {latitude: 0, longitude: 0}})[0]).toMatch(/placeholder/);
    expect(problems({geo: {latitude: '39.78', longitude: '-89.65'}})[0]).toMatch(
      /at least 5 decimal places/
    );
    expect(problems({geo: {latitude: '39.78373', longitude: '-89.65015'}})).toEqual([]);
  });

  it('checks opening hours: weekday names, 24-hour times, and the compact string form', () => {
    const spec = over => problems({openingHoursSpecification: [over]});
    expect(spec({dayOfWeek: 'Funday', opens: '09:00', closes: '17:00'})[0]).toMatch(
      /not a weekday name/
    );
    expect(spec({opens: '09:00', closes: '17:00'})[0]).toMatch(/no dayOfWeek/);
    expect(spec({dayOfWeek: 'Monday', opens: '9am', closes: '17:00'})[0]).toMatch(
      /not a 24-hour time/
    );
    expect(spec({dayOfWeek: 'Monday', opens: '09:00'})[0]).toMatch(/no closes time/);
    expect(
      spec({dayOfWeek: 'https://schema.org/Monday', opens: '09:00:00', closes: '03:00'})
    ).toEqual([]);
    expect(
      spec({dayOfWeek: ['Monday', 'PublicHolidays'], opens: '00:00', closes: '00:00'})
    ).toEqual([]);
    expect(
      problems({
        openingHoursSpecification: undefined,
        openingHours: ['Mo-Fr 09:00-17:00', 'Sa,Su 10:00-14:00'],
      })
    ).toEqual([]);
    expect(
      problems({openingHoursSpecification: undefined, openingHours: ['weekdays nine to five']})[0]
    ).toMatch(/not in the form/);
    expect(openingHoursStringOk('Mo-Fr 25:00-17:00')).toBe(false);
    expect(openingHoursStringOk('Xx 09:00-17:00')).toBe(false);
  });

  it('checks priceRange length and the address parts', () => {
    expect(problems({priceRange: '$'.repeat(100)})[0]).toMatch(/100 characters|fewer than 100/);
    expect(problems({address: {'@type': 'PostalAddress', streetAddress: '1 Main St'}})[0]).toMatch(
      /no addressLocality, addressCountry/
    );
    expect(problems({address: '1 Main St, Springfield'})[0]).toMatch(/Use a full PostalAddress/);
    expect(problems({address: {'@type': 'PostalAddress'}})[0]).toMatch(
      /no street, locality or country/
    );
  });

  it('warns (a partial score) with a table, and judges every business on the page', () => {
    const r = localValuesProduct(
      ents(
        business({geo: {latitude: 1.1, longitude: 2.2}}),
        business({name: 'Other', telephone: '123'})
      )
    );
    expect(r.score).toBe(0.5);
    expect(r.displayValue).toBe('2 value problems');
    expect(r.details.items.map(i => i.business)).toEqual(['Acme Diner', 'Other']);
  });
});

describe('helpers', () => {
  it('compares phone numbers with and without a country code, and ignores short ones', () => {
    expect(samePhone('+1 555 010 0100', '(555) 010-0100')).toBe(true);
    expect(samePhone('+44 20 7946 0958', '020 7946 0958')).toBe(true);
    expect(samePhone('555 010 0100', '555 010 0199')).toBe(false);
    expect(samePhone('123', '123')).toBe(false);
    expect(samePhone(null, '555 010 0100')).toBe(false);
  });

  it('normalises addresses and names', () => {
    const a = ents(business())[0];
    expect(addressKey(a)).toBe('1 main st springfield 62701');
    expect(
      addressKey({address: {streetAddress: 'x', addressLocality: null, postalCode: null}})
    ).toBeNull();
    expect(addressKey({address: null})).toBeNull();
    expect(normalizeName('The Acme Diner, Inc.')).toBe('acme diner');
    expect(normalizeName('Café René LLC')).toBe('cafe rene');
    expect(normalizeName(null)).toBe('');
  });
});

// ---- crawl

const at = (url, biz, over = {}) => page(url, {entities: ents(biz), ...over});
const A = 'https://site.example/a';
const B = 'https://site.example/b';
const C = 'https://site.example/c';

describe('local pages', () => {
  it('lists indexable pages that carry a local business', () => {
    const snap = snapshot([
      at(A, business()),
      page(B),
      at(C, business(), {robotsMetas: [{name: 'robots', content: 'noindex'}]}),
    ]);
    expect(localPages(snap).map(p => p.page.url)).toEqual([A]);
  });
});

describe('local-nap-consistency', () => {
  const run = pages => napProduct(artifact(snapshot(pages)));

  it('is not applicable without a crawl, without local pages, or with a single one', () => {
    expect(napProduct(artifact(null, 'disabled')).notApplicable).toBe(true);
    expect(run([page(A, {source: 'audited'})]).explanation).toMatch(/no page with local business/);
    expect(run([at(A, business(), {source: 'audited'})]).explanation).toMatch(/nothing to compare/);
  });

  it('passes when the same business shows the same phone and address everywhere', () => {
    expect(
      run([
        at(A, business({'@id': '#biz'}), {source: 'audited'}),
        at(B, business({'@id': '#biz', telephone: '(555) 010-0100'})),
      ]).score
    ).toBe(1);
  });

  it('flags one @id with two phone numbers or two addresses, judging the audited page', () => {
    const other = business({'@id': '#biz', telephone: '+1 555 010 0199'});
    const withAudited = run([at(A, business({'@id': '#biz'}), {source: 'audited'}), at(B, other)]);
    expect(withAudited.score).toBe(0.5);
    expect(withAudited.explanation).toMatch(
      /different phone numbers on different pages, including this one/
    );
    expect(withAudited.details.items.map(i => i.field)).toEqual(['telephone', 'telephone']);
    const addr = run([
      at(A, business({'@id': '#biz'}), {source: 'audited'}),
      at(
        B,
        business({
          '@id': '#biz',
          address: {
            streetAddress: '9 Other Rd',
            addressLocality: 'Springfield',
            postalCode: '62701',
          },
        })
      ),
    ]);
    expect(addr.details.items[0].field).toBe('address');
    // judged only when the audited page is involved: others are listed
    const others = run([
      at(C, business(), {source: 'audited'}),
      at(A, business({'@id': '#biz'})),
      at(B, other),
    ]);
    expect(others.score).toBe(1);
    expect(others.explanation).toMatch(/not judged/);
  });

  it('without an @id, flags the same name agreeing on phone but differing in address (or the reverse)', () => {
    const moved = business({
      address: {streetAddress: '9 Other Rd', addressLocality: 'Springfield', postalCode: '62701'},
    });
    const samePhoneNewAddress = findNapConflicts(
      localPages(snapshot([at(A, business()), at(B, moved)]))
    );
    expect(samePhoneNewAddress).toHaveLength(1);
    expect(samePhoneNewAddress[0]).toMatchObject({business: 'Acme Diner', field: 'address'});
    const newPhoneSameAddress = findNapConflicts(
      localPages(snapshot([at(A, business()), at(B, business({telephone: '+1 555 999 0000'}))]))
    );
    expect(newPhoneSameAddress[0].field).toBe('telephone');
  });

  it('does not flag a chain: the same name at a different address AND phone is another location', () => {
    const other = business({
      telephone: '+1 555 999 0000',
      address: {streetAddress: '9 Other Rd', addressLocality: 'Shelbyville', postalCode: '62565'},
    });
    expect(findNapConflicts(localPages(snapshot([at(A, business()), at(B, other)])))).toEqual([]);
  });

  it('does not flag names that differ only by legal form, or businesses missing a phone or address', () => {
    expect(
      findNapConflicts(
        localPages(snapshot([at(A, business()), at(B, business({name: 'The Acme Diner Inc.'}))]))
      )
    ).toEqual([]);
    expect(
      findNapConflicts(
        localPages(
          snapshot([
            at(A, business({telephone: undefined})),
            at(B, business({telephone: '+1 555 999 0000'})),
          ])
        )
      )
    ).toEqual([]);
  });
});

describe('local-name-consistency', () => {
  const run = pages => nameProduct(artifact(snapshot(pages)));

  it('is not applicable without enough pages', () => {
    expect(nameProduct(artifact(null, 'unavailable')).notApplicable).toBe(true);
    expect(run([at(A, business(), {source: 'audited'})]).notApplicable).toBe(true);
  });

  it('passes when the name is the same on every page', () => {
    expect(run([at(A, business(), {source: 'audited'}), at(B, business())]).score).toBe(1);
  });

  it('flags the same business (same phone) written differently, and different names for one @id', () => {
    const written = findNameConflicts(
      localPages(snapshot([at(A, business()), at(B, business({name: 'Acme Diner Inc.'}))]))
    );
    expect(written).toHaveLength(1);
    expect(written[0].kind).toBe('written differently');
    const different = findNameConflicts(
      localPages(
        snapshot([
          at(A, business({'@id': '#x'})),
          at(
            B,
            business({
              '@id': '#x',
              name: 'Blue Moon Cafe',
              telephone: undefined,
              address: undefined,
            })
          ),
        ])
      )
    );
    expect(different[0].kind).toBe('different names');
    const audited = run([
      at(A, business(), {source: 'audited'}),
      at(B, business({name: 'Acme Diner Ltd'})),
    ]);
    expect(audited.score).toBe(0.5);
    expect(audited.details.items.map(i => i.kind)).toEqual([
      'written differently',
      'written differently',
    ]);
  });

  it('does not join businesses that merely share a name when nothing else matches', () => {
    const other = business({
      telephone: '+1 555 999 0000',
      address: {streetAddress: '9 Other Rd', addressLocality: 'Shelbyville', postalCode: '62565'},
      name: 'Acme Diner Shelbyville',
    });
    expect(findNameConflicts(localPages(snapshot([at(A, business()), at(B, other)])))).toEqual([]);
  });

  it('survives a page that repeats one business many times', () => {
    const many = ents(...Array.from({length: 10}, () => business()));
    expect(() =>
      nameProduct(
        artifact(snapshot([page(A, {entities: many, source: 'audited'}), at(B, business())]))
      )
    ).not.toThrow();
  });
});

describe('local-pages-report', () => {
  it('lists the local pages with name, address and phone, and is not applicable without any', () => {
    const r = localReportProduct(
      artifact(snapshot([at(A, business(), {source: 'audited'}), page(B)]))
    );
    expect(r.score).toBe(1);
    expect(r.displayValue).toBe('1 page with a local business');
    expect(r.details.items[0]).toMatchObject({
      name: 'Acme Diner',
      address: '1 Main St, Springfield, 62701',
      telephone: '+1 555 010 0100',
    });
    expect(
      localReportProduct(artifact(snapshot([page(A, {source: 'audited'})]))).notApplicable
    ).toBe(true);
  });
});

describe('local-pages-in-sitemap', () => {
  it('judges the audited local page against the sitemap', () => {
    const snap = snapshot([at(A, business(), {source: 'audited'}), at(B, business({'@id': '#b'}))]);
    const listed = localSitemapProduct(artifact(snap), sitemaps([A, B]));
    expect(listed.score).toBe(1);
    const missing = localSitemapProduct(artifact(snap), sitemaps([B]));
    expect(missing.score).toBe(0.5);
    expect(missing.explanation).toMatch(/local business page is not in any sitemap/);
    expect(localSitemapProduct(artifact(snap), null).notApplicable).toBe(true);
  });
});
