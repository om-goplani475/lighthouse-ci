/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reads and checks one hreflang value: `x-default`, or `language[-script][-region]`. Whether a language or a
 * region code exists is answered by the runtime's own locale data (`Intl.DisplayNames`), so no list of codes is
 * kept here. No I/O, never throws.
 *
 * Rules: the language is a two-letter code (ISO 639-1); a three-letter code that has a two-letter form is refused
 * with that suggestion, and one without (fil, yue, haw) is accepted when the locale data knows it, as Lighthouse
 * core does; a script is any four letters; a region is a two-letter code that the locale data
 * knows, or three digits (a UN M.49 area such as `es-419`); an underscore is refused with the hyphen form; case is
 * not significant. The common mistake `UK` is refused with `GB`.
 */

/**
 * @typedef {{
 *   raw: string,
 *   kind: 'x-default' | 'language',
 *   language: string | null,
 *   script: string | null,
 *   region: string | null,
 *   valid: boolean,
 *   problem: string | null,
 *   suggestion: string | null,
 * }} ParsedHreflang
 */

/** Three-letter codes people write, and the two-letter code to use instead. */
const THREE_LETTER = {
  eng: 'en',
  fra: 'fr',
  fre: 'fr',
  deu: 'de',
  ger: 'de',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  dut: 'nl',
  rus: 'ru',
  jpn: 'ja',
  kor: 'ko',
  zho: 'zh',
  chi: 'zh',
  ara: 'ar',
};
const LEGACY_LANGUAGES = new Set(['iw', 'in', 'ji']);

/** @type {{language: Intl.DisplayNames | null, region: Intl.DisplayNames | null} | null} */
let names = null;

/**
 * @return {{language: Intl.DisplayNames | null, region: Intl.DisplayNames | null}}
 */
function displayNames() {
  if (names) return names;
  /** @param {'language' | 'region'} type */
  const make = type => {
    try {
      return new Intl.DisplayNames(['en'], {type, fallback: 'none'});
    } catch {
      return null;
    }
  };
  names = {language: make('language'), region: make('region')};
  return names;
}

/**
 * @param {string} code Two letters.
 * @return {boolean} Whether the runtime knows this language. Unknown runtime support counts as known, so a
 *   missing locale database never fails a page.
 */
function isKnownLanguage(code) {
  if (LEGACY_LANGUAGES.has(code)) return true;
  const {language} = displayNames();
  if (!language) return true;
  try {
    return language.of(code) !== undefined;
  } catch {
    return false;
  }
}

/**
 * @param {string} code Two letters.
 * @return {boolean}
 */
function isKnownRegion(code) {
  const {region} = displayNames();
  if (!region) return true;
  try {
    const name = region.of(code.toUpperCase());
    // The locale data names a reserved code "Unknown Region"; it is not a real country.
    return name !== undefined && name !== 'Unknown Region';
  } catch {
    return false;
  }
}

/**
 * @param {string} raw
 * @param {Partial<ParsedHreflang>} over
 * @return {ParsedHreflang}
 */
function result(raw, over) {
  return {
    raw,
    kind: 'language',
    language: null,
    script: null,
    region: null,
    valid: false,
    problem: null,
    suggestion: null,
    ...over,
  };
}

/**
 * @param {unknown} value The `hreflang` attribute as written.
 * @return {ParsedHreflang}
 */
function parseHreflang(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const lower = raw.toLowerCase();
  if (lower === 'x-default') return result(raw, {kind: 'x-default', valid: true});
  if (raw === '') return result(raw, {problem: 'the value is empty'});
  if (raw.includes('_')) {
    return result(raw, {
      problem: 'it uses an underscore, but hreflang uses a hyphen',
      suggestion: raw.replace(/_/g, '-'),
    });
  }
  const parts = lower.split('-');
  if (parts.length > 3 || parts.some(p => !/^[a-z0-9]+$/.test(p))) {
    return result(raw, {
      problem: 'it is not in the form language, language-region or language-script-region',
    });
  }
  const [language, ...rest] = parts;
  const suggested = /** @type {Record<string, string>} */ (THREE_LETTER)[language];
  if (suggested) {
    return result(raw, {
      problem: 'hreflang needs a two-letter language code (ISO 639-1), not a three-letter one',
      suggestion: [suggested, ...rest].join('-'),
    });
  }
  if (!/^[a-z]{2,3}$/.test(language)) {
    return result(raw, {problem: 'the language part is not a two-letter language code'});
  }
  if (!isKnownLanguage(language)) {
    return result(raw, {
      problem:
        language.length === 2 && isKnownRegion(language)
          ? `"${raw}" looks like a country code; hreflang needs the language first (for example en-${language.toUpperCase()})`
          : `"${language}" is not a language code`,
      language,
    });
  }
  /** @type {string | null} */
  let script = null;
  /** @type {string | null} */
  let region = null;
  for (const part of rest) {
    if (/^[a-z]{4}$/.test(part) && script === null && region === null) {
      script = part;
    } else if (region === null && (/^[a-z]{2}$/.test(part) || /^[0-9]{3}$/.test(part))) {
      region = part;
    } else {
      return result(raw, {problem: `"${part}" is not a valid script or region`, language});
    }
  }
  if (region !== null && /^[a-z]{2}$/.test(region)) {
    if (region === 'uk') {
      return result(raw, {
        problem: '"UK" is not a region code; the code for the United Kingdom is GB',
        suggestion: [language, script, 'gb'].filter(Boolean).join('-'),
        language,
        script,
        region,
      });
    }
    if (!isKnownRegion(region)) {
      return result(raw, {
        problem: `"${region.toUpperCase()}" is not a country or region code`,
        language,
        script,
        region,
      });
    }
  }
  return result(raw, {valid: true, language, script, region});
}

export {parseHreflang, isKnownLanguage, isKnownRegion, THREE_LETTER};
