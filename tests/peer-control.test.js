const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parsePeerAction,
  redactPeerOutput,
  runPeerControl,
} = require('../scripts/peer-control');

test('parsePeerAction accepts only whitelisted actions', () => {
  assert.equal(parsePeerAction('peer status'), 'status');
  assert.equal(parsePeerAction('repair'), 'repair');
  assert.equal(parsePeerAction('', { SSH_ORIGINAL_COMMAND: 'logs' }), 'logs');
  assert.throws(() => parsePeerAction('rm -rf /'), /Unsupported peer action/);
});

test('redactPeerOutput removes secret-like values', () => {
  const redacted = redactPeerOutput('Authorization: Bearer abc.def.secret\nTOKEN=super-secret-value');
  assert.doesNotMatch(redacted, /abc\.def\.secret/);
  assert.doesNotMatch(redacted, /super-secret-value/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('runPeerControl restart only runs service restart and health check', async () => {
  const calls = [];
  const result = await runPeerControl('restart', {
    service: 'openclaw-feishu-bridge',
    projectDir: '/opt/OpenclawHomework',
    healthUrl: 'http://127.0.0.1:8788/health',
  }, {
    execFile: async (command, args) => {
      calls.push([command, args]);
      if (command === 'systemctl' && args[0] === 'restart') {
        return '';
      }
      if (command === 'systemctl' && args[0] === 'is-active') {
        return 'active\n';
      }
      if (command === 'git') {
        return 'abc1234\n';
      }
      throw new Error(`unexpected command ${command}`);
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"ok":true}',
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.active, 'active');
  assert.deepEqual(calls[0], ['systemctl', ['restart', 'openclaw-feishu-bridge']]);
  assert(calls.some(([command, args]) => command === 'git' && args.includes('rev-parse')));
});

test('runPeerControl repair pulls code tests and restarts service', async () => {
  const calls = [];
  const result = await runPeerControl('repair', {
    service: 'hermes-feishu-bridge',
    projectDir: '/opt/OpenclawHomework',
    healthUrl: 'http://127.0.0.1:8788/health',
  }, {
    execFile: async (command, args) => {
      calls.push([command, args]);
      if (command === 'git' && args.includes('rev-parse')) {
        return 'def5678\n';
      }
      return '';
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{"ok":true}',
    }),
  });

  assert.equal(result.ok, true);
  assert(calls.some(([command, args]) => command === 'git' && args.includes('pull')));
  assert(calls.some(([command]) => command === 'npm'));
  assert(calls.some(([command, args]) => command === 'systemctl' && args[0] === 'restart'));
});
