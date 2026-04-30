const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { execFile } = require('node:child_process');
const { sendFeishuTextMessage } = require('./feishu-bridge');

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseCliArgs(args = process.argv.slice(2), env = process.env) {
  return {
    service: readOption(args, '--service', env.WATCHDOG_SERVICE || 'openclaw-feishu-bridge'),
    healthUrl: readOption(args, '--health-url', env.WATCHDOG_HEALTH_URL || 'http://127.0.0.1:8788/health'),
    envFile: readOption(args, '--env-file', env.WATCHDOG_ENV_FILE || ''),
    accessLog: readOption(args, '--access-log', env.WATCHDOG_ACCESS_LOG || '/var/log/nginx/access.log'),
    stateFile: readOption(args, '--state-file', env.WATCHDOG_STATE_FILE || '/var/lib/openclaw-homework-watchdog/state.json'),
    windowMinutes: Number(readOption(args, '--window-minutes', env.WATCHDOG_WINDOW_MINUTES || '10')),
    postThreshold: Number(readOption(args, '--post-threshold', env.WATCHDOG_POST_THRESHOLD || '30')),
    non200Threshold: Number(readOption(args, '--non-200-threshold', env.WATCHDOG_NON_200_THRESHOLD || '1')),
    alertCooldownMinutes: Number(readOption(args, '--alert-cooldown-minutes', env.WATCHDOG_ALERT_COOLDOWN_MINUTES || '60')),
  };
}

function parseEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function parseNginxTimestamp(value) {
  const match = String(value).match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, day, monthName, year, hour, minute, second, sign, tzHour, tzMinute] = match;
  const month = MONTHS[monthName];
  if (month === undefined) {
    return null;
  }

  const utc = Date.UTC(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const offsetMs = (Number(tzHour) * 60 + Number(tzMinute)) * 60 * 1000;
  return new Date(sign === '+' ? utc - offsetMs : utc + offsetMs);
}

function parseNginxAccessLine(line) {
  const match = String(line).match(/\[([^\]]+)]\s+"(POST)\s+([^"\s]+)\s+HTTP\/[^"]+"\s+(\d{3})\s+/);
  if (!match) {
    return null;
  }

  return {
    timestamp: parseNginxTimestamp(match[1]),
    method: match[2],
    path: match[3],
    status: Number(match[4]),
  };
}

function scanFeishuAccessLog(content, options = {}) {
  const now = options.now || new Date();
  const windowMinutes = Number(options.windowMinutes || 10);
  const since = now.getTime() - windowMinutes * 60 * 1000;
  const entries = String(content || '')
    .split(/\r?\n/)
    .map(parseNginxAccessLine)
    .filter((entry) => entry
      && entry.timestamp
      && entry.timestamp.getTime() >= since
      && entry.path.startsWith('/webhook/feishu'));

  const statusCounts = {};
  for (const entry of entries) {
    statusCounts[entry.status] = (statusCounts[entry.status] || 0) + 1;
  }

  return {
    total: entries.length,
    non200: entries.filter((entry) => entry.status !== 200).length,
    statusCounts,
  };
}

function detectFeishuStorm(scan, options = {}) {
  const postThreshold = Number(options.postThreshold || 30);
  const non200Threshold = Number(options.non200Threshold || 1);
  const reasons = [];

  if (scan.total >= postThreshold) {
    reasons.push(`feishu_post_count_${scan.total}`);
  }
  if (scan.non200 >= non200Threshold) {
    reasons.push(`feishu_non_200_${scan.non200}`);
  }

  return {
    storm: reasons.length > 0,
    reasons,
  };
}

