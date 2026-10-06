/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The pure logic for the four video audits: `video-structured-data-values` (the audited page's `VideoObject` markup),
 * `video-sitemap-valid` (the video extension of the sitemaps the gatherer read), `video-discoverability` (a page that embeds
 * a video but has no video markup) and `video-thumbnail-reachable` (does the markup's thumbnail answer). The only I/O is the
 * thumbnail probe, whose fetcher is passed in. Never throws.
 *
 * Sources (Google documentation, read 2026-10-06): `VideoObject` needs `name`, `thumbnailUrl` and `uploadDate`; `contentUrl`
 * or `embedUrl`, `description` and `duration` are recommended; dates and `duration` are ISO 8601; each video should have unique
 * `name` and `description` text; the thumbnail must be crawlable; videos belong on a page where they can be watched. Video
 * sitemap: required `video:thumbnail_loc`, `video:title`, `video:description`, and `video:content_loc` or `video:player_loc`;
 * description at most 2,048 characters; duration 1 to 28,800 seconds; rating 0.0 to 5.0; at most 32 tags; W3C dates; the video
 * URL must not be the page's own `<loc>`.
 */

import {
  clip,
  count,
  notApplicable,
  table,
  unreadSitemapsNote,
  parseIsoDate,
  probeStatuses,
} from './vertical-common.js';

/** @typedef {import('./structured-facts.js').Entity} Entity */
/** @typedef {import('./sitemap-parse.js').SitemapDocumentsArtifact} SitemapDocumentsArtifact */
/** @typedef {import('lighthouse/types/audit.js').default.Product} Product */
/** @typedef {{video: string, check: string, detail: string, severity: 'problem' | 'note'}} Finding */

const MAX_DESCRIPTION = 2048;
const MAX_TAGS = 32;
const MIN_DURATION = 1;
const MAX_DURATION = 28800;
const MAX_THUMBNAILS = 5;
const THUMBNAIL_TIMEOUT_MS = 5000;
// ISO 8601 durations: P1DT2H3M4S, PT30M5S, P2W. At least one component, and a "T" must be followed by a time part.
const ISO_DURATION =
  /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
const VIDEO_HOSTS =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|dailymotion\.com|wistia\.com|wistia\.net|jwplatform\.com|jwplayer\.com|brightcove\.net|twitch\.tv|loom\.com|vidyard\.com|streamable\.com)$/i;
const MAX_EMBEDS_SCANNED = 50;

/** @param {string} value @return {boolean} Whether it is an absolute http(s) URL. */
function absoluteUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/** @param {Entity} e @return {string} */
function label(e) {
  return clip((e.video && e.video.name) || e.name || e.id || 'Video');
}

// ---------------------------------------------------------------- video-structured-data-values

/**
 * @param {Entity[]} entities
 * @return {{videos: number, findings: Finding[]}}
 */
function evaluateVideoMarkup(entities) {
  const videos = entities.filter(e => e.video);
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Map<string, number>} */
  const names = new Map();
  /** @type {Map<string, number>} */
  const descriptions = new Map();
  for (const e of videos) {
    const v = /** @type {NonNullable<Entity['video']>} */ (e.video);
    const name = label(e);
    /** @param {'problem' | 'note'} severity @param {string} check @param {string} detail */
    const add = (severity, check, detail) => findings.push({video: name, check, detail, severity});

    for (const [field, value] of /** @type {Array<[string, string | null]>} */ ([
      ['uploadDate', v.uploadDate],
      ['expires', v.expires],
    ])) {
      if (!value) continue;
      const parsed = parseIsoDate(value);
      if (!parsed.ok) {
        add(
          'problem',
          field,
          `${field} "${clip(
            value
          )}" is not an ISO 8601 date (for example 2026-10-06T08:00:00+00:00).`
        );
      } else if (parsed.hasTime && !parsed.hasZone) {
        add(
          'note',
          field,
          `${field} "${clip(value)}" has no timezone. Without one Google assumes Googlebot's.`
        );
      }
    }
    if (v.duration && !ISO_DURATION.test(v.duration)) {
      add(
        'problem',
        'duration',
        `duration "${clip(v.duration)}" is not an ISO 8601 duration (for example PT1M30S).`
      );
    }
    for (const url of v.thumbnailUrls) {
      if (!absoluteUrl(url)) {
        add(
          'note',
          'thumbnailUrl',
          `thumbnailUrl "${clip(url)}" is not an absolute http(s) address; use a full URL.`
        );
      }
    }
    for (const [field, value] of /** @type {Array<[string, string | null]>} */ ([
      ['contentUrl', v.contentUrl],
      ['embedUrl', v.embedUrl],
    ])) {
      if (value && !absoluteUrl(value)) {
        add(
          'note',
          field,
          `${field} "${clip(value)}" is not an absolute http(s) address; use a full URL.`
        );
      }
    }
    if (!v.contentUrl && !v.embedUrl) {
      add(
        'note',
        'contentUrl',
        'Neither contentUrl nor embedUrl. Google prefers contentUrl (the video file) and accepts embedUrl (the player).'
      );
    }
    if (!v.description) {
      add('note', 'description', 'No description. Google recommends one, unique to this video.');
    }
    if (v.name) names.set(v.name.toLowerCase(), (names.get(v.name.toLowerCase()) || 0) + 1);
    if (v.description) {
      descriptions.set(
        v.description.toLowerCase(),
        (descriptions.get(v.description.toLowerCase()) || 0) + 1
      );
    }
  }
  for (const [text, n] of names) {
    if (n > 1) {
      findings.push({
        video: clip(text),
        check: 'name',
        detail: `${n} videos on the page share this name; Google asks for unique text for each video.`,
        severity: 'problem',
      });
    }
  }
  for (const [text, n] of descriptions) {
    if (n > 1) {
      findings.push({
        video: clip(text),
        check: 'description',
        detail: `${n} videos on the page share this description; Google asks for unique text for each video.`,
        severity: 'problem',
      });
    }
  }
  return {videos: videos.length, findings};
}

