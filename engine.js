(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.__omniflowState) return;

  const DIAGNOSTIC_ATTR = 'data-omniflow-state';
  const SPEC_MESSAGE_TYPE = 'omniflow:config';
  const SPEC_REQUEST_TYPE = 'omniflow:config-request';

  const diagnostic = (typeof window !== 'undefined' && (window.__omniflowState = {
    state: 'awaiting-spec',
    applied: 0,
    before: null,
  })) || { state: 'awaiting-spec', applied: 0, before: null };

  let spec = undefined;
  let resolveSpecReady;
  const specReadyPromise = new Promise((resolve) => {
    resolveSpecReady = resolve;
    if (typeof setTimeout === 'function') {
      setTimeout(() => resolve(spec || null), 1500);
    }
  });

  function setDiagnostic(state, before) {
    diagnostic.state = state;
    if (before !== undefined) diagnostic.before = before;
    console.info('[OmniFlow]', JSON.stringify(diagnostic));

    const syncAttr = () => {
      if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute(DIAGNOSTIC_ATTR, JSON.stringify(diagnostic));
      }
    };

    if (typeof document !== 'undefined') {
      if (document.documentElement) {
        syncAttr();
      } else {
        document.addEventListener('DOMContentLoaded', syncAttr, { once: true });
      }
    }
  }

  function isBatchexecuteRequest(rawUrl, currentSpec = spec) {
    if (!rawUrl || !currentSpec || typeof currentSpec !== 'object' || !currentSpec.rpcids) {
      return false;
    }
    try {
      const baseHref = (typeof location !== 'undefined' && location.href) || currentSpec.origin || 'https://flow.google.com';
      const parsedUrl = new URL(rawUrl, baseHref);
      const expectedOrigin = (typeof location !== 'undefined' && location.origin) || currentSpec.origin || 'https://flow.google.com';
      if (parsedUrl.origin !== expectedOrigin) return false;
      if (!parsedUrl.pathname.includes('/data/batchexecute')) return false;

      const rpcidsParam = parsedUrl.searchParams.get('rpcids');
      if (rpcidsParam) {
        const ids = rpcidsParam.split(',');
        if (ids.includes(currentSpec.rpcids)) return true;
      }
      if (parsedUrl.search.includes(currentSpec.rpcids)) return true;
      return false;
    } catch {
      return false;
    }
  }

  function patchResponseBody(responseBody, currentSpec = spec) {
    if (!currentSpec || typeof currentSpec !== 'object') {
      throw new Error('OmniFlow spec is not loaded');
    }

    const lines = responseBody.split('\n');
    let beforeValue;
    let patchCount = 0;
    const flagIndex = Number.isInteger(currentSpec.flagIndex) ? currentSpec.flagIndex : 30;
    const ageFlagIndex = Number.isInteger(currentSpec.ageFlagIndex) ? currentSpec.ageFlagIndex : flagIndex + 1;

    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('[[')) continue;
      let envelopes;
      try {
        envelopes = JSON.parse(lines[i]);
      } catch {
        continue;
      }

      let modified = false;
      for (const item of envelopes) {
        if (!Array.isArray(item) || item[0] !== currentSpec.tag || item[1] !== currentSpec.rpcids) {
          continue;
        }

        let payload;
        try {
          payload = JSON.parse(item[2]);
        } catch {
          continue;
        }

        if (!Array.isArray(payload)) {
          throw new Error('Unexpected config schema: payload is not an array');
        }

        while (payload.length <= flagIndex) {
          payload.push(null);
        }

        beforeValue = payload[flagIndex];
        payload[flagIndex] = true;

        if (payload.length > ageFlagIndex && payload[ageFlagIndex] === false) {
          payload[ageFlagIndex] = true;
        }

        patchCount++;
        item[2] = JSON.stringify(payload);
        modified = true;
      }

      if (modified) {
        const rawLine = lines[i].replace(/\r$/, '');
        const prevLength = Number(lines[i - 1]);
        const byteLen = (str) => new TextEncoder().encode(str).length;
        const lenFns = [byteLen, (str) => str.length];
        const matchFn = lenFns.find((fn) => [0, 1, 2].includes(prevLength - fn(rawLine)));

        const newJsonStr = JSON.stringify(envelopes);
        if (matchFn && !Number.isNaN(prevLength)) {
          lines[i - 1] = String(prevLength + matchFn(newJsonStr) - matchFn(rawLine));
        }
        lines[i] = newJsonStr;
      }
    }

    if (patchCount === 0) {
      throw new Error('Expected at least one config response');
    }

    return {
      body: lines.join('\n'),
      before: beforeValue,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      patch: (body, customSpec) => patchResponseBody(body, customSpec !== undefined ? customSpec : spec),
      isBatchexecuteRequest,
    };
  }

  if (typeof window === 'undefined') return;

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      const rawUrl = input instanceof Request ? input.url : String(input);

      if (rawUrl && rawUrl.includes('/data/batchexecute') && spec === undefined) {
        await specReadyPromise;
      }

      if (!isBatchexecuteRequest(rawUrl, spec)) {
        return originalFetch.apply(this, arguments);
      }

      const response = await originalFetch.apply(this, arguments);
      try {
        const cloned = response.clone();
        const text = await cloned.text();

        if (spec && text.includes(spec.tag) && text.includes(spec.rpcids)) {
          const patched = patchResponseBody(text, spec);
          diagnostic.applied++;
          setDiagnostic('applied', patched.before);

          const newHeaders = new Headers(response.headers);
          newHeaders.delete('content-length');

          return new Response(patched.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        }
      } catch (err) {
        console.warn('[OmniFlow] Fetch patch failed:', err);
        setDiagnostic('schema mismatch — unchanged');
      }

      return response;
    };
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const targetXhrMap = new WeakMap();
    const appliedXhrMap = new WeakMap();
    const xhrProto = XMLHttpRequest.prototype;
    const originalXhrOpen = xhrProto.open;

    xhrProto.open = function(method, url, ...args) {
      let isTarget = false;
      try {
        isTarget = isBatchexecuteRequest(url, spec);
      } catch {}
      targetXhrMap.set(this, isTarget);
      appliedXhrMap.delete(this);
      return Reflect.apply(originalXhrOpen, this, [method, url, ...args]);
    };

    for (const prop of ['responseText', 'response']) {
      const desc = Object.getOwnPropertyDescriptor(xhrProto, prop);
      if (!desc?.get || !desc.configurable) continue;

      Object.defineProperty(xhrProto, prop, {
        ...desc,
        get() {
          const raw = Reflect.apply(desc.get, this, []);
          if (!targetXhrMap.get(this) || typeof raw !== 'string') return raw;
          if (this.readyState !== 4) return raw;

          if (!appliedXhrMap.has(this)) {
            try {
              if (spec && raw.includes(spec.tag) && raw.includes(spec.rpcids)) {
                const patched = patchResponseBody(raw, spec);
                appliedXhrMap.set(this, patched.body);
                diagnostic.applied++;
                setDiagnostic('applied', patched.before);
              } else {
                appliedXhrMap.set(this, raw);
              }
            } catch (err) {
              console.warn('[OmniFlow] XHR patch failed:', err);
              appliedXhrMap.set(this, raw);
              setDiagnostic('schema mismatch — unchanged');
            }
          }
          return appliedXhrMap.get(this);
        },
      });
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== SPEC_MESSAGE_TYPE) return;
    if (data.spec && typeof data.spec === 'object' && data.spec.rpcids) {
      spec = Object.assign({}, data.spec);
      if (resolveSpecReady) resolveSpecReady(spec);
      if (diagnostic.applied === 0) {
        setDiagnostic('armed');
      }
    } else {
      spec = null;
      if (resolveSpecReady) resolveSpecReady(null);
      setDiagnostic('unauthenticated');
    }
  });

  setDiagnostic('awaiting-spec');
  try {
    window.postMessage({ type: SPEC_REQUEST_TYPE }, location.origin);
  } catch {}
})();
