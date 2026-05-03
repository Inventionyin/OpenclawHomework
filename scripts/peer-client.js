const { execFile: execFileCallback } = require('node:child_process');
const { redactPeerOutput } = require('./peer-control');

const PEER_ACTION_MAP = {
  'peer-status': 'status',
  'peer-health': 'health',
  'peer-logs': 'logs',
  'peer-restart': 'restart',
  'peer-repair': 'repair',
  'peer-exec': 'exec',
};

function execFilePromise(command, args = [], options = {}, execFileImpl = execFileCallback) {
  if (execFileImpl.length <= 2) {
    return execFileImpl(command, args, options);
  }

  return new Promise((resolve, reject) => {
    execFileImpl(command, args, {
      timeout: 180000,
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

function buildPeerSshConfig(env = process.env) {
  return {
    host: env.PEER_SSH_HOST || '',
    user: env.PEER_SSH_USER || 'root',
    port: env.PEER_SSH_PORT || '22',
    keyPath: env.PEER_SSH_KEY || '',
    targetName: env.PEER_NAME || 'peer',
  };
}

function normalizePeerAction(action) {
  const normalized = PEER_ACTION_MAP[action] || action;
  if (!['status', 'health', 'logs', 'restart', 'repair', 'exec'].includes(normalized)) {
    throw new Error('Unsupported peer action.');
  }
  return normalized;
}

async function runPeerSshAction(action, env = process.env, options = {}, route = {}) {
  const peerAction = normalizePeerAction(action);
  const config = buildPeerSshConfig(env);
  if (!config.host || !config.keyPath) {
    return {
      service: config.targetName,
      active: 'unknown',
      health: 'peer ssh is not configured',
      watchdog: 'peer-control',
      commit: 'unknown',
      target: config.targetName,
      operation: action,
      detail: '请先配置 PEER_SSH_HOST 和 PEER_SSH_KEY。',
    };
  }

  const execFile = options.execFile || execFilePromise;
  const remoteCommand = peerAction === 'exec'
    ? `exec ${String(route.command || '').trim()}`
    : peerAction;
  const output = await execFile('ssh', [
    '-i',
    config.keyPath,
    '-p',
    String(config.port),
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
    `${config.user}@${config.host}`,
    remoteCommand,
  ], { timeout: 240000 });

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = {
      detail: redactPeerOutput(output),
    };
  }

  return {
    service: parsed.service || config.targetName,
    active: parsed.active || 'unknown',
    health: parsed.health || 'unknown',
    watchdog: parsed.watchdog || 'peer-control',
    commit: parsed.commit || 'unknown',
    target: config.targetName,
    operation: action,
    detail: parsed.detail || (parsed.ok ? 'ok' : 'unknown'),
  };
}

module.exports = {
  PEER_ACTION_MAP,
  buildPeerSshConfig,
  normalizePeerAction,
  runPeerSshAction,
};
