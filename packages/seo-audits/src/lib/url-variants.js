/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure logic for the URL-variant audits (HTTP/HTTPS/www consistency, redirect-chain length, redirect
 * loops): no I/O. The gatherer requests the audited URL's own other forms, `http://host`,
 * `http://alt` and `https://alt` (`alt` is the host with `www` toggled), follows each one's redirects
 * by hand, and records every hop. This file decides which variants to probe and what the recorded
 * chains mean.
 *
 * Only the audited URL's own host variants are ever probed or followed to: a hop to any other host is
 * recorded and never requested, so a redirect cannot aim a request anywhere else.
 *
 * Deliberately conservative about what to probe: `www` is toggled only for an apex host (two labels)
 * or a `www.` host. A subdomain such as `app.example.com` is not probed as `www.app.example.com`,
 * because wildcard DNS makes that name resolve and answer, which would be reported as a false
 * duplicate. An IP address, `localhost`, a non-default port and a non-HTTPS page are not probed at all.
 */

import {Audit} from 'lighthouse/core/audits/audit.js';

/**
 * @typedef {'final' | 'loop' | 'hop-limit' | 'left-site' | 'unresolved-location' | 'failed' |
 *   'unreachable'} VariantEnd
 * @typedef {{url: string, status: number, location: string | null}} Hop
 * @typedef {{
 *   kind: 'http-same-host' | 'http-alt-host' | 'https-alt-host',
 *   startUrl: string,
 *   hops: Hop[],
 *   end: VariantEnd,
 *   endUrl: string | null,
 *   reason: string | null,
 * }} Variant
 * @typedef {{
 *   audited: string,
 *   canonicalOrigin: string | null,
 *   variants: Variant[],
 *   skipped: string | null,
 * }} UrlVariantsArtifact
 * @typedef {import('lighthouse/types/audit.js').default.Product} Product
 */

const MAX_HOPS = 5;
const MAX_CHAIN_REDIRECTS = 2;
const MAX_TEXT_CHARS = 1_000;
const TEMPORARY = new Set([302, 303, 307]);

/**
 * @param {string} text
 * @return {string}
 */
function clip(text) {
  return text.length <= MAX_TEXT_CHARS
    ? text
    : `${text.slice(0, MAX_TEXT_CHARS)}... (${text.length - MAX_TEXT_CHARS} more characters)`;
}

/**
 * @param {string} hostname
 * @return {boolean}
 */
function isIpOrLocal(hostname) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(':') ||
    hostname.startsWith('[')
  );
}

/**
 * The host with `www` toggled, or null when the toggle is not safe to probe.
 * @param {string} hostname
 * @return {string | null}
 */
function altHostOf(hostname) {
  if (hostname.startsWith('www.')) {
    const bare = hostname.slice(4);
    return bare.includes('.') ? bare : null;
  }
  return hostname.split('.').length === 2 ? `www.${hostname}` : null;
}

/**
 * @param {string} auditedUrl The page's final URL.
 * @return {{
 *   skipped: string | null,
 *   canonicalOrigin: string | null,
 *   allowedHosts: string[],
 *   specs: Array<{kind: Variant['kind'], url: string}>,
 * }}
 */
function planVariants(auditedUrl) {
  const none = {canonicalOrigin: null, allowedHosts: [], specs: []};
  let url;
  try {
    url = new URL(auditedUrl);
  } catch {
    return {...none, skipped: 'the audited URL is not valid'};
  }
  if (url.protocol !== 'https:') {
    return {
      ...none,
      skipped:
        'the page is not served over HTTPS, so there is no canonical HTTPS form to compare with',
    };
  }
  if (url.port) {
    return {
      ...none,
      skipped: `the page uses a non-default port (${url.port}), where http/https variants of the host are not comparable`,
    };
  }
  const host = url.hostname.toLowerCase();
  if (isIpOrLocal(host)) {
    return {
      ...none,
      skipped: `"${host}" is an IP address or local host name, which has no www/non-www or http/https variants`,
    };
  }

  const pathAndQuery = `${url.pathname}${url.search}`;
  const alt = altHostOf(host);
  /** @type {Array<{kind: Variant['kind'], url: string}>} */
  const specs = [{kind: 'http-same-host', url: `http://${host}${pathAndQuery}`}];
  const allowedHosts = [host];
  if (alt) {
    allowedHosts.push(alt);
    specs.push({kind: 'http-alt-host', url: `http://${alt}${pathAndQuery}`});
    specs.push({kind: 'https-alt-host', url: `https://${alt}${pathAndQuery}`});
  }
  return {skipped: null, canonicalOrigin: url.origin, allowedHosts, specs};
}

