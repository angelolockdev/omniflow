(() => {
  'use strict';

  if (typeof window !== 'undefined' && window.__flowLocalDiagnostic) return;

  const DIAGNOSTIC_ATTR = 'data-flow-local-diagnostic';
  const diagnostic = (typeof window !== 'undefined' && (window.__flowLocalDiagnostic = {
    state: 'armed',
    applied: 0,
    before: null,
  })) || { state: 'armed', applied: 0 };

  let spec = {
    origin: 'https://flow.google.com',
    path: '/_/AiSandboxAngularFrontend/data/batchexecute',
    rpcids: 'cPZSdc',
    tag: 'wrb.fr',
    flagIndex: 30,
    minLength: 32,
  };

  function setDiagnostic(state, before) {
    diagnostic.state = state;
    if (before !== undefined) diagnostic.before = before;
    console.info('[FlowPass]', JSON.stringify(diagnostic));

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

  function isBatchexecuteRequest(rawUrl) {
    if (!rawUrl) return false;
    try {
      const parsedUrl = new URL(rawUrl, (typeof location !== 'undefined' && location.href) || 'https://flow.google.com');
      if (typeof location !== 'undefined' && parsedUrl.origin !== location.origin) return false;
      if (!parsedUrl.pathname.includes('/data/batchexecute')) return false;

      const rpcidsParam = parsedUrl.searchParams.get('rpcids');
      if (rpcidsParam) {
        const ids = rpcidsParam.split(',');
        if (ids.includes(spec.rpcids)) return true;
      }
      if (parsedUrl.search.includes(spec.rpcids)) return true;
      return false;
    } catch {
      return false;
    }
  }

  function patchResponseBody(responseBody, currentSpec) {
    const lines = responseBody.split('\n');
    let beforeValue;
    let patchCount = 0;

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

        // Expand payload if it was truncated
        while (payload.length <= currentSpec.flagIndex) {
          payload.push(null);
        }

        beforeValue = payload[currentSpec.flagIndex];
        payload[currentSpec.flagIndex] = true;

        // Also ensure age-restriction flag (index 31, field 32) is not false
        if (payload.length > currentSpec.flagIndex + 1 && payload[currentSpec.flagIndex + 1] === false) {
          payload[currentSpec.flagIndex + 1] = true;
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

  // CommonJS export support for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      patch: (body) => patchResponseBody(body, spec),
      isBatchexecuteRequest,
    };
  }

  if (typeof window === 'undefined') return;

  // 1. Hook window.fetch (used by modern Angular/Boq transport in flow.google.com)
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      const rawUrl = input instanceof Request ? input.url : String(input);

      if (!isBatchexecuteRequest(rawUrl)) {
        return originalFetch.apply(this, arguments);
      }

      const response = await originalFetch.apply(this, arguments);
      try {
        const cloned = response.clone();
        const text = await cloned.text();

        if (text.includes(spec.tag) && text.includes(spec.rpcids)) {
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
        console.warn('[FlowPass] Fetch patch failed:', err);
        setDiagnostic('schema mismatch — unchanged');
      }

      return response;
    };
  }

  // 2. Hook XMLHttpRequest (fallback / legacy transport)
  if (typeof XMLHttpRequest !== 'undefined') {
    const targetXhrMap = new WeakMap();
    const appliedXhrMap = new WeakMap();
    const xhrProto = XMLHttpRequest.prototype;
    const originalXhrOpen = xhrProto.open;

    xhrProto.open = function(method, url, ...args) {
      let isTarget = false;
      try {
        isTarget = isBatchexecuteRequest(url);
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
              if (raw.includes(spec.tag) && raw.includes(spec.rpcids)) {
                const patched = patchResponseBody(raw, spec);
                appliedXhrMap.set(this, patched.body);
                diagnostic.applied++;
                setDiagnostic('applied', patched.before);
              } else {
                appliedXhrMap.set(this, raw);
              }
            } catch (err) {
              console.warn('[FlowPass] XHR patch failed:', err);
              appliedXhrMap.set(this, raw);
              setDiagnostic('schema mismatch — unchanged');
            }
          }
          return appliedXhrMap.get(this);
        },
      });
    }
  }

  // 3. Listen for spec updates from link.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'cfc-flow-spec') return;
    if (data.spec && typeof data.spec === 'object') {
      spec = Object.assign({}, spec, data.spec);
    }
  });

  setDiagnostic('armed');
})();