/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-env jest */

const {
  evaluateVideoMarkup,
  videoValuesProduct,
  evaluateVideoSitemap,
  videoSitemapProduct,
  findEmbeddedVideos,
  videoDiscoverabilityProduct,
  videoThumbnailProduct,
  ISO_DURATION,
  MAX_THUMBNAILS,
} = require('../../src/lib/video.js');
const {ents} = require('./vertical-fixtures.js');

const video = (over = {}) => ({
  '@type': 'VideoObject',
  name: 'Intro',
  description: 'About us',
  thumbnailUrl: ['https://x.example/t.jpg'],
  uploadDate: '2026-10-01T10:00:00+00:00',
  duration: 'PT1M30S',
  contentUrl: 'https://x.example/v.mp4',
  ...over,
});
const problems = over =>
  evaluateVideoMarkup(ents(video(over)))
    .findings.filter(f => f.severity === 'problem')
    .map(f => `${f.check}: ${f.detail}`);
const notes = over =>
  evaluateVideoMarkup(ents(video(over)))
    .findings.filter(f => f.severity === 'note')
    .map(f => `${f.check}: ${f.detail}`);

describe('ISO 8601 durations', () => {
  it('accepts real durations and rejects malformed ones', () => {
    for (const d of [
      'PT1M30S',
      'PT30S',
      'PT2H',
      'P1DT2H3M4S',
      'P2W',
      'PT0.5S',
      'PT00H30M5S',
      'P1Y2M',
    ]) {
      expect(ISO_DURATION.test(d)).toBe(true);
    }
    for (const d of ['', 'P', 'PT', '1:30', '90', 'PT1M30', '1M30S', 'P1DT', 'pt1m']) {
      expect(ISO_DURATION.test(d)).toBe(false);
    }
  });
});

describe('video-structured-data-values', () => {
  it('is not applicable without a VideoObject, and passes a complete one', () => {
    expect(videoValuesProduct(ents({'@type': 'Article'})).notApplicable).toBe(true);
    expect(videoValuesProduct([]).notApplicable).toBe(true);
    const ok = videoValuesProduct(ents(video()));
    expect(ok.score).toBe(1);
    expect(ok.displayValue).toBe('1 video checked');
  });

  it('flags a date or duration that is not ISO 8601', () => {
    expect(problems({uploadDate: 'October 1'})[0]).toMatch(
      /uploadDate "October 1" is not an ISO 8601 date/
    );
    expect(problems({expires: '2027-13-01'})[0]).toMatch(/expires/);
    expect(problems({duration: '1:30'})[0]).toMatch(/duration "1:30" is not an ISO 8601 duration/);
    expect(problems({duration: 'PT'})[0]).toMatch(/duration/);
    expect(problems({uploadDate: '2026-10-01', duration: 'P1DT2H'})).toEqual([]);
  });

  it('only notes a missing timezone, relative urls, no content or embed url, and no description', () => {
    expect(notes({uploadDate: '2026-10-01T10:00:00'}).join(' ')).toMatch(/no timezone/);
    expect(notes({thumbnailUrl: ['/t.jpg']}).join(' ')).toMatch(/not an absolute/);
    expect(notes({contentUrl: '/v.mp4'}).join(' ')).toMatch(
      /contentUrl "\/v.mp4" is not an absolute/
    );
    expect(notes({contentUrl: undefined}).join(' ')).toMatch(/Neither contentUrl nor embedUrl/);
    expect(
      notes({contentUrl: undefined, embedUrl: 'https://x.example/embed'}).join(' ')
    ).not.toMatch(/Neither/);
    expect(notes({description: undefined}).join(' ')).toMatch(/No description/);
    expect(videoValuesProduct(ents(video({description: undefined}))).score).toBe(1);
  });

  it('flags videos on the page that share a name or a description', () => {
    const r = evaluateVideoMarkup(
      ents(
        video({name: 'Same', description: 'A'}),
        video({name: 'same', description: 'B', contentUrl: 'https://x.example/2.mp4'}),
        video({name: 'Other', description: 'a'})
      )
    );
    const found = r.findings.filter(f => f.severity === 'problem').map(f => f.check);
    expect(found.sort()).toEqual(['description', 'name']);
    expect(videoValuesProduct(ents(video({name: 'Same'}), video({name: 'Same'}))).score).toBe(0.5);
  });

  it('judges every video, naming each in the table', () => {
    const r = videoValuesProduct(
      ents(
        video({name: 'A', duration: 'bad'}),
        video({name: 'B', uploadDate: 'bad', description: 'Other'})
      )
    );
    expect(r.score).toBe(0.5);
    expect(r.displayValue).toBe('2 value problems');
    expect(r.details.items.map(i => i.video)).toEqual(['A', 'B']);
  });
});