function readState(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(filePath, state) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function shouldAlert(state, key, now = new Date(), cooldownMinutes = 60) {
  const last = Date.parse(state.alerts?.[key] || '');
  if (Number.isFinite(last) && now.getTime() - last < cooldownMinutes * 60 * 1000) {
    return false;
  }
  return true;
}

function markAlert(state, key, now = new Date()) {
  return {
    ...state,
    alerts: {
      ...(state.alerts || {}),
      [key]: now.toISOString(),
    },
  };
}

function execFilePromise(command, args = []) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr || ''}`.trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

async function restartService(service) {
  await execFilePromise('systemctl', ['restart', service]);
}

async function checkHealth(healthUrl, fetchImpl = fetch) {
  const response = await fetchImpl(healthUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function buildAlertMessage(summary) {
  return [
    `服务器守护告警：${summary.service}`,
    `状态：${summary.status}`,
    `健康检查：${summary.healthOk ? '正常' : '异常'}`,
    `最近飞书 POST：${summary.feishu.total}`,
    `非 200 回调：${summary.feishu.non200}`,
    `状态码：${JSON.stringify(summary.feishu.statusCounts)}`,
    `原因：${summary.reasons.join(', ') || '无'}`,
  ].join('\n');
}

function buildAlertTarget(env) {
  const receiveId = env.WATCHDOG_FEISHU_RECEIVE_ID
    || env.FEISHU_NOTIFY_RECEIVE_ID
    || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID
    || String(env.HERMES_FEISHU_ALLOWED_USER_IDS || env.FEISHU_ALLOWED_USER_IDS || '').split(',')[0].trim();

  if (!receiveId) {
    return null;
  }

  return {
    receiveIdType: env.WATCHDOG_FEISHU_RECEIVE_ID_TYPE
      || env.FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || env.HERMES_FEISHU_NOTIFY_RECEIVE_ID_TYPE
      || 'open_id',
    receiveId,
  };
}

async function maybeSendAlert(summary, env, state, options = {}) {
  if (String(env.WATCHDOG_FEISHU_NOTIFY_ENABLED || '').toLowerCase() !== 'true') {
    return { sent: false, reason: 'disabled' };
  }

  const key = summary.reasons.join('|') || summary.status;
  if (!shouldAlert(state, key, options.now || new Date(), options.cooldownMinutes || 60)) {
    return { sent: false, reason: 'cooldown' };
  }

  const target = buildAlertTarget(env);
  if (!target) {
    return { sent: false, reason: 'missing_target' };
  }

  await sendFeishuTextMessage(env, {
    receiveIdType: target.receiveIdType,
    receiveId: target.receiveId,
    msgType: 'text',
    content: JSON.stringify({ text: buildAlertMessage(summary) }),
  });
  return { sent: true, key };
}

async function runWatchdog(config, env = process.env, options = {}) {
  const mergedEnv = { ...env, ...parseEnvFile(config.envFile) };
  const now = options.now || new Date();
  const state = readState(config.stateFile);
  const summary = {
    service: config.service,
    status: 'ok',
    healthOk: true,
    restarted: false,
    feishu: {
      total: 0,
      non200: 0,
      statusCounts: {},
    },
    reasons: [],
  };

  try {
    await checkHealth(config.healthUrl, options.fetchImpl || fetch);
  } catch (error) {
    summary.status = 'restarted';
    summary.healthOk = false;
    summary.restarted = true;
    summary.reasons.push('health_check_failed');
    await (options.restartService || restartService)(config.service);
  }

  if (existsSync(config.accessLog)) {
    summary.feishu = scanFeishuAccessLog(readFileSync(config.accessLog, 'utf8'), {
      now,
      windowMinutes: config.windowMinutes,
    });
    const storm = detectFeishuStorm(summary.feishu, {
      postThreshold: config.postThreshold,
      non200Threshold: config.non200Threshold,
    });
    if (storm.storm) {
      summary.status = summary.status === 'ok' ? 'warning' : summary.status;
      summary.reasons.push(...storm.reasons);
    }
  }

  if (summary.reasons.length > 0) {
    const alertResult = await maybeSendAlert(summary, mergedEnv, state, {
      now,
      cooldownMinutes: config.alertCooldownMinutes,
    }).catch((error) => ({ sent: false, reason: error.message }));
    summary.alert = alertResult;
    if (alertResult.sent) {
      writeState(config.stateFile, markAlert(state, alertResult.key, now));
    }
  }

  return summary;
}

async function main() {
  const config = parseCliArgs();
  const summary = await runWatchdog(config);
  console.log(JSON.stringify(summary));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildAlertMessage,
  detectFeishuStorm,
  markAlert,
  parseCliArgs,
  parseEnvFile,
  parseNginxAccessLine,
  parseNginxTimestamp,
  runWatchdog,
  scanFeishuAccessLog,
  shouldAlert,
};
