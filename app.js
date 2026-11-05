if (typeof importScripts === 'function') {
  try {
    importScripts('config.js');
  } catch {}
}

const CONFIG = (typeof globalThis !== 'undefined' && globalThis.OMNIFLOW_CONFIG) ||
  (typeof require === 'function' ? require('./config.js') : {});

const CONTENT_SCRIPT_ID = CONFIG.CONTENT_SCRIPT_ID || 'omniflow-core';

const registration = {
  id: CONTENT_SCRIPT_ID,
  matches: ['https://flow.google.com/*'],
  js: ['engine.js'],
  runAt: 'document_start',
  world: 'MAIN',
  persistAcrossSessions: true,
};
const REGISTRATIONS = [registration];
const REGISTRATION_IDS = [CONTENT_SCRIPT_ID];

function maskToken(rawToken) {
  const clean = String(rawToken || '').trim().toUpperCase();
  if (!clean) return '';
  const parts = clean.split('-');
  if (parts.length >= 3) {
    return `${parts[0]}-••••-${parts[parts.length - 1]}`;
  }
  if (clean.length > 8) {
    return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
  }
  return '••••';
}

async function validateTokenWithSupabase(rawToken, deviceId, fetchImpl = fetch) {
  const normToken = String(rawToken || '').trim().toUpperCase();
  if (!normToken) {
    return {
      ok: false,
      errorCode: 'INVALID_TOKEN',
      error: 'Please enter an access token.',
    };
  }

  const endpoint = CONFIG.VALIDATION_ENDPOINT || 'https://omniflow-admin.vercel.app/api/validate';

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OmniFlow-Client': `v${CONFIG.VERSION || '1.0.0'}`,
      },
      body: JSON.stringify({
        token: normToken,
        device_id: deviceId || 'default-device',
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      return {
        ok: false,
        errorCode: data?.error_code || 'GATEWAY_ERROR',
        error: data?.message || `Validation gateway error (HTTP ${response.status}).`,
      };
    }

    if (!data.ok || !data.spec) {
      return {
        ok: false,
        errorCode: data?.error_code || 'INVALID_TOKEN',
        error: data?.message || 'Invalid or inactive access token.',
      };
    }

    return {
      ok: true,
      token: normToken,
      spec: data.spec,
      meta: {
        label: data.meta?.label || data.token?.label || 'OmniFlow Pass',
        status: data.meta?.status || data.token?.status || 'active',
        devicesUsed: data.meta?.devicesUsed ?? data.token?.devices_used ?? 1,
        maxDevices: data.meta?.maxDevices ?? data.token?.max_devices ?? 1,
        expiresAt: data.meta?.expiresAt ?? data.token?.expires_at ?? null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      errorCode: 'NETWORK_ERROR',
      error: err?.message || 'Unable to reach OmniFlow license server.',
    };
  }
}

async function getStorageData(keys) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  return chrome.storage.local.get(keys);
}

async function setStorageData(items) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set(items);
}

async function removeStorageData(keys) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.remove(keys);
}

async function getOrCreateDeviceId() {
  const data = await getStorageData(['deviceId']);
  if (data.deviceId && typeof data.deviceId === 'string') {
    return data.deviceId;
  }
  const randomPart = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const deviceId = `omniflow_${randomPart}`;
  await setStorageData({ deviceId });
  return deviceId;
}

async function syncRegistration() {
  if (typeof chrome === 'undefined' || !chrome.scripting) return false;
  try {
    const { accessToken, cachedSpec, enabled } = await getStorageData([
      'accessToken',
      'cachedSpec',
      'enabled',
    ]);
    const shouldRegister = Boolean(accessToken && cachedSpec && enabled !== false);
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: REGISTRATION_IDS,
    });

    if (shouldRegister && registered.length === 0) {
      await chrome.scripting.registerContentScripts(REGISTRATIONS);
    } else if (!shouldRegister && registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({
        ids: REGISTRATION_IDS,
      });
    }
    return shouldRegister;
  } catch (err) {
    console.error('OmniFlow setup failed:', err.message);
    return false;
  }
}

async function revalidateStoredToken() {
  const { accessToken } = await getStorageData(['accessToken']);
  if (!accessToken) {
    await syncRegistration();
    return;
  }
  const deviceId = await getOrCreateDeviceId();
  const result = await validateTokenWithSupabase(accessToken, deviceId);
  if (result.ok) {
    await setStorageData({
      cachedSpec: result.spec,
      tokenMeta: result.meta,
      validatedAt: Date.now(),
    });
  } else if (result.errorCode !== 'NETWORK_ERROR') {
    await removeStorageData(['accessToken', 'cachedSpec', 'tokenMeta', 'validatedAt']);
    await setStorageData({ enabled: false });
  }
  await syncRegistration();
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(() => {
    revalidateStoredToken();
  });

  chrome.runtime.onStartup.addListener(() => {
    revalidateStoredToken();
  });

  syncRegistration();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;

    if (message?.type === 'getSpec') {
      (async () => {
        const { accessToken, cachedSpec, enabled } = await getStorageData([
          'accessToken',
          'cachedSpec',
          'enabled',
        ]);
        if (accessToken && cachedSpec && enabled !== false) {
          sendResponse({ ok: true, spec: cachedSpec });
        } else {
          sendResponse({ ok: false, spec: null });
        }
      })().catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (!sender.tab && message?.type === 'getAuthState') {
      (async () => {
        const { accessToken, cachedSpec, tokenMeta, enabled } = await getStorageData([
          'accessToken',
          'cachedSpec',
          'tokenMeta',
          'enabled',
        ]);
        const hasToken = Boolean(accessToken && cachedSpec);
        sendResponse({
          ok: true,
          hasToken,
          maskedToken: hasToken ? maskToken(accessToken) : null,
          tokenMeta: hasToken ? (tokenMeta || {}) : null,
          enabled: Boolean(hasToken && enabled !== false),
        });
      })().catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (!sender.tab && message?.type === 'activateToken') {
      (async () => {
        const deviceId = await getOrCreateDeviceId();
        const result = await validateTokenWithSupabase(message.token, deviceId);
        if (!result.ok) {
          sendResponse({
            ok: false,
            errorCode: result.errorCode,
            error: result.error,
          });
          return;
        }
        await setStorageData({
          accessToken: result.token,
          cachedSpec: result.spec,
          tokenMeta: result.meta,
          enabled: true,
          validatedAt: Date.now(),
        });
        await syncRegistration();
        sendResponse({
          ok: true,
          hasToken: true,
          maskedToken: maskToken(result.token),
          tokenMeta: result.meta,
          enabled: true,
        });
      })().catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (!sender.tab && message?.type === 'clearToken') {
      (async () => {
        await removeStorageData(['accessToken', 'cachedSpec', 'tokenMeta', 'validatedAt']);
        await setStorageData({ enabled: false });
        await syncRegistration();
        sendResponse({ ok: true });
      })().catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (!sender.tab && message?.type === 'setEnabled') {
      (async () => {
        const { accessToken, cachedSpec } = await getStorageData(['accessToken', 'cachedSpec']);
        if (!accessToken || !cachedSpec) {
          sendResponse({
            ok: false,
            error: 'Activate a valid OmniFlow access token first.',
          });
          return;
        }
        await setStorageData({ enabled: Boolean(message.enabled) });
        await syncRegistration();
        sendResponse({ ok: true });
      })().catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateTokenWithSupabase,
    maskToken,
    CONTENT_SCRIPT_ID,
  };
}
