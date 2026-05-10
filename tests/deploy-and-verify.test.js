const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRemoteScript,
  buildSshArgs,
  deployTarget,
  formatDeployResults,
  parseCliArgs,
  resolveTarget,
  runDeployAndVerify,
} = require('../scripts/deploy-and-verify');

test('parseCliArgs reads target ref and safety flags', () => {
  const config = parseCliArgs([
    '--targets', 'hermes',
    '--ref', 'origin/main',
    '--branch', 'main',
    '--dry-run',
    '--skip-restart',
    '--npm-install',
  ]);

  assert.deepEqual(config.targets, ['hermes']);
  assert.equal(config.ref, 'origin/main');
  assert.equal(config.branch, 'main');
  assert.equal(config.dryRun, true);
  assert.equal(config.skipRestart, true);
  assert.equal(config.runNpmInstall, true);
});

test('parseCliArgs rejects invalid timeout values', () => {
  assert.throws(() => parseCliArgs(['--timeout-ms', 'abc']), /Invalid --timeout-ms/);
  assert.throws(() => parseCliArgs(['--timeout-ms', '0']), /Invalid --timeout-ms/);
});

test('resolveTarget uses env without embedding secrets', () => {
  const target = resolveTarget('openclaw', {
    DEPLOY_OPENCLAW_HOST: '38.76.178.91',
    DEPLOY_OPENCLAW_USER: 'root',
    DEPLOY_OPENCLAW_KEY: '/root/.ssh/openclaw_deploy',
  });

  assert.equal(target.name, 'openclaw');
  assert.equal(target.host, '38.76.178.91');
  assert.equal(target.user, 'root');
  assert.equal(target.keyPath, '/root/.ssh/openclaw_deploy');
  assert.equal(target.service, 'openclaw-feishu-bridge');
  assert.equal(target.projectDir, '/opt/OpenclawHomework');
});

test('buildRemoteScript updates verifies and restarts bridge services', () => {
  const script = buildRemoteScript({
    projectDir: '/opt/OpenclawHomework',
    service: 'hermes-feishu-bridge',
    inboxService: 'hermes-clawemail-inbox-notifier',
  }, {
    branch: 'main',
    ref: 'origin/main',
    healthUrl: 'http://127.0.0.1:8788/health',
  });

  assert.match(script, /cd '\/opt\/OpenclawHomework'/);
  assert.match(script, /git fetch origin 'main'/);
  assert.match(script, /git reset --hard 'origin\/main'/);
  assert.match(script, /node --check scripts\/feishu-bridge\.js/);
  assert.match(script, /node scripts\/agent-evals\.js/);
  assert.match(script, /systemctl restart 'hermes-feishu-bridge'/);
  assert.match(script, /systemctl restart 'hermes-clawemail-inbox-notifier' \|\| true/);
  assert.match(script, /test "\$bridge_status" = active/);
  assert.match(script, /health_body="\$\(curl -fsS 'http:\/\/127\.0\.0\.1:8788\/health' 2>\/dev\/null\)"/);
  assert.match(script, /curl -fsS 'http:\/\/127\.0\.0\.1:8788\/health'/);
  assert.doesNotMatch(script, /password/i);
  assert.doesNotMatch(script, /sk-[A-Za-z0-9_-]+/);
});

test('buildSshArgs requires configured host and supports key auth', () => {
  const ssh = buildSshArgs({
    name: 'hermes',
    host: '38.76.188.94',
    user: 'root',
    port: '22',
    keyPath: '/tmp/hermes-key',
  }, 'echo ok');

  assert.equal(ssh.command, 'ssh');
  assert.deepEqual(ssh.args.slice(0, 8), [
    '-p', '22',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', '/tmp/hermes-key',
  ]);
  assert.equal(ssh.args.at(-2), 'root@38.76.188.94');
  assert.equal(ssh.args.at(-1), 'bash -s');
  assert.equal(ssh.input, 'echo ok');

  assert.throws(() => buildSshArgs({ name: 'hermes', host: '' }, 'echo ok'), /Missing host/);
});

test('runDeployAndVerify supports dry-run for both production targets', async () => {
  const results = await runDeployAndVerify({
    targets: ['openclaw', 'hermes'],
    ref: 'origin/main',
    branch: 'main',
    dryRun: true,
    skipRestart: false,
    runNpmInstall: false,
    healthUrl: 'http://127.0.0.1:8788/health',
    timeoutMs: 1000,
  }, {
    DEPLOY_OPENCLAW_HOST: 'openclaw.example',
    DEPLOY_HERMES_HOST: 'hermes.example',
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'openclaw');
  assert.equal(results[0].dryRun, true);
  assert.match(results[0].remoteScript, /openclaw-feishu-bridge/);
  assert.match(results[1].remoteScript, /hermes-feishu-bridge/);
});

test('runDeployAndVerify executes ssh through injectable runner', async () => {
  const calls = [];
  const results = await runDeployAndVerify({
    targets: ['hermes'],
    ref: 'origin/main',
    branch: 'main',
    dryRun: false,
    skipRestart: true,
    runNpmInstall: false,
    healthUrl: 'http://127.0.0.1:8788/health',
    timeoutMs: 1000,
  }, {
    DEPLOY_HERMES_HOST: 'hermes.example',
    DEPLOY_HERMES_USER: 'root',
  }, async (command, args, options) => {
    calls.push({ command, args, input: options.input });
    return { stdout: 'after=10692dd Shorten default help menu\nbridge=active\n', stderr: '' };
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'ssh');
  assert.equal(calls[0].args.at(-2), 'root@hermes.example');
  assert.match(calls[0].input, /git reset --hard 'origin\/main'/);
  assert.doesNotMatch(calls[0].input, /systemctl restart 'hermes-feishu-bridge'/);
  assert.equal(results[0].stdout.includes('bridge=active'), true);
});

test('deployTarget propagates ssh runner failures', async () => {
  await assert.rejects(
    () => deployTarget('hermes', {
      targets: ['hermes'],
      ref: 'origin/main',
      branch: 'main',
      dryRun: false,
      skipRestart: false,
      runNpmInstall: false,
      healthUrl: 'http://127.0.0.1:8788/health',
      timeoutMs: 1000,
    }, {
      DEPLOY_HERMES_HOST: 'hermes.example',
    }, async () => {
      const error = new Error('Command failed');
      error.stdout = 'bridge=inactive\n';
      error.stderr = '';
      throw error;
    }),
    /Command failed/,
  );
});

test('formatDeployResults renders dry-run and deploy summaries', () => {
  const text = formatDeployResults([
    {
      name: 'openclaw',
      dryRun: true,
      command: 'ssh',
      args: ['root@example', 'bash -s'],
      remoteScript: 'git reset --hard origin/main',
    },
    {
      name: 'hermes',
      dryRun: false,
      stdout: 'after=abc\nbridge=active\n',
      stderr: '',
    },
  ]);

  assert.match(text, /\[openclaw] dry-run/);
  assert.match(text, /git reset --hard origin\/main/);
  assert.match(text, /\[hermes] deployed/);
  assert.match(text, /bridge=active/);
});