/**
 * For comparing a redirect's destination with the audited page: the path (a trailing slash on a
 * non-root path ignored) and query; the fragment never reaches a server.
 * @param {string} url
 * @return {string}
 */
function pathAndQueryOf(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${path}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * @param {Variant} variant
 * @return {number} How many redirects the chain followed.
 */
function redirectCount(variant) {
  return variant.hops.filter(h => h.status >= 300 && h.status < 400 && h.location).length;
}

/**
 * @param {Variant} variant
 * @return {string}
 */
function chainText(variant) {
  const parts = variant.hops.map(h => `${h.status} ${h.url}`);
  if (variant.end === 'loop' && variant.endUrl) parts.push(`back to ${variant.endUrl}`);
  if (variant.end === 'left-site' && variant.endUrl) {
    parts.push(`to ${variant.endUrl} (not requested)`);
  }
  return clip(parts.join('  ->  '));
}

/** @type {Record<Variant['kind'], string>} */
const KIND_LABEL = {
  'http-same-host': 'http:// (same host)',
  'http-alt-host': 'http:// (www toggled)',
  'https-alt-host': 'https:// (www toggled)',
};

/**
 * @param {Variant} variant
 * @param {string} audited
 * @param {string | null} canonicalOrigin
 * @return {{verdict: 'ok' | 'fail' | 'note' | 'skip', text: string}}
 */
function judgeConsistency(variant, audited, canonicalOrigin) {
  const last = variant.hops[variant.hops.length - 1];
  switch (variant.end) {
    case 'unreachable':
      return {
        verdict: 'skip',
        text: 'Not reachable (no such host or nothing listening): there is no such variant to be inconsistent.',
      };
    case 'failed':
      return {verdict: 'note', text: `Could not be requested: ${variant.reason}.`};
    case 'loop':
      return {verdict: 'note', text: 'Redirects in a loop (reported by redirect-loop).'};
    case 'hop-limit':
      return {
        verdict: 'note',
        text: 'Redirect chain too long to follow (reported by redirect-chain-length).',
      };
    case 'unresolved-location':
      return {verdict: 'note', text: `Redirects, but ${variant.reason}; not judged.`};
    case 'left-site':
      return {
        verdict: 'note',
        text: `Redirects to ${variant.endUrl}, which is not one of this site's own host variants; not followed, so not judged.`,
      };
    default:
      break;
  }

  if (variant.hops.length === 1) {
    return last.status >= 200 && last.status < 300
      ? {
          verdict: 'fail',
          text: `Serves the page directly (HTTP ${last.status}) instead of redirecting: the same content is reachable at two URLs.`,
        }
      : {verdict: 'note', text: `Returned HTTP ${last.status} without redirecting; not judged.`};
  }
  if (!(last.status >= 200 && last.status < 300)) {
    return {
      verdict: 'fail',
      text: `Redirects, but the chain ends in HTTP ${last.status} at ${last.url}.`,
    };
  }
  const endOrigin = new URL(last.url).origin;
  if (endOrigin !== canonicalOrigin) {
    return {
      verdict: 'fail',
      text: `Ends at ${last.url}, not at the audited origin ${canonicalOrigin}.`,
    };
  }
  if (pathAndQueryOf(last.url) !== pathAndQueryOf(audited)) {
    return {
      verdict: 'fail',
      text: `Ends at ${last.url}: the path and query of the requested URL were not preserved.`,
    };
  }
  const temporary = variant.hops.some(h => TEMPORARY.has(h.status));
  return {
    verdict: 'ok',
    text: temporary
      ? `Reaches the audited URL in ${redirectCount(
          variant
        )} redirect(s), but through a temporary redirect (302/303/307); a permanent 301/308 is the usual choice.`
      : `Reaches the audited URL in ${redirectCount(variant)} redirect(s) (correct).`,
  };
}

/**
 * @param {UrlVariantsArtifact | null | undefined} artifact
 * @return {string | null} Why the artifact cannot be judged, or null.
 */
function notApplicableReason(artifact) {
  if (!artifact || !Array.isArray(artifact.variants)) return 'The URL variants were not collected.';
  if (artifact.skipped) return `The URL variants were not checked: ${artifact.skipped}.`;
  if (!artifact.variants.length) return 'There were no URL variants to check.';
  return null;
}

/**
 * @param {UrlVariantsArtifact} artifact
 * @param {(v: Variant) => string} resultOf
 * @return {import('lighthouse/types/audit.js').default.Details.Table}
 */
function variantTable(artifact, resultOf) {
  /** @type {import('lighthouse/types/audit.js').default.Details.Table['headings']} */
  const headings = [
    {key: 'variant', valueType: 'text', label: 'Variant'},
    {key: 'chain', valueType: 'text', label: 'What the site did'},
    {key: 'result', valueType: 'text', label: 'Finding'},
  ];
  const rows = artifact.variants.map(v => ({
    variant: KIND_LABEL[v.kind],
    chain: v.hops.length || v.end === 'loop' ? chainText(v) : v.startUrl,
    result: resultOf(v),
  }));
  return Audit.makeTableDetails(headings, rows);
}

/**
 * @param {UrlVariantsArtifact | null | undefined} artifact
 * @return {Product}
 */
function consistencyProduct(artifact) {
  const reason = notApplicableReason(artifact);
  if (reason || !artifact) return {score: 1, notApplicable: true, explanation: reason || ''};

  const judged = artifact.variants.map(v => ({
    v,
    j: judgeConsistency(v, artifact.audited, artifact.canonicalOrigin),
  }));
  if (judged.every(x => x.j.verdict === 'skip')) {
    return {
      score: 1,
      notApplicable: true,
      explanation:
        'None of the other http/https/www forms of this host is reachable, so there is nothing to compare.',
    };
  }
  const details = variantTable(artifact, v => judged.find(x => x.v === v)?.j.text || '');
  const failing = judged.filter(x => x.j.verdict === 'fail');
  if (failing.length) {
    return {
      score: 0,
      explanation:
        `${failing.length} of ${judged.length} other form(s) of this URL do not redirect to ` +
        `${artifact.audited}: search engines can treat them as duplicate pages.`,
      details,
    };
  }
  return {score: 1, details};
}

/**
 * @param {UrlVariantsArtifact | null | undefined} artifact
 * @return {Product}
 */
function chainLengthProduct(artifact) {
  const reason = notApplicableReason(artifact);
  if (reason || !artifact) return {score: 1, notApplicable: true, explanation: reason || ''};

  const flagged = (/** @type {Variant} */ v) =>
    v.end !== 'loop' && (v.end === 'hop-limit' || redirectCount(v) > MAX_CHAIN_REDIRECTS);
  const details = variantTable(artifact, v => {
    if (v.end === 'unreachable') return 'Not reachable.';
    if (v.end === 'failed') return `Could not be requested: ${v.reason}.`;
    if (v.end === 'loop') return 'Redirects in a loop (reported by redirect-loop).';
    if (v.end === 'hop-limit') return `More than ${MAX_HOPS} redirects: too long.`;
    const n = redirectCount(v);
    return n > MAX_CHAIN_REDIRECTS
      ? `${n} redirects: more than ${MAX_CHAIN_REDIRECTS}.`
      : `${n} redirect(s) (fine).`;
  });
  const reached = artifact.variants.filter(v => v.end !== 'unreachable' && v.end !== 'failed');
  if (!reached.length) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'None of the URL variants could be requested.',
    };
  }
  const bad = artifact.variants.filter(flagged);
  if (bad.length) {
    return {
      score: 0,
      explanation:
        `${bad.length} URL variant(s) take more than ${MAX_CHAIN_REDIRECTS} redirects to resolve: ` +
        'every extra hop slows the visitor and dilutes the signal passed to the final page.',
      details,
    };
  }
  return {score: 1, details};
}