// ---- sitemap

const entry = (over = {}) => ({
  loc: 'https://x.example/watch',
  thumbnailLoc: 'https://x.example/t.jpg',
  title: 'Intro',
  description: 'About',
  contentLoc: 'https://x.example/v.mp4',
  playerLoc: null,
  duration: '120',
  rating: '4.5',
  publicationDate: '2026-10-01',
  expirationDate: null,
  tags: 3,
  ...over,
});
const sm = (videos, over = {}) => ({
  discovery: 'robots-txt',
  documentsTruncated: false,
  documents: [
    {
      url: 'https://x.example/video.xml',
      outcome: 'ok',
      kind: 'urlset',
      locs: [],
      videos,
      videosTruncated: false,
      ...over,
    },
  ],
});

describe('video-sitemap-valid', () => {
  it('is not applicable without video entries, and says when a sitemap could not be read', () => {
    expect(videoSitemapProduct(null).notApplicable).toBe(true);
    expect(videoSitemapProduct(sm([])).notApplicable).toBe(true);
    const unread = {
      documentsTruncated: false,
      documents: [{url: 'http://x.example/v.xml', outcome: 'redirect', videos: [], locs: []}],
    };
    expect(videoSitemapProduct(unread).explanation).toMatch(/1 sitemap file could not be read/);
  });

  it('passes a complete entry, with either content_loc or player_loc', () => {
    expect(videoSitemapProduct(sm([entry()])).score).toBe(1);
    expect(
      videoSitemapProduct(sm([entry({contentLoc: null, playerLoc: 'https://x.example/player'})]))
        .score
    ).toBe(1);
  });

  it('fails (an error-tier defect) for each missing required tag', () => {
    const run = over => evaluateVideoSitemap(sm([entry(over)])).problems.map(p => p.check);
    expect(run({thumbnailLoc: null})).toEqual(['video:thumbnail_loc']);
    expect(run({title: null})).toEqual(['video:title']);
    expect(run({description: null})).toEqual(['video:description']);
    expect(run({contentLoc: null})).toEqual(['video:content_loc']);
    expect(videoSitemapProduct(sm([entry({title: null})])).score).toBe(0);
  });

  it('checks the limits: description 2,048, duration 1 to 28,800, rating 0 to 5, 32 tags', () => {
    const run = over => evaluateVideoSitemap(sm([entry(over)])).problems.map(p => p.check);
    expect(run({description: 'x'.repeat(2049)})).toEqual(['video:description']);
    expect(run({description: 'x'.repeat(2048)})).toEqual([]);
    for (const bad of ['0', '28801', '1.5', 'PT1M', '-5', '']) {
      expect(run({duration: bad})).toEqual(['video:duration']);
    }
    for (const ok of ['1', '28800', '3600']) expect(run({duration: ok})).toEqual([]);
    for (const bad of ['5.1', '-1', 'five']) expect(run({rating: bad})).toEqual(['video:rating']);
    for (const ok of ['0', '0.0', '5', '4.99']) expect(run({rating: ok})).toEqual([]);
    expect(run({tags: 33})).toEqual(['video:tag']);
    expect(run({tags: 32})).toEqual([]);
  });

  it('checks dates and addresses, and that the video is not the page itself', () => {
    const run = over => evaluateVideoSitemap(sm([entry(over)])).problems.map(p => p.check);
    expect(run({publicationDate: '1 Oct 2026'})).toEqual(['video:publication_date']);
    expect(run({expirationDate: 'soon'})).toEqual(['video:expiration_date']);
    expect(
      run({publicationDate: '2026-10-01T10:00:00+00:00', expirationDate: '2027-01-01'})
    ).toEqual([]);
    expect(run({thumbnailLoc: '/t.jpg'})).toEqual(['video:thumbnail_loc']);
    expect(run({contentLoc: '/v.mp4'})).toEqual(['video:content_loc']);
    expect(run({contentLoc: 'https://x.example/watch'})).toEqual(['video:content_loc']);
    expect(run({contentLoc: null, playerLoc: 'https://x.example/watch'})).toEqual([
      'video:player_loc',
    ]);
  });

  it('lists each problem with the page it is on', () => {
    const r = videoSitemapProduct(
      sm([entry({title: null}), entry({loc: 'https://x.example/other', duration: '0'})])
    );
    expect(r.details.items.map(i => [i.loc, i.check])).toEqual([
      ['https://x.example/watch', 'video:title'],
      ['https://x.example/other', 'video:duration'],
    ]);
  });

  it('only reads documents that were read in full', () => {
    expect(
      evaluateVideoSitemap({
        documents: [{outcome: 'http-error', videos: [entry({title: null})], locs: []}],
      }).videos
    ).toBe(0);
  });
});