/** @param {Entity[]} entities @return {Product} */
function videoValuesProduct(entities) {
  const {videos, findings} = evaluateVideoMarkup(entities);
  if (videos === 0) return notApplicable('The page has no VideoObject markup.');
  const problems = findings.filter(f => f.severity === 'problem');
  const columns = [
    {key: 'video', heading: 'Video'},
    {key: 'check', heading: 'Field'},
    {key: 'detail', heading: 'Finding'},
  ];
  const rows = findings.map(f => ({
    video: f.video,
    check: f.check,
    detail: f.severity === 'note' ? `Note: ${f.detail}` : f.detail,
  }));
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(videos, 'video')} checked`,
      ...(rows.length && {details: table(columns, rows)}),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'value problem'),
    explanation: problems
      .slice(0, 5)
      .map(f => `${f.video}: ${f.detail}`)
      .join(' '),
    details: table(columns, rows),
  };
}

// ---------------------------------------------------------------- video-sitemap-valid

/**
 * @param {SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {{documents: number, videos: Array<import('./sitemap-parse.js').SitemapVideoEntry>, truncated: boolean}}
 */
function videoEntries(sitemaps) {
  const docs = ((sitemaps && sitemaps.documents) || []).filter(
    d => d.outcome === 'ok' && (d.videos || []).length > 0
  );
  return {
    documents: docs.length,
    videos: docs.flatMap(d => d.videos || []),
    truncated: docs.some(d => d.videosTruncated),
  };
}

/** @param {SitemapDocumentsArtifact | null | undefined} sitemaps @return {string} */
function noVideoSitemap(sitemaps) {
  return `No video sitemap entries (video:video) were found among the sitemaps read.${unreadSitemapsNote(
    sitemaps
  )}`;
}

/**
 * @param {SitemapDocumentsArtifact | null | undefined} sitemaps
 * @return {{videos: number, problems: Array<{loc: string, check: string, detail: string}>, notes: Array<{loc: string, check: string, detail: string}>}}
 */
function evaluateVideoSitemap(sitemaps) {
  const {videos} = videoEntries(sitemaps);
  /** @type {Array<{loc: string, check: string, detail: string}>} */
  const problems = [];
  /** @type {Array<{loc: string, check: string, detail: string}>} */
  const notes = [];
  for (const v of videos) {
    const loc = clip(v.loc || '(no loc)');
    /** @param {string} check @param {string} detail */
    const problem = (check, detail) => problems.push({loc, check, detail});
    if (!v.thumbnailLoc) problem('video:thumbnail_loc', 'No video:thumbnail_loc.');
    else if (!absoluteUrl(v.thumbnailLoc)) {
      problem(
        'video:thumbnail_loc',
        `video:thumbnail_loc "${clip(v.thumbnailLoc)}" is not an absolute http(s) address.`
      );
    }
    if (!v.title) problem('video:title', 'No video:title.');
    if (!v.description) problem('video:description', 'No video:description.');
    else if (v.description.length > MAX_DESCRIPTION) {
      problem(
        'video:description',
        `video:description is over ${MAX_DESCRIPTION} characters, the limit.`
      );
    }
    if (!v.contentLoc && !v.playerLoc) {
      problem(
        'video:content_loc',
        'Neither video:content_loc nor video:player_loc: one of them is required.'
      );
    }
    for (const [tag, value] of /** @type {Array<[string, string | null]>} */ ([
      ['video:content_loc', v.contentLoc],
      ['video:player_loc', v.playerLoc],
    ])) {
      if (!value) continue;
      if (!absoluteUrl(value)) {
        problem(tag, `${tag} "${clip(value)}" is not an absolute http(s) address.`);
      } else if (v.loc && value === v.loc) {
        problem(
          tag,
          `${tag} is the same address as the page <loc>; it must be the video's own address.`
        );
      }
    }
    if (v.duration !== null) {
      const n = /^\d+$/.test(v.duration) ? Number(v.duration) : NaN;
      if (!(n >= MIN_DURATION && n <= MAX_DURATION)) {
        problem(
          'video:duration',
          `video:duration "${clip(
            v.duration
          )}" is not a whole number of seconds from ${MIN_DURATION} to ${MAX_DURATION}.`
        );
      }
    }
    if (v.rating !== null) {
      const n = /^\d+(\.\d+)?$/.test(v.rating) ? Number(v.rating) : NaN;
      if (!(n >= 0 && n <= 5)) {
        problem(
          'video:rating',
          `video:rating "${clip(v.rating)}" is not a number from 0.0 to 5.0.`
        );
      }
    }
    for (const [tag, value] of /** @type {Array<[string, string | null]>} */ ([
      ['video:publication_date', v.publicationDate],
      ['video:expiration_date', v.expirationDate],
    ])) {
      if (value && !parseIsoDate(value).ok) {
        problem(
          tag,
          `${tag} "${clip(value)}" is not a W3C date (YYYY-MM-DD, or with time and timezone).`
        );
      }
    }
    if (v.tags > MAX_TAGS) {
      problem('video:tag', `${v.tags} video:tag elements; Google allows ${MAX_TAGS}.`);
    }
  }
  return {videos: videos.length, problems, notes};
}

