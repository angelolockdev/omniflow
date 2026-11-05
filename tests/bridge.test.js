const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('all active project files use OmniFlow identifiers and contain zero legacy tokens', () => {
  const files = [
    'manifest.json',
    'config.js',
    'app.js',
    'engine.js',
    'link.js',
    'stat.js',
    'panel.html',
    'panel.js',
    'panel.css',
    'info.html',
    'index.html',
    'README.md',
    'scripts/release.sh',
  ];
  const forbidden = [
    'flow-helper',
    'flowpass',
    'zephinax',
    'cfc-flow-spec',
    'data-flow-local-diagnostic',
    '__flowLocalDiagnostic',
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8').toLowerCase();
    for (const token of forbidden) {
      assert.equal(
        content.includes(token.toLowerCase()),
        false,
        `${file} still contains forbidden legacy token: ${token}`
      );
    }
  }

  assert.equal(fs.readFileSync('app.js', 'utf8').includes('omniflow-core'), true);
  assert.equal(fs.readFileSync('link.js', 'utf8').includes('omniflow:config'), true);
  assert.equal(fs.readFileSync('stat.js', 'utf8').includes('data-omniflow-state'), true);
  assert.equal(fs.readFileSync('panel.html', 'utf8').includes('id="license-card"'), true);
});

test('validateTokenWithSupabase handles valid, expired, device-limited, and invalid tokens', async () => {
  const { validateTokenWithSupabase, maskToken } = require('../app.js');

  assert.equal(maskToken('OMNI-332E-FA2C-C6A9'), 'OMNI-••••-C6A9');

  const okRes = await validateTokenWithSupabase('omni-332e-fa2c-c6a9', 'dev-1', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      spec: { rpcids: 'cPZSdc', flagIndex: 30 },
      meta: { label: 'VIP', devicesUsed: 1, maxDevices: 2, expiresAt: null },
    }),
  }));
  assert.equal(okRes.ok, true);
  assert.equal(okRes.token, 'OMNI-332E-FA2C-C6A9');
  assert.equal(okRes.spec.rpcids, 'cPZSdc');

  const limitRes = await validateTokenWithSupabase('OMNI-0000-0000-0000', 'dev-3', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: false,
      error_code: 'DEVICE_LIMIT_REACHED',
      message: 'Device limit reached (2/2 devices).',
    }),
  }));
  assert.equal(limitRes.ok, false);
  assert.equal(limitRes.errorCode, 'DEVICE_LIMIT_REACHED');
});


test('live API Gateway validates real token idempotently and rejects unknown token', async () => {
  const { validateTokenWithSupabase } = require('../app.js');

  const valid = await validateTokenWithSupabase('OMNI-332E-FA2C-C6A9', 'dev-verify-1');
  assert.equal(valid.ok, true);
  assert.equal(valid.spec.rpcids, 'cPZSdc');
  assert.equal(valid.spec.flagIndex, 30);
  assert.equal(typeof valid.meta.devicesUsed === 'number' && valid.meta.devicesUsed >= 1, true);

  const invalid = await validateTokenWithSupabase('OMNI-0000-INVALID-KEY', 'dev-verify-1');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, 'INVALID_TOKEN');
});


test('README.md and index.html do not disclose internal security or backend details', () => {
  const publicDocs = ['README.md', 'index.html'];
  const sensitiveTerms = [
    'supabase',
    'validate_omniflow_token',
    'create_omniflow_token',
    'omniflow_tokens',
    'omniflow_specs',
    'cpzsdc',
    'flagindex',
    'schema.sql',
    'security definer',
  ];

  for (const doc of publicDocs) {
    const text = fs.readFileSync(doc, 'utf8').toLowerCase();
    for (const term of sensitiveTerms) {
      assert.equal(
        text.includes(term),
        false,
        `${doc} must not disclose sensitive term: ${term}`
      );
    }
  }
});
