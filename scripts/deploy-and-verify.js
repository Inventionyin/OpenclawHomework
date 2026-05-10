const { execFile } = require('node:child_process');

const DEFAULT_TARGETS = {
  openclaw: {
    hostEnv: 'DEPLOY_OPENCLAW_HOST',
    userEnv: 'DEPLOY_OPENCLAW_USER',
    portEnv: 'DEPLOY_OPENCLAW_PORT',
    keyEnv: 'DEPLOY_OPENCLAW_KEY',
    service: 'openclaw-feishu-bridge',
    inboxService: 'openclaw-clawemail-inbox-notifier',
    projectDir: '/opt/OpenclawHomework',
  },
  hermes: {
    hostEnv: 'DEPLOY_HERMES_HOST',
    userEnv: 'DEPLOY_HERMES_USER',
    portEnv: 'DEPLOY_HERMES_PORT',
    keyEnv: 'DEPLOY_HERMES_KEY',
    service: 'hermes-feishu-bridge',
    inboxService: 'hermes-clawemail-inbox-notifier',
    projectDir: '/opt/OpenclawHomework',
  },
};

function readOption(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseTargetList(value) {
  return String(value || 'openclaw,hermes')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseTimeoutMs(value) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${value}`);
  }
  return timeoutMs;
}

function parseCliArgs(args = process.argv.slice(2), env = process.env) {
  const targets = parseTargetList(readOption(args, '--targets', env.DEPLOY_TARGETS || 'openclaw,hermes'));
  for (const target of targets) {
    if (!DEFAULT_TARGETS[target]) {
      throw new Error(`Unknown deploy target: ${target}`);
    }
  }

  return {
    targets,
    ref: readOption(args, '--ref', env.DEPLOY_REF || 'origin/main'),
    branch: readOption(args, '--branch', env.DEPLOY_BRANCH || 'main'),
    healthUrl: readOption(args, '--health-url', env.DEPLOY_HEALTH_URL || 'http://127.0.0.1:8788/health'),
    runNpmInstall: hasFlag(args, '--npm-install') || env.DEPLOY_NPM_INSTALL === 'true',
    dryRun: hasFlag(args, '--dry-run') || env.DEPLOY_DRY_RUN === 'true',
    skipRestart: hasFlag(args, '--skip-restart') || env.DEPLOY_SKIP_RESTART === 'true',
    timeoutMs: parseTimeoutMs(readOption(args, '--timeout-ms', env.DEPLOY_TIMEOUT_MS || '180000')),
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildRemoteScript(target, config = {}) {
  const lines = [
    'set -euo pipefail',
    `cd ${shellQuote(target.projectDir)}`,
    'printf "before=%s\\n" "$(git log -1 --oneline)"',
    `git fetch origin ${shellQuote(config.branch || 'main')}`,
    `git reset --hard ${shellQuote(config.ref || 'origin/main')}`,
  ];

  if (config.runNpmInstall) {
    lines.push('npm ci || npm install');
  }

  lines.push(
    'node --check scripts/feishu-bridge.js',
    'node scripts/agent-evals.js',
  );

  if (!config.skipRestart) {
    lines.push(
      `systemctl restart ${shellQuote(target.service)}`,
      `systemctl restart ${shellQuote(target.inboxService)} || true`,
    );
  }

  lines.push(
    'sleep 1',
    'printf "after=%s\\n" "$(git log -1 --oneline)"',
    `bridge_status="$(systemctl is-active ${shellQuote(target.service)} || true)"`,
    'printf "bridge=%s\\n" "$bridge_status"',
    'test "$bridge_status" = active',
    `inbox_status="$(systemctl is-active ${shellQuote(target.inboxService)} || true)"`,
    'printf "inbox=%s\\n" "$inbox_status"',
    `health_body="$(curl -fsS ${shellQuote(config.healthUrl || 'http://127.0.0.1:8788/health')} 2>/dev/null)"`,
    'printf "health=%s\\n" "$health_body"',
  );

  return lines.join('\n');
}

function resolveTarget(name, env = process.env) {
  const base = DEFAULT_TARGETS[name];
  if (!base) throw new Error(`Unknown deploy target: ${name}`);
  return {
    name,
    host: env[base.hostEnv] || '',
    user: env[base.userEnv] || 'root',
    port: env[base.portEnv] || '22',
    keyPath: env[base.keyEnv] || '',
    service: base.service,
    inboxService: base.inboxService,
    projectDir: base.projectDir,
  };
}

function buildSshArgs(target, remoteScript) {
  if (!target.host) {
    throw new Error(`Missing host for ${target.name}. Set ${DEFAULT_TARGETS[target.name].hostEnv}.`);
  }

  const args = [
    '-p', String(target.port || '22'),
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
  ];
  if (target.keyPath) {
    args.push('-i', target.keyPath);
  }
  args.push(`${target.user || 'root'}@${target.host}`, 'bash -s');

  return { command: 'ssh', args, input: remoteScript };
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      timeout: options.timeoutMs || 180000,
      maxBuffer: 1024 * 1024 * 5,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    if (options.input) {
      child.stdin.end(options.input);
    }
  });
}

async function deployTarget(name, config = {}, env = process.env, runner = execFilePromise) {
  const target = resolveTarget(name, env);
  const remoteScript = buildRemoteScript(target, config);
  const ssh = buildSshArgs(target, remoteScript);

  if (config.dryRun) {
    return {
      name,
      dryRun: true,
      command: ssh.command,
      args: ssh.args,
      remoteScript,
    };
  }

  const result = await runner(ssh.command, ssh.args, {
    input: ssh.input,
    timeoutMs: config.timeoutMs,
  });
  return {
    name,
    dryRun: false,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function runDeployAndVerify(config = parseCliArgs(), env = process.env, runner = execFilePromise) {
  const results = [];
  for (const name of config.targets) {
    results.push(await deployTarget(name, config, env, runner));
  }
  return results;
}

function formatDeployResults(results = []) {
  return results.map((result) => {
    if (result.dryRun) {
      return [
        `[${result.name}] dry-run`,
        `${result.command} ${result.args.join(' ')}`,
        result.remoteScript,
      ].join('\n');
    }
    return [
      `[${result.name}] deployed`,
      String(result.stdout || '').trim(),
      String(result.stderr || '').trim() ? `stderr:\n${String(result.stderr).trim()}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

if (require.main === module) {
  runDeployAndVerify()
    .then((results) => {
      console.log(formatDeployResults(results));
    })
    .catch((error) => {
      console.error(error.message);
      if (error.stdout) console.error(error.stdout);
      if (error.stderr) console.error(error.stderr);
      process.exit(1);
    });
}

module.exports = {
  buildRemoteScript,
  buildSshArgs,
  deployTarget,
  formatDeployResults,
  parseCliArgs,
  resolveTarget,
  runDeployAndVerify,
};
