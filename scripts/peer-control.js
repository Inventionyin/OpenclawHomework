const { execFile: execFileCallback } = require('node:child_process');

const ALLOWED_PEER_ACTIONS = new Set(['status', 'health', 'logs', 'restart', 'repair']);

function parsePeerAction(value = '', env = process.env) {
  const raw = String(value || env.SSH_ORIGINAL_COMMAND || '').trim();
  const normalized = raw.replace(/^peer\s+/i, '').trim().toLowerCase();

  if (!ALLOWED_PEER_ACTIONS.has(normalized)) {
    throw new Error('Unsupported peer action.');
  }

  return normalized;
}

function redactPeerOutput(value) {
  return String(value ?? '')
    .replace(/\b(authorization\s*:\s*bearer)\s+\S+/gi, '$1 [REDACTED]')
    .replace(/\b(token|secret|password|api[_-]?key)\s*=\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}/g, '[REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}

function execFilePromise(command, args = [], options = {}, execFileImpl = execFileCallback) {
  if (execFileImpl.length <= 2) {
    return execFileImpl(command, args, options);
  }

  return new Promise((resolve, reject) => {
    execFileImpl(command, args, {
      timeout: 120000,
      windowsHide: true,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(redactPeerOutput(`${error.message}\n${stderr || ''}`.trim())));
        return;
      }
      resolve(stdout);
    });
  });
}

function buildConfig(env = process.env) {
  return {
    service: env.PEER_SERVICE_NAME || env.WATCHDOG_SERVICE || 'openclaw-feishu-bridge',
    projectDir: env.PEER_PROJECT_DIR || '/opt/OpenclawHomework',
    healthUrl: env.PEER_HEALTH_URL || 'http://127.0.0.1:8788/health',
    logLines: Number(env.PEER_LOG_LINES || 80),
  };
}

async function checkHealth(healthUrl, fetchImpl = fetch) {
  const response = await fetchImpl(healthUrl, { method: 'GET' });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status} ${response.statusText} ${body}`);
  }
  return body;
}

async function readStatus(config, impls = {}) {
  const execFile = impls.execFile || execFilePromise;
  const fetchImpl = impls.fetchImpl || fetch;
  const [active, commit] = await Promise.all([
    execFile('systemctl', ['is-active', config.service]).then((value) => String(value).trim()).catch((error) => `error: ${error.message}`),
    execFile('git', ['-C', config.projectDir, 'rev-parse', '--short', 'HEAD']).then((value) => String(value).trim()).catch(() => 'unknown'),
  ]);
  const health = await checkHealth(config.healthUrl, fetchImpl).catch((error) => `error: ${error.message}`);

  return {
    service: config.service,
    active,
    health: redactPeerOutput(health),
    watchdog: 'peer-control',
    commit,
  };
}

async function runPeerControl(action, config = buildConfig(), impls = {}) {
  const execFile = impls.execFile || execFilePromise;
  const fetchImpl = impls.fetchImpl || fetch;

  if (action === 'health') {
    return {
      ok: true,
      action,
      ...(await readStatus(config, { execFile, fetchImpl })),
    };
  }

  if (action === 'status') {
    return {
      ok: true,
      action,
      ...(await readStatus(config, { execFile, fetchImpl })),
    };
  }

  if (action === 'logs') {
    const output = await execFile('journalctl', ['-u', config.service, '-n', String(config.logLines), '--no-pager']);
    return {
      ok: true,
      action,
      service: config.service,
      detail: redactPeerOutput(output).slice(-2000),
      ...(await readStatus(config, { execFile, fetchImpl })),
    };
  }

  if (action === 'restart') {
    await execFile('systemctl', ['restart', config.service]);
    return {
      ok: true,
      action,
      detail: 'service restarted',
      ...(await readStatus(config, { execFile, fetchImpl })),
    };
  }

  if (action === 'repair') {
    await execFile('git', ['-C', config.projectDir, 'fetch', 'origin'], { timeout: 120000 });
    await execFile('git', ['-C', config.projectDir, 'pull', '--ff-only'], { timeout: 120000 });
    await execFile('npm', ['test'], { cwd: config.projectDir, timeout: 180000 });
    await execFile('systemctl', ['restart', config.service]);
    return {
      ok: true,
      action,
      detail: 'git pull --ff-only, npm test, and service restart completed',
      ...(await readStatus(config, { execFile, fetchImpl })),
    };
  }

  throw new Error('Unsupported peer action.');
}

async function main() {
  const action = parsePeerAction(process.argv.slice(2).join(' '));
  const result = await runPeerControl(action, buildConfig());
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(redactPeerOutput(error.message));
    process.exit(1);
  });
}

module.exports = {
  ALLOWED_PEER_ACTIONS,
  buildConfig,
  parsePeerAction,
  redactPeerOutput,
  runPeerControl,
};