// ---- discoverability

describe('findEmbeddedVideos', () => {
  const found = html => findEmbeddedVideos(html).embeds;

  it('finds a <video> with a src or a <source>, and known player iframes', () => {
    expect(found('<video controls src="/a.mp4"></video>')).toEqual([
      {kind: 'video', src: '/a.mp4'},
    ]);
    expect(found('<video controls><source src="/b.webm" type="video/webm"></video>')).toEqual([
      {kind: 'video', src: '/b.webm'},
    ]);
    expect(found('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toEqual([
      {kind: 'iframe', src: 'https://www.youtube.com/embed/abc'},
    ]);
    expect(found('<iframe data-src="https://player.vimeo.com/video/1"></iframe>')).toHaveLength(1);
    expect(found('<iframe src="//www.youtube-nocookie.com/embed/x"></iframe>')).toHaveLength(1);
  });

  it('ignores decorative background video, a video with no source, and iframes that are not players', () => {
    expect(found('<video autoplay muted loop playsinline src="/bg.mp4"></video>')).toEqual([]);
    expect(found('<video autoplay loop src="/bg.mp4"></video>')).toEqual([]);
    expect(found('<video autoplay muted controls src="/a.mp4"></video>')).toHaveLength(1);
    expect(found('<video controls></video>')).toEqual([]);
    expect(
      found('<iframe src="https://maps.example.com/embed"></iframe><iframe></iframe>')
    ).toEqual([]);
    expect(found('<iframe src="https://youtube.com.evil.example/embed"></iframe>')).toEqual([]);
    expect(found('<videos src="/x"></videos>')).toEqual([]);
  });

  it('notices Microdata VideoObject and survives hostile input', () => {
    expect(
      findEmbeddedVideos('<div itemtype="https://schema.org/VideoObject"></div>').hasMicrodata
    ).toBe(true);
    expect(
      findEmbeddedVideos('<div itemtype="https://schema.org/Product"></div>').hasMicrodata
    ).toBe(false);
    for (const bad of [
      null,
      undefined,
      5,
      '',
      '<video',
      '<iframe',
      '<video src=">',
      '<'.repeat(100000),
    ]) {
      expect(() => findEmbeddedVideos(bad)).not.toThrow();
    }
    const many = '<video controls src="/a.mp4"></video>'.repeat(500);
    expect(found(many).length).toBeLessThanOrEqual(50);
  });
});

