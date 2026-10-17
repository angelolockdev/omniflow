'use strict';

const SPEC_MESSAGE_TYPE = 'cfc-flow-spec';
const SPEC_REQUEST_TYPE = 'cfc-flow-spec-request';
let cachedSpec;

async function getSpec() {
  if (cachedSpec !== undefined) return cachedSpec;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'getSpec' });
    cachedSpec = res?.ok && res.spec ? res.spec : null;
  } catch {
    cachedSpec = null;
  }
  return cachedSpec;
}

function postSpecToWindow(spec) {
  window.postMessage({ type: SPEC_MESSAGE_TYPE, spec }, location.origin);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== SPEC_REQUEST_TYPE) return;
  getSpec().then(postSpecToWindow);
});

getSpec().then(postSpecToWindow);