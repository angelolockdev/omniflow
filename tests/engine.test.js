const test = require('node:test');
const assert = require('node:assert/strict');
const { patch, isBatchexecuteRequest } = require('../engine.js');

const SAMPLE_SPEC = {
  v: 1,
  origin: 'https://flow.google.com',
  path: '/_/AiSandboxAngularFrontend/data/batchexecute',
  rpcids: 'cPZSdc',
  tag: 'wrb.fr',
  flagIndex: 30,
  ageFlagIndex: 31,
  minLength: 32,
};

test('isBatchexecuteRequest returns false when no spec is active (unauthenticated gate)', () => {
  assert.equal(
    isBatchexecuteRequest('https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=cPZSdc', null),
    false
  );
});

test('isBatchexecuteRequest matches valid single and comma-separated rpcids and rejects wrong origin', () => {
  assert.equal(
    isBatchexecuteRequest('https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=cPZSdc', SAMPLE_SPEC),
    true
  );
  assert.equal(
    isBatchexecuteRequest('https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=abc,cPZSdc,xyz', SAMPLE_SPEC),
    true
  );
  assert.equal(
    isBatchexecuteRequest('https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=otherId', SAMPLE_SPEC),
    false
  );
  assert.equal(
    isBatchexecuteRequest('https://example.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=cPZSdc', SAMPLE_SPEC),
    false
  );
});

test('patch expands truncated payload, sets flagIndex 30 to true, and updates UTF-8 byte length prefix', () => {
  const innerPayload = Array(10).fill(null);
  const envelope = [['wrb.fr', 'cPZSdc', JSON.stringify(innerPayload), null, null, null, 'generic']];
  const line = JSON.stringify(envelope);
  const byteLen = Buffer.byteLength(line, 'utf8');
  const rawBody = `)]}'\n\n${byteLen}\n${line}\n`;

  const result = patch(rawBody, SAMPLE_SPEC);
  assert.equal(result.before, null);

  const lines = result.body.split('\n');
  const updatedEnvelope = JSON.parse(lines[3]);
  const updatedPayload = JSON.parse(updatedEnvelope[0][2]);
  assert.equal(updatedPayload[30], true);
  assert.equal(Number(lines[2]), Buffer.byteLength(lines[3], 'utf8'));
});

test('patch flips false age restriction at index 31 to true and preserves multi-byte UTF-8 length accuracy', () => {
  const innerPayload = Array(32).fill(null);
  innerPayload[0] = 'région-éligibilité-éàç';
  innerPayload[30] = false;
  innerPayload[31] = false;
  const envelope = [['wrb.fr', 'cPZSdc', JSON.stringify(innerPayload)]];
  const line = JSON.stringify(envelope);
  const byteLen = Buffer.byteLength(line, 'utf8');
  const rawBody = `)]}'\n\n${byteLen}\n${line}\n`;

  const result = patch(rawBody, SAMPLE_SPEC);
  assert.equal(result.before, false);
  const lines = result.body.split('\n');
  const updatedPayload = JSON.parse(JSON.parse(lines[3])[0][2]);
  assert.equal(updatedPayload[30], true);
  assert.equal(updatedPayload[31], true);
  assert.equal(Number(lines[2]), Buffer.byteLength(lines[3], 'utf8'));
});