describe('video-discoverability', () => {
  const html = '<video controls src="/a.mp4"></video>';

  it('is not applicable without a rendered page, or without an embedded video', () => {
    expect(videoDiscoverabilityProduct(null, []).notApplicable).toBe(true);
    expect(videoDiscoverabilityProduct({html: '<p>none</p>'}, []).notApplicable).toBe(true);
    expect(
      videoDiscoverabilityProduct({html: '<video autoplay muted loop src="/bg.mp4"></video>'}, [])
        .notApplicable
    ).toBe(true);
  });

  it('warns when a video is embedded with no video markup, and lists the embeds', () => {
    const r = videoDiscoverabilityProduct({html}, ents({'@type': 'Article', name: 'x'}));
    expect(r.score).toBe(0.5);
    expect(r.displayValue).toBe('1 embedded video without markup');
    expect(r.details.items[0]).toEqual({kind: '<video>', src: '/a.mp4'});
  });

  it('passes with VideoObject JSON-LD or Microdata', () => {
    expect(videoDiscoverabilityProduct({html}, ents(video())).score).toBe(1);
    expect(
      videoDiscoverabilityProduct(
        {html: `${html}<div itemscope itemtype="https://schema.org/VideoObject"></div>`},
        []
      ).score
    ).toBe(1);
  });
});

// ---- thumbnails

describe('video-thumbnail-reachable', () => {
  const siteOf = host => host.split('.').slice(-2).join('.');
  const page = 'https://www.x.example/watch';
  const run = (thumbs, fetchStatus) =>
    videoThumbnailProduct(ents(video({thumbnailUrl: thumbs})), page, fetchStatus, siteOf);
  const ok = async () => ({status: 200});

  it('is not applicable without a usable thumbnail', async () => {
    expect((await videoThumbnailProduct([], page, ok, siteOf)).notApplicable).toBe(true);
    expect((await run(['/relative.jpg'], ok)).notApplicable).toBe(true);
  });

  it('passes when every thumbnail answers 2xx, and passes whether the site is first party or not', async () => {
    const calls = [];
    const r = await run(
      ['https://cdn.x.example/a.jpg', 'https://img.other.example/b.jpg'],
      async (url, firstParty) => {
        calls.push([url, firstParty]);
        return {status: 200};
      }
    );
    expect(r.score).toBe(1);
    expect(calls).toEqual([
      ['https://cdn.x.example/a.jpg', true],
      ['https://img.other.example/b.jpg', false],
    ]);
  });

  it('warns for a 404 or 410 and a host that does not exist, but only notes a refusal, a timeout or a 5xx', async () => {
    const gone = await run(['https://x.example/a.jpg'], async () => ({status: 404}));
    expect(gone.score).toBe(0.5);
    expect(gone.explanation).toMatch(/answered 404: the image is gone/);
    expect((await run(['https://x.example/a.jpg'], async () => ({status: 410}))).score).toBe(0.5);
    const dns = await run(['https://nope.example/a.jpg'], async () => {
      throw new Error('getaddrinfo ENOTFOUND nope.example');
    });
    expect(dns.score).toBe(0.5);
    for (const status of [401, 403, 406, 429, 500, 503]) {
      const r = await run(['https://x.example/a.jpg'], async () => ({status}));
      expect(r.score).toBe(1);
      expect(r.details.items[0].result).toMatch(/^Note: /);
    }
    const timeout = await run(['https://x.example/a.jpg'], async () => {
      throw new Error('the request timed out');
    });
    expect(timeout.score).toBe(1);
    expect(timeout.displayValue).toMatch(/could not be confirmed/);
  });

  it('checks at most five thumbnails and says how many were not checked', async () => {
    const urls = Array.from({length: 8}, (_, i) => `https://x.example/${i}.jpg`);
    let calls = 0;
    const r = await run(urls, async () => {
      calls++;
      return {status: 200};
    });
    expect(calls).toBe(MAX_THUMBNAILS);
    expect(r.displayValue).toMatch(/3 more thumbnails not checked/);
  });

  it('deduplicates thumbnails and survives a fetcher that throws a non-error', async () => {
    let calls = 0;
    await run(['https://x.example/a.jpg', 'https://x.example/a.jpg'], async () => {
      calls++;
      return {status: 200};
    });
    expect(calls).toBe(1);
    await expect(
      run(['https://x.example/a.jpg'], async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'boom';
      })
    ).resolves.toBeDefined();
  });
});
