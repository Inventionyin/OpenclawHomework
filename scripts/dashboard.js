const { execFile: execFileCallback } = require('node:child_process');
const {
  buildClerkCommandCenterState,
} = require('./agents/clerk-command-center');

function execFilePromise(command, args = [], options = {}, execFileImpl = execFileCallback) {
  if (execFileImpl.length <= 2) {
    return execFileImpl(command, args, options);
  }

  return new Promise((resolve) => {
    execFileImpl(command, args, {
      timeout: 5000,
      windowsHide: true,
      ...options,
    }, (error, stdout) => {
      if (error) {
        resolve('');
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function trimList(value, limit) {
  return toArray(value).slice(0, limit);
}

function getAssistantName(env = process.env) {
  return env.ASSISTANT_NAME
    || env.BOT_NAME
    || (env.HERMES_FEISHU_APP_ID ? 'Hermes' : 'OpenClaw');
}

async function readGitCommit(env = process.env, options = {}) {
  const execFile = options.execFile || execFilePromise;
  const projectDir = env.LOCAL_PROJECT_DIR || process.cwd();
  return execFile('git', ['-C', projectDir, 'rev-parse', '--short', 'HEAD']);
}

function summarizeDashboardState(rawState = {}, env = process.env, options = {}) {
  const tasks = rawState.tasks || {};
  const usage = rawState.usage || {};
  const mail = rawState.mail || {};
  const pipeline = rawState.pipeline || {};
  const snapshot = rawState.snapshot || {};
  const proactiveThinker = rawState.proactiveThinker || {};

  return {
    ok: true,
    generatedAt: (options.now || new Date()).toISOString(),
    assistant: getAssistantName(env),
    health: { ok: true },
    service: {
      port: Number(env.PORT || 8788),
      asyncWebhook: String(env.FEISHU_WEBHOOK_ASYNC || 'true').toLowerCase() !== 'false',
      streaming: String(env.FEISHU_STREAMING_ENABLED || env.FEISHU_CHAT_STREAMING_ENABLED || 'false').toLowerCase() === 'true',
      commit: rawState.commit || '',
    },
    plan: {
      todaySummaryText: rawState.plan?.todaySummaryText || tasks.todaySummaryText || '',
      tomorrowPlan: trimList(rawState.plan?.tomorrowPlan || tasks.tomorrowPlanText, 5),
    },
    tasks: {
      counts: tasks.counts || {},
      byType: trimList(tasks.byType, 8),
      latest: tasks.latest || null,
      todayTasks: trimList(tasks.todayTasks, 8),
      recoverableTasks: trimList(tasks.recoverableTasks, 8),
      blockers: trimList(tasks.blockers, 6),
      quickCommands: trimList(tasks.quickCommands, 8),
    },
    pipeline: {
      status: pipeline.status || '',
      day: pipeline.day || '',
      completedStages: Number(pipeline.completedStages || 0),
      totalStages: Number(pipeline.totalStages || 0),
      failedStages: Number(pipeline.failedStages || 0),
      nextAction: pipeline.nextAction || '',
      failureDiagnosis: pipeline.failureDiagnosis || '',
      failedStageIds: trimList(pipeline.failedStageIds, 6),
    },
    usage: {
      totalTokens: Number(usage.totalTokens || 0),
      realTokens: Number(usage.realTokens || 0),
      estimatedTokens: Number(usage.estimatedTokens || 0),
      entries: trimList(usage.entries, 12),
    },
    mail: {
      todayCount: toArray(mail.todayEntries).length,
      totalCount: toArray(mail.entries).length,
      todayEntries: trimList(mail.todayEntries, 10),
      entries: trimList(mail.entries, 10),
    },
    snapshot: {
      latestRun: snapshot.latestRun || null,
      runCount: toArray(snapshot.runs).length,
    },
    proactiveThinker: {
      status: proactiveThinker.status || 'missing',
      summary: proactiveThinker.summary || '',
      generatedAt: proactiveThinker.generatedAt || '',
      pendingConfirmationCount: Number(proactiveThinker.pendingConfirmationCount || 0),
      reportPath: proactiveThinker.reportPath || '',
      topSignals: trimList(proactiveThinker.topSignals, 5),
    },
    warnings: trimList(rawState.warnings, 8),
  };
}

async function buildDashboardState(env = process.env, options = {}) {
  const rawState = options.dashboardState
    ? await options.dashboardState(env, options)
    : buildClerkCommandCenterState({ env, now: options.now || new Date() });
  const summary = summarizeDashboardState(rawState, env, options);
  summary.service.commit = summary.service.commit || await readGitCommit(env, options);
  return summary;
}

function renderJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function renderTaskRows(rows = []) {
  if (!rows.length) {
    return '<tr><td colspan="5" class="muted">暂无任务类型分布</td></tr>';
  }

  return rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.label || row.type || '未分类')}</td>
      <td>${formatNumber(row.today)}</td>
      <td>${formatNumber(row.running)}</td>
      <td>${formatNumber(row.failed)}</td>
      <td>${formatNumber(row.total)}</td>
    </tr>
  `).join('');
}

function renderList(items = [], formatter = (item) => item) {
  if (!items.length) {
    return '<li class="muted">暂无记录</li>';
  }
  return items.map((item) => `<li>${escapeHtml(formatter(item))}</li>`).join('');
}

function formatProactiveStatus(proactiveThinker = {}) {
  if (!proactiveThinker || proactiveThinker.status === 'missing') {
    return '暂无报告';
  }
  if (proactiveThinker.status === 'awaiting_confirmation') {
    return `待确认 ${formatNumber(proactiveThinker.pendingConfirmationCount)} 项`;
  }
  if (proactiveThinker.status === 'completed') {
    return '已完成';
  }
  return proactiveThinker.status || 'unknown';
}

function buildDashboardHtml(state = {}) {
  const counts = state.tasks?.counts || {};
  const latest = state.tasks?.latest || {};
  const latestRun = state.snapshot?.latestRun || {};
  const pipeline = state.pipeline || {};
  const proactiveThinker = state.proactiveThinker || {};
  const generatedAt = state.generatedAt ? new Date(state.generatedAt).toLocaleString('zh-CN') : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>OpenClaw/Hermes 控制台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #171a1f;
      --muted: #69707d;
      --line: #dde2ea;
      --accent: #0f766e;
      --warn: #b45309;
      --bad: #b91c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      letter-spacing: 0;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .wrap {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }
    .topbar {
      min-height: 72px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
      font-weight: 750;
    }
    .subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
    }
    main {
      padding: 22px 0 36px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      background: #fff;
      font-size: 13px;
      white-space: nowrap;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--accent);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
    }
    .metric-label {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }
    .metric-value {
      font-size: 26px;
      line-height: 1.1;
      font-weight: 760;
    }
    .wide {
      grid-column: span 2;
    }
    .full {
      grid-column: 1 / -1;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 15px;
      line-height: 1.3;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 9px 8px;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-weight: 650;
    }
    ul {
      margin: 0;
      padding-left: 18px;
      font-size: 13px;
      line-height: 1.7;
    }
    .muted {
      color: var(--muted);
    }
    .tag {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      color: var(--muted);
      font-size: 12px;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    .bad { color: var(--bad); }
    .warn { color: var(--warn); }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media (max-width: 860px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 16px 0; }
      .grid { grid-template-columns: 1fr; }
      .wide { grid-column: auto; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <div>
        <h1>OpenClaw/Hermes 控制台</h1>
        <div class="subtitle">${escapeHtml(state.assistant || 'Agent')} · ${escapeHtml(generatedAt)} · commit ${escapeHtml(state.service?.commit || 'unknown')}</div>
      </div>
      <div class="status"><span class="dot"></span>Bridge healthy · <span class="mono">/api/dashboard</span></div>
    </div>
  </header>
  <main class="wrap">
    <section class="grid">
      <div class="panel"><div class="metric-label">今日任务</div><div class="metric-value">${formatNumber(counts.today)}</div></div>
      <div class="panel"><div class="metric-label">运行中</div><div class="metric-value">${formatNumber(counts.running)}</div></div>
      <div class="panel"><div class="metric-label">失败</div><div class="metric-value ${counts.failed ? 'bad' : ''}">${formatNumber(counts.failed)}</div></div>
      <div class="panel"><div class="metric-label">可恢复</div><div class="metric-value ${counts.recoverable ? 'warn' : ''}">${formatNumber(counts.recoverable)}</div></div>

      <div class="panel wide">
        <h2>任务中枢</h2>
        <table>
          <thead><tr><th>类型</th><th>今日</th><th>运行</th><th>失败</th><th>总数</th></tr></thead>
          <tbody>${renderTaskRows(state.tasks?.byType || [])}</tbody>
        </table>
      </div>

      <div class="panel wide">
        <h2>下一步</h2>
        <ul>${renderList(state.plan?.tomorrowPlan || state.tasks?.quickCommands || [])}</ul>
      </div>

      <div class="panel wide">
        <h2>流水线</h2>
        <p class="muted">状态：${escapeHtml(pipeline.status || '暂无')} · ${formatNumber(pipeline.completedStages)}/${formatNumber(pipeline.totalStages)} 阶段完成 · 失败 ${formatNumber(pipeline.failedStages)}</p>
        <ul>${renderList([
    pipeline.failureDiagnosis,
    pipeline.nextAction,
    ...(pipeline.failedStageIds || []).map((id) => `失败阶段：${id}`),
  ].filter(Boolean))}</ul>
      </div>

      <div class="panel wide">
        <h2>模型账本</h2>
        <p class="muted">约 ${formatNumber(state.usage?.totalTokens)} tokens · 真实 ${formatNumber(state.usage?.realTokens)} · 估算 ${formatNumber(state.usage?.estimatedTokens)}</p>
        <ul>${renderList(state.usage?.entries || [], (entry) => `${entry.assistant || 'agent'} · ${entry.model || 'model'} · ${entry.totalTokens ?? entry.estimatedTotalTokens ?? 0} tokens`)}</ul>
      </div>

      <div class="panel wide">
        <h2>邮件流水</h2>
        <p class="muted">今日 ${formatNumber(state.mail?.todayCount)} 条 · 最近 ${formatNumber(state.mail?.totalCount)} 条</p>
        <ul>${renderList(state.mail?.todayEntries || [], (entry) => `${entry.action || 'mail'} · ${entry.subject || '无主题'}`)}</ul>
      </div>

      <div class="panel wide">
        <h2>最近 UI 自动化</h2>
        <p class="muted">${escapeHtml(latestRun.conclusion || latest.status || '暂无记录')}</p>
        ${latestRun.runUrl ? `<a href="${escapeHtml(latestRun.runUrl)}" target="_blank" rel="noreferrer">打开 GitHub Run</a>` : '<span class="muted">暂无链接</span>'}
      </div>

      <div class="panel wide">
        <h2>主动思考器</h2>
        <p class="muted">状态：${escapeHtml(formatProactiveStatus(proactiveThinker))}</p>
        <p>${escapeHtml(proactiveThinker.summary || '暂无主动思考摘要')}</p>
        ${proactiveThinker.reportPath ? `<p class="mono muted">${escapeHtml(proactiveThinker.reportPath)}</p>` : ''}
        <ul>${renderList(proactiveThinker.topSignals || [], (item) => `${item.title || '未命名线索'}${item.source ? ` · ${item.source}` : ''}`)}</ul>
      </div>

      <div class="panel full">
        <h2>运行提示</h2>
        <span class="tag">飞书入口保留</span>
        <span class="tag">Web 看板只读</span>
        <span class="tag">30 秒自动刷新</span>
        <span class="tag">慢回复时先看这里</span>
        <ul>${renderList(state.warnings || [])}</ul>
      </div>
    </section>
  </main>
  <script type="application/json" id="dashboard-state">${renderJsonForScript(state)}</script>
</body>
</html>`;
}

module.exports = {
  buildDashboardHtml,
  buildDashboardState,
  escapeHtml,
  summarizeDashboardState,
};
