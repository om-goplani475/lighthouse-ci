/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {useState, useEffect, useRef} from 'preact/hooks';
import {seoRequest} from '../routes/seo/seo-model.js';

/** @typedef {Awaited<ReturnType<typeof seoRequest>> | {state: 'loading', status: 0, data: null, message: ''}} SeoResult */

/**
 * Loads a read-only SEO API resource for a project, and optionally keeps refreshing it while `shouldPoll(data)` is true
 * (for example while a run is still queued). An older response never overwrites a newer one, and nothing is set after the
 * screen has gone away. While reloading, the previous data stays visible.
 *
 * @param {string} projectId
 * @param {string | undefined} adminToken
 * @param {string} path For example `/runs`.
 * @param {{pollMs?: number, shouldPoll?: (data: any) => boolean}} [options]
 * @return {[SeoResult, () => void]} The result, and a function that loads it again.
 */
export function useSeoResource(projectId, adminToken, path, options = {}) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(
    /** @type {SeoResult} */ ({state: 'loading', status: 0, data: null, message: ''})
  );
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const load = async () => {
      const res = await seoRequest({fetch: window.fetch.bind(window), projectId, adminToken, path});
      if (cancelled) return;
      setResult(res);
      const {pollMs = 0, shouldPoll = () => false} = optionsRef.current;
      if (pollMs && res.state === 'ok' && shouldPoll(res.data)) timer = setTimeout(load, pollMs);
    };
    setResult(previous =>
      previous.state === 'ok' ? previous : {state: 'loading', status: 0, data: null, message: ''}
    );
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, adminToken, path, version]);

  return [result, () => setVersion(v => v + 1)];
}
