const FLOW_URL = 'https://flow.google.com/';
const CONTENT_SCRIPT_ID = 'omniflow-core';
const UNSUPPORTED_COUNTRY_PATH = '/unsupported-country';

const STATES = {
  unauthenticated: {
    dot: 'warn',
    badge: 'LOCKED',
    title: 'Access Token Required',
    desc: 'Enter your OmniFlow token above to unlock the protection engine.',
    interceptor: 'Locked (No Token)',
    strong: false,
  },
  active: {
    dot: 'ok',
    badge: 'ACTIVE',
    title: 'Protection Active',
    desc: 'OmniFlow is active on this tab — region check patched.',
    interceptor: 'Active & Patched',
    strong: true,
  },
  armed: {
    dot: 'armed',
    badge: 'READY',
    title: 'Ready & Waiting',
    desc: 'Armed and waiting for Flow’s config response…',
    interceptor: 'Armed',
    strong: false,
  },
  enabled: {
    dot: 'ok',
    badge: 'ENABLED',
    title: 'Protection Enabled',
    desc: 'OmniFlow is enabled. Open or reload Flow to apply.',
    interceptor: 'Armed',
    strong: true,
  },
  disabled: {
    dot: 'idle',
    badge: 'DISABLED',
    title: 'Protection Off',
    desc: 'OmniFlow is off. Flow will show unsupported country.',
    interceptor: 'Disabled',
    strong: false,
  },
  reloadTab: {
    dot: 'warn',
    badge: 'RELOAD',
    title: 'Reload Required',
    desc: 'Reload this Flow tab to activate OmniFlow.',
    interceptor: 'Pending Reload',
    strong: false,
  },
  saved: {
    dot: 'ok',
    badge: 'SAVED',
    title: 'Settings Saved',
    desc: 'Saved. Reload any open Flow tabs to apply.',
    interceptor: 'Armed',
    strong: true,
  },
  schemaMismatch: {
    dot: 'bad',
    badge: 'UPDATE',
    title: 'Update Needed',
    desc: 'Flow config changed — OmniFlow spec needs an update.',
    interceptor: 'Schema Mismatch',
    strong: true,
  },
  specUnavailable: {
    dot: 'warn',
    badge: 'WARNING',
    title: 'Check Config',
    desc: 'Specification check failed. Try reloading tab.',
    interceptor: 'Check Failed',
    strong: true,
  },
  awaitingSpec: {
    dot: 'armed',
    badge: 'STARTING',
    title: 'Starting Up',
    desc: 'Synchronizing validated spec… almost ready.',
    interceptor: 'Initializing',
    strong: false,
  },
};

const MSG_PICK_FLOW_TAB = 'Switch to a Flow tab first.';
const MSG_SAVE_FAILED = 'The setting could not be saved.';

const toggle = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const statusCard = document.getElementById('status-card');
const statusTitle = document.getElementById('status-title');
const statusDesc = document.getElementById('status-desc');
const statusPill = document.querySelector('.status-pill');
const statusPillText = document.querySelector('.status-pill-text');
const interceptorState = document.getElementById('interceptor-state');
const errorEl = document.getElementById('error');
const errorBox = document.getElementById('error-box');
const reload = document.getElementById('reload');
const openBtn = document.getElementById('open');

const licenseBadge = document.getElementById('license-badge');
const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('token-input');
const tokenSubmit = document.getElementById('token-submit');
const tokenActiveView = document.getElementById('token-active-view');
const tokenMasked = document.getElementById('token-masked');
const tokenMetaEl = document.getElementById('token-meta');
const tokenLogout = document.getElementById('token-logout');

let tab;
let hasValidToken = false;

function setStatus(stateKey) {
  const s = STATES[stateKey] || STATES.enabled;

  if (statusCard) {
    statusCard.setAttribute('data-state', s.dot);
  }
  if (statusPill) {
    statusPill.className = 'status-pill status-pill--' + s.dot;
  }
  if (statusPillText) {
    statusPillText.textContent = s.badge;
  }
  if (statusTitle) {
    statusTitle.textContent = s.title;
  }
  if (statusDesc) {
    statusDesc.textContent = s.desc;
  }
  if (interceptorState) {
    interceptorState.textContent = s.interceptor;
    interceptorState.className = 'matrix-value info-val info-val--' + s.dot;
  }
  if (statusEl) {
    statusEl.classList.toggle('is-strong', !!s.strong);
    const legacyDot = statusEl.querySelector('.status-dot');
    if (legacyDot) legacyDot.className = 'status-dot status-dot--' + s.dot;
    const legacyText = statusEl.querySelector('.status-text');
    if (legacyText) legacyText.textContent = s.desc;
  }
}

function setEnabled(enabled) {
  toggle.setAttribute('aria-checked', String(enabled));
  toggle.classList.toggle('is-checked', !!enabled);
}

function showError(msg) {
  if (errorEl) errorEl.textContent = msg || '';
  if (errorBox) errorBox.hidden = !msg;
}

