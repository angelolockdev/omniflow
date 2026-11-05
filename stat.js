const DIAGNOSTIC_ATTRIBUTE = 'data-omniflow-state';
const MAX_STATE_LENGTH = 80;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'status') return;

  let diag;
  try {
    diag = JSON.parse(document.documentElement.getAttribute(DIAGNOSTIC_ATTRIBUTE) || 'null');
  } catch {}

  sendResponse({
    state: typeof diag?.state === 'string' ? diag.state.slice(0, MAX_STATE_LENGTH) : 'not-loaded',
    applied: diag?.applied > 0,
  });
});
