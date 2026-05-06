const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const ECOSYSTEM_PLUGINS = [
  {
    id: 'gbrain',
    name: 'GBrain',
    sourceUrl: 'https://github.com/garrytan/gbrain',
    trust: 'trusted',
    installMode: 'supported',
    role: '长期记忆、脑库检索、技能和 cron 工作流。',
    notes: '适合旁路安装并接入本项目 memory/docs/qa-assets，不直接接管生产聊天链路。',
  },
  {
    id: 'g_stack',
    name: 'G Stack',
    sourceUrl: 'https://github.com/garrytan/gbrain',
    trust: 'trusted',
    installMode: 'concept',
    role: 'GBrain 生态里的 coding skill stack 思路，用来沉淀工程任务流程。',
    notes: '目前没有核验到独立官方仓库；按 GBrain 技能体系吸收，不单独自动安装。',
  },
  {
    id: 'hermes_webui',
    name: 'Hermes WebUI',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent',
    trust: 'trusted',
    installMode: 'candidate',
    role: 'Hermes 官方 CLI/gateway 生态可能承载 Web/多平台入口。',
    notes: '当前不把搜索到的第三方 WebUI 当官方生产组件；先做候选和状态检查。',
  },
  {
    id: 'awesome_hermes_agent',
    name: 'Awesome Hermes Agent',
    sourceUrl: 'https://github.com/0xNyk/awesome-hermes-agent',
    trust: 'community',
    installMode: 'catalog',
    role: '生态导航目录，适合学习插件和技能玩法。',
    notes: '这是 Markdown 资料库，不是运行时插件；可同步进 GBrain 检索。',
  },
  {
    id: 'hermes_agent_self_evolution',
    name: 'Hermes Agent Self Evolution',
    sourceUrl: 'https://github.com/NousResearch/hermes-agent-self-evolution',
    trust: 'trusted',
    installMode: 'research',
    role: '实验性的技能、提示词和代码优化研究项目。',
    notes: '风险高于普通插件；只做候选，不默认接管当前 OpenClaw/Hermes 生产服务。',
  },
];

function listEcosystemPlugins() {
  return ECOSYSTEM_PLUGINS.map((plugin) => ({ ...plugin }));
}

function createEcosystemInstallPlan(options = {}) {
  const target = String(options.target || 'self').toLowerCase();
  const plugins = listEcosystemPlugins();
  const autoInstallIds = plugins
    .filter((plugin) => plugin.trust === 'trusted' && plugin.installMode === 'supported')
    .map((plugin) => plugin.id);
  const candidateIds = plugins
    .filter((plugin) => ['candidate', 'research'].includes(plugin.installMode))
    .map((plugin) => plugin.id);
  const researchIds = plugins
    .filter((plugin) => ['catalog', 'concept'].includes(plugin.installMode))
    .map((plugin) => plugin.id);

  return {
    target,
    plugins,
    autoInstallIds,
    candidateIds,
    researchIds,
    policy: '只自动安装可信且 supported 的项目；候选、目录和研究项目只登记、同步、提醒。',
  };
}

function getDefaultEcosystemStateFile(env = process.env) {
  return env.ECOSYSTEM_STATE_FILE || join(env.LOCAL_PROJECT_DIR || process.cwd(), 'data', 'memory', 'ecosystem-state.json');
}