/** @param {SitemapDocumentsArtifact | null | undefined} sitemaps @return {Product} */
function videoSitemapProduct(sitemaps) {
  const {videos, problems} = evaluateVideoSitemap(sitemaps);
  if (videos === 0) return notApplicable(noVideoSitemap(sitemaps));
  if (problems.length === 0) return {score: 1, displayValue: `${count(videos, 'video')} checked`};
  return {
    score: 0,
    displayValue: count(problems.length, 'problem'),
    explanation: problems
      .slice(0, 3)
      .map(p => p.detail)
      .join(' '),
    details: table(
      [
        {key: 'loc', heading: 'Page'},
        {key: 'check', heading: 'Tag'},
        {key: 'detail', heading: 'Finding'},
      ],
      problems
    ),
  };
}

// ---------------------------------------------------------------- video-discoverability

/** @param {string} tag @param {string} name @return {string | null} An attribute's value from a start tag, lower case input. */
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? m[2] ?? m[3] ?? m[4] ?? '' : null;
}

/**
 * Finds the videos a page embeds, from its (rendered) HTML. A `<video>` that autoplays muted or looping with no controls is a
 * decorative background, not a video to find, and is skipped. Bounded: at most 50 elements are examined of each kind.
 * @param {string} html
 * @return {{embeds: Array<{kind: 'video' | 'iframe', src: string}>, hasMicrodata: boolean}}
 */