function renderLicenseState(auth) {
  hasValidToken = Boolean(auth?.hasToken);
  if (hasValidToken) {
    if (tokenForm) tokenForm.hidden = true;
    if (tokenActiveView) tokenActiveView.hidden = false;
    if (licenseBadge) {
      licenseBadge.textContent = 'VERIFIED';
      licenseBadge.classList.add('is-active');
    }
    if (tokenMasked) {
      tokenMasked.textContent = auth.maskedToken || 'OMNI-••••';
    }
    if (tokenMetaEl) {
      const meta = auth.tokenMeta || {};
      const label = meta.label ? `${meta.label} • ` : '';
      const devs = meta.devicesUsed && meta.maxDevices ? `${meta.devicesUsed}/${meta.maxDevices} devices` : 'Active';
      const exp = meta.expiresAt
        ? ` • Exp ${new Date(meta.expiresAt).toLocaleDateString()}`
        : ' • Lifetime';
      tokenMetaEl.textContent = `${label}${devs}${exp}`;
    }
  } else {
    if (tokenForm) tokenForm.hidden = false;
    if (tokenActiveView) tokenActiveView.hidden = true;
    if (licenseBadge) {
      licenseBadge.textContent = 'REQUIRED';
      licenseBadge.classList.remove('is-active');
    }
  }
}

async function init() {
  showError('');

  const auth = await chrome.runtime.sendMessage({ type: 'getAuthState' });
  renderLicenseState(auth);

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isFlowTab = tab?.url?.startsWith(FLOW_URL);
  if (reload) reload.hidden = !isFlowTab;

  if (!hasValidToken) {
    setEnabled(false);
    toggle.disabled = true;
    setStatus('unauthenticated');
    return;
  }

  const isEnabled = Boolean(auth.enabled);
  setEnabled(isEnabled);
  toggle.disabled = false;
  setStatus(isEnabled ? 'enabled' : 'disabled');

  if (isFlowTab && isEnabled) {
    try {
      const diag = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
      if (diag?.applied) {
        setStatus('active');
      } else if (diag?.state === 'armed') {
        setStatus('armed');
      } else if (diag?.state === 'awaiting-spec') {
        setStatus('awaitingSpec');
      } else if (diag?.state === 'unauthenticated') {
        setStatus('reloadTab');
      } else if (diag?.state?.startsWith('spec unavailable') || diag?.state?.startsWith('spec invalid')) {
        setStatus('specUnavailable');
      } else if (diag?.state?.startsWith('schema mismatch')) {
        setStatus('schemaMismatch');
      } else {
        setStatus('reloadTab');
      }
    } catch {
      setStatus('reloadTab');
    }
  }
}

if (tokenForm) {
  tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = tokenInput?.value?.trim();
    if (!raw) {
      showError('Please enter your OmniFlow access token.');
      return;
    }

    showError('');
    if (tokenSubmit) {
      tokenSubmit.disabled = true;
      tokenSubmit.textContent = 'Checking…';
    }

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'activateToken',
        token: raw,
      });
      if (!res?.ok) {
        throw new Error(res?.error || 'Token activation failed.');
      }
      if (tokenInput) tokenInput.value = '';
      renderLicenseState(res);
      setEnabled(true);
      toggle.disabled = false;
      setStatus('saved');
    } catch (err) {
      showError(err.message);
    } finally {
      if (tokenSubmit) {
        tokenSubmit.disabled = false;
        tokenSubmit.textContent = 'Activate';
      }
    }
  });
}

if (tokenLogout) {
  tokenLogout.addEventListener('click', async () => {
    showError('');
    try {
      await chrome.runtime.sendMessage({ type: 'clearToken' });
      renderLicenseState({ hasToken: false });
      setEnabled(false);
      toggle.disabled = true;
      setStatus('unauthenticated');
    } catch (err) {
      showError(err.message);
    }
  });
}

toggle.addEventListener('click', async () => {
  if (!hasValidToken) {
    showError('Activate your access token first.');
    return;
  }
  const nextState = toggle.getAttribute('aria-checked') !== 'true';
  toggle.disabled = true;
  showError('');

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'setEnabled',
      enabled: nextState,
    });
    if (!res?.ok) {
      throw new Error(res?.error || MSG_SAVE_FAILED);
    }
    setEnabled(nextState);
    setStatus(nextState ? 'saved' : 'disabled');
  } catch (err) {
    setEnabled(!nextState);
    showError(err.message);
  } finally {
    toggle.disabled = false;
  }
});

if (openBtn) {
  openBtn.onclick = () => chrome.tabs.create({ url: FLOW_URL });
}

if (reload) {
  reload.onclick = async () => {
    try {
      const currentTab = await chrome.tabs.get(tab.id);
      if (!currentTab?.url?.startsWith(FLOW_URL)) {
        throw new Error(MSG_PICK_FLOW_TAB);
      }
      const url = new URL(currentTab.url);
      if (url.pathname.endsWith(UNSUPPORTED_COUNTRY_PATH)) {
        url.pathname = url.pathname.replace(/\/unsupported-country$/, '');
        await chrome.tabs.update(tab.id, { url: url.href });
      } else {
        await chrome.tabs.reload(tab.id);
      }
      window.close();
    } catch (err) {
      showError(err.message);
    }
  };
}

init().catch((err) => {
  showError(err.message);
});