/**
 * @param {UrlVariantsArtifact | null | undefined} artifact
 * @return {Product}
 */
function loopProduct(artifact) {
  const reason = notApplicableReason(artifact);
  if (reason || !artifact) return {score: 1, notApplicable: true, explanation: reason || ''};

  const reached = artifact.variants.filter(v => v.end !== 'unreachable' && v.end !== 'failed');
  if (!reached.length) {
    return {
      score: 1,
      notApplicable: true,
      explanation: 'None of the URL variants could be requested.',
    };
  }
  const details = variantTable(artifact, v =>
    v.end === 'loop'
      ? 'Redirects in a circle: a browser or crawler never reaches a page.'
      : v.end === 'unreachable' || v.end === 'failed'
      ? 'Not checked.'
      : 'No loop.'
  );
  const loops = artifact.variants.filter(v => v.end === 'loop');
  if (loops.length) {
    return {
      score: 0,
      explanation: `${loops.length} URL variant(s) redirect in a loop and never resolve to a page.`,
      details,
    };
  }
  return {score: 1, details};
}

export {
  planVariants,
  redirectCount,
  judgeConsistency,
  consistencyProduct,
  chainLengthProduct,
  loopProduct,
  MAX_HOPS,
  MAX_CHAIN_REDIRECTS,
};