function findEmbeddedVideos(html) {
  const text = typeof html === 'string' ? html : '';
  const lower = text.toLowerCase();
  /** @type {Array<{kind: 'video' | 'iframe', src: string}>} */
  const embeds = [];

  let from = 0;
  for (let n = 0; n < MAX_EMBEDS_SCANNED; n++) {
    const start = lower.indexOf('<video', from);
    if (start === -1) break;
    from = start + 6;
    const next = lower[start + 6];
    if (next && !/[\s>/]/.test(next)) continue; // <videos...>
    const tagEnd = lower.indexOf('>', start);
    if (tagEnd === -1) break;
    const startTag = text.slice(start, tagEnd + 1);
    const close = lower.indexOf('</video>', tagEnd);
    const inner = close === -1 ? '' : text.slice(tagEnd + 1, close);
    const src =
      attr(startTag, 'src') ||
      (/<source\b[^>]*\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(inner) || [])[1] ||
      '';
    if (!src) continue;
    const lowerTag = startTag.toLowerCase();
    const background =
      /\sautoplay\b/.test(lowerTag) &&
      /\s(muted|loop)\b/.test(lowerTag) &&
      !/\scontrols\b/.test(lowerTag);
    if (!background) embeds.push({kind: 'video', src: clip(src)});
  }

  from = 0;
  for (let n = 0; n < MAX_EMBEDS_SCANNED; n++) {
    const start = lower.indexOf('<iframe', from);
    if (start === -1) break;
    from = start + 7;
    const tagEnd = lower.indexOf('>', start);
    if (tagEnd === -1) break;
    const startTag = text.slice(start, tagEnd + 1);
    const src = attr(startTag, 'src') || attr(startTag, 'data-src') || '';
    if (!src) continue;
    try {
      const host = new URL(src, 'https://page.invalid/').hostname;
      if (VIDEO_HOSTS.test(host)) embeds.push({kind: 'iframe', src: clip(src)});
    } catch (_) {
      // an unparseable address is not a known video host
    }
  }
  return {
    embeds,
    hasMicrodata: /itemtype\s*=\s*["']https?:\/\/schema\.org\/videoobject["']/i.test(text),
  };
}

/**
 * @param {{html: string} | null | undefined} rendered The `RenderedHtml` artifact.
 * @param {Entity[]} entities
 * @return {Product}
 */
function videoDiscoverabilityProduct(rendered, entities) {
  if (!rendered || typeof rendered.html !== 'string') {
    return notApplicable('The rendered page was not collected.');
  }
  const {embeds, hasMicrodata} = findEmbeddedVideos(rendered.html);
  if (embeds.length === 0) {
    return notApplicable(
      'The page embeds no video (a <video> element with a source, or a YouTube, Vimeo or similar player).'
    );
  }
  const marked = entities.some(e => e.video) || hasMicrodata;
  if (marked) {
    return {score: 1, displayValue: `${count(embeds.length, 'embedded video')}, with video markup`};
  }
  return {
    score: 0.5,
    displayValue: `${count(embeds.length, 'embedded video')} without markup`,
    explanation:
      'The page embeds a video but has no VideoObject markup, so Google may not show it as a video result. Add VideoObject JSON-LD with name, thumbnailUrl and uploadDate (and contentUrl or embedUrl). A decorative background video (autoplay, muted or looping, no controls) is not counted.',
    details: table(
      [
        {key: 'kind', heading: 'Kind'},
        {key: 'src', heading: 'Source'},
      ],
      embeds
        .slice(0, 20)
        .map(e => ({kind: e.kind === 'video' ? '<video>' : 'Embedded player', src: e.src}))
    ),
  };
}

// ---------------------------------------------------------------- video-thumbnail-reachable

/**
 * @typedef {(url: string, firstParty: boolean) => Promise<{status: number}>} ThumbnailFetcher
 * `firstParty` is true when the thumbnail is on the audited page's own site (the private-network opt-in then applies, as for the
 * page); a thumbnail on another site is fetched with public addresses only.
 */

/**
 * @param {Entity[]} entities
 * @param {string} pageUrl
 * @param {ThumbnailFetcher} fetchStatus
 * @param {(host: string) => string} siteOf
 * @return {Promise<Product>}
 */
async function videoThumbnailProduct(entities, pageUrl, fetchStatus, siteOf) {
  const thumbs = entities.flatMap(e => (e.video ? e.video.thumbnailUrls : [])).filter(absoluteUrl);
  if (new Set(thumbs).size === 0) {
    return notApplicable('The page has no video thumbnailUrl to check.');
  }
  const {rows, checked, notChecked} = await probeStatuses({
    urls: thumbs,
    pageUrl,
    max: MAX_THUMBNAILS,
    fetchStatus,
    siteOf,
  });
  const problems = rows.filter(r => r.severity === 'problem');
  const extra = notChecked > 0 ? ` (${count(notChecked, 'more thumbnail')} not checked)` : '';
  if (rows.length === 0) {
    return {score: 1, displayValue: `${count(checked, 'thumbnail')} reachable${extra}`};
  }
  /** @param {import('./vertical-common.js').ProbeRow} r @return {string} */
  const describe = r =>
    r.kind === 'gone'
      ? `answered ${r.status}: the image is gone.`
      : r.kind === 'missing-host'
      ? `could not be reached (${r.message}).`
      : r.kind === 'status'
      ? `answered ${r.status} (a bot-protected or briefly failing server can do this; not judged).`
      : `could not be checked (${r.message}).`;
  const columns = [
    {key: 'url', heading: 'Thumbnail'},
    {key: 'result', heading: 'Result'},
  ];
  const tableRows = rows.map(r => ({
    url: clip(r.url),
    result: r.severity === 'note' ? `Note: ${describe(r)}` : describe(r),
  }));
  if (problems.length === 0) {
    return {
      score: 1,
      displayValue: `${count(rows.length, 'thumbnail')} could not be confirmed${extra}`,
      details: table(columns, tableRows),
    };
  }
  return {
    score: 0.5,
    displayValue: count(problems.length, 'broken thumbnail'),
    explanation: `${problems
      .map(p => `${p.url} ${describe(p)}`)
      .slice(0, 3)
      .join(' ')} Google needs a crawlable thumbnail to show the video.`,
    details: table(columns, tableRows),
  };
}

export {
  evaluateVideoMarkup,
  videoValuesProduct,
  evaluateVideoSitemap,
  videoSitemapProduct,
  videoEntries,
  findEmbeddedVideos,
  videoDiscoverabilityProduct,
  videoThumbnailProduct,
  ISO_DURATION,
  THUMBNAIL_TIMEOUT_MS,
  MAX_THUMBNAILS,
};