function readEcosystemState(stateFile = getDefaultEcosystemStateFile()) {
  if (!stateFile || !existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeEcosystemState(stateFile = getDefaultEcosystemStateFile(), state = {}) {
  const safeState = {
    updatedAt: new Date().toISOString(),
    ...state,
  };
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify(safeState, null, 2)}\n`, 'utf8');
  return safeState;
}

function commandExists(command) {
  try {
    execFileSync('bash', ['-lc', `command -v ${command}`], {
      stdio: 'ignore',
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

function detectInstalledEcosystem(env = process.env) {
  const gbrainBin = env.GBRAIN_BIN || 'gbrain';
  const installed = [];
  const skipped = [];

  if (commandExists(gbrainBin)) {
    installed.push({ id: 'gbrain', name: 'GBrain', status: 'installed', bin: gbrainBin });
  } else if (existsSync('/opt/gbrain/.git')) {
    installed.push({ id: 'gbrain', name: 'GBrain', status: 'source-present', path: '/opt/gbrain' });
  } else {
    skipped.push({ id: 'gbrain', name: 'GBrain', reason: '尚未检测到 gbrain 命令或 /opt/gbrain 源码' });
  }

  return { installed, skipped };
}

function buildEcosystemStatusReply(state = {}) {
  const target = state.target || '当前机器人';
  const installed = Array.isArray(state.installed) ? state.installed : [];
  const skipped = Array.isArray(state.skipped) ? state.skipped : [];
  const plan = createEcosystemInstallPlan({ target });
  const lines = [
    `${target} 生态技能状态：`,
    `- 策略：${plan.policy}`,
    `- 自动安装白名单：${plan.autoInstallIds.join(', ') || '无'}`,
  ];

  if (installed.length) {
    lines.push('已安装/已接入：');
    installed.forEach((item) => {
      lines.push(`- ${item.name || item.id}：${item.status || 'ok'}`);
    });
  } else {
    lines.push('已安装/已接入：暂未检测到可确认项目');
  }

  if (skipped.length) {
    lines.push('候选/暂缓：');
    skipped.forEach((item) => {
      lines.push(`- ${item.name || item.id}：${item.reason || '需要人工确认来源和风险'}`);
    });
  }

  lines.push('安全边界：不会自动执行来路不明脚本；不会把 awesome 目录或自进化实验项目直接接管生产服务。');
  return lines.join('\n');
}

function buildInstallShellScript() {
  return [
    'set -euo pipefail',
    'export BUN_INSTALL="${BUN_INSTALL:-/root/.bun}"',
    'export PATH="$BUN_INSTALL/bin:$PATH"',
    'if command -v apt-get >/dev/null 2>&1; then apt-get update; apt-get install -y unzip git curl ca-certificates; fi',
    'if ! command -v bun >/dev/null 2>&1; then curl -fsSL https://bun.sh/install | bash; export PATH="$BUN_INSTALL/bin:$PATH"; fi',
    'if [ ! -d /opt/gbrain/.git ]; then rm -rf /opt/gbrain; git clone https://github.com/garrytan/gbrain.git /opt/gbrain; fi',
    'if git -C /opt/gbrain diff --quiet -- . && git -C /opt/gbrain diff --cached --quiet -- .; then',
    '  git -C /opt/gbrain fetch origin',
    '  git -C /opt/gbrain pull --ff-only origin master || git -C /opt/gbrain pull --ff-only origin main || true',
    'else',
    '  echo "Skipping GBrain update because /opt/gbrain has local changes." >&2',
    'fi',
    'cd /opt/gbrain',
    'bun install',
    'bun link || true',
    'if [ -x "$BUN_INSTALL/bin/gbrain" ]; then ln -sfn "$BUN_INSTALL/bin/gbrain" /usr/local/bin/gbrain; fi',
    'command -v gbrain || true',
    'gbrain --help | head -n 40 || true',
  ].join('\n');
}

function installSupportedEcosystem(options = {}) {
  const env = options.env || process.env;
  const stateFile = options.stateFile || getDefaultEcosystemStateFile(env);
  const target = String(options.target || env.ASSISTANT_NAME || 'self');
  const plan = createEcosystemInstallPlan({ target });
  const skipped = plan.plugins
    .filter((plugin) => !plan.autoInstallIds.includes(plugin.id))
    .map((plugin) => ({ id: plugin.id, name: plugin.name, reason: `${plugin.installMode}：${plugin.notes}` }));

  if (process.platform !== 'linux') {
    return writeEcosystemState(stateFile, {
      target,
      installed: [],
      skipped: [
        { id: 'gbrain', name: 'GBrain', reason: '当前不是 Linux 服务器，跳过自动安装' },
        ...skipped,
      ],
      plan,
    });
  }

  execFileSync('bash', ['-lc', buildInstallShellScript()], {
    stdio: options.stdio || 'pipe',
    timeout: Number(env.ECOSYSTEM_INSTALL_TIMEOUT_MS || 900000),
  });

  const detected = detectInstalledEcosystem(env);
  return writeEcosystemState(stateFile, {
    target,
    installed: detected.installed,
    skipped: [...detected.skipped, ...skipped],
    plan,
  });
}

function runMaintenance(options = {}) {
  const env = options.env || process.env;
  const stateFile = options.stateFile || getDefaultEcosystemStateFile(env);
  const detected = detectInstalledEcosystem(env);
  const previous = readEcosystemState(stateFile) || {};
  return writeEcosystemState(stateFile, {
    ...previous,
    target: previous.target || env.ASSISTANT_NAME || 'self',
    installed: detected.installed,
    skipped: detected.skipped,
    lastMaintenance: {
      ok: true,
      checkedAt: new Date().toISOString(),
    },
  });
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = { command: 'status' };
  for (const arg of argv) {
    if (arg === '--install-safe') args.command = 'install-safe';
    if (arg === '--maintenance') args.command = 'maintenance';
    if (arg === '--status') args.command = 'status';
    if (arg.startsWith('--state-file=')) args.stateFile = arg.slice('--state-file='.length);
    if (arg.startsWith('--target=')) args.target = arg.slice('--target='.length);
  }
  return args;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseCliArgs(argv);
  let state;
  if (args.command === 'install-safe') {
    state = installSupportedEcosystem({ env, stateFile: args.stateFile, target: args.target, stdio: 'inherit' });
  } else if (args.command === 'maintenance') {
    state = runMaintenance({ env, stateFile: args.stateFile });
  } else {
    state = readEcosystemState(args.stateFile || getDefaultEcosystemStateFile(env)) || {
      target: args.target || env.ASSISTANT_NAME || 'self',
      ...detectInstalledEcosystem(env),
    };
  }
  console.log(buildEcosystemStatusReply(state));
  return state;
}

if (require.main === module) {
  main();
}

module.exports = {
  buildEcosystemStatusReply,
  buildInstallShellScript,
  createEcosystemInstallPlan,
  detectInstalledEcosystem,
  installSupportedEcosystem,
  listEcosystemPlugins,
  main,
  parseCliArgs,
  readEcosystemState,
  runMaintenance,
  writeEcosystemState,
};
