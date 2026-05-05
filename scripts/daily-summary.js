function normalizeUsageRows(entries = []) {
  const totals = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const assistant = String(entry.assistant || 'unknown');
    const current = totals.get(assistant) || {
      assistant,
      totalTokens: 0,
      estimatedTotalTokens: 0,
      modelElapsedMs: 0,
      calls: 0,
    };
    current.calls += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.estimatedTotalTokens += Number(entry.estimatedTotalTokens || 0);
    current.modelElapsedMs += Number(entry.modelElapsedMs || 0);
    totals.set(assistant, current);
  }
  return Array.from(totals.values()).sort((a, b) => b.totalTokens - a.totalTokens || b.estimatedTotalTokens - a.estimatedTotalTokens);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDailySummary(input = []) {
  const normalizedRuns = Array.isArray(input) ? input : (Array.isArray(input?.runs) ? input.runs : []);
  const usageRows = normalizeUsageRows(input?.usageEntries || []);
  const multiAgentSummary = input?.multiAgentSummary || null;
  const successCount = normalizedRuns.filter((run) => run?.conclusion === 'success').length;
  const failureCount = normalizedRuns.filter((run) => run?.conclusion === 'failure').length;
  const latestRun = normalizedRuns[normalizedRuns.length - 1] || null;
  const latestArtifactsUrl = latestRun?.artifactsUrl || '';
  const latestRunLabel = latestRun
    ? [latestRun.targetRef, latestRun.runMode].filter(Boolean).join(' / ')
    : '';
  const usageLines = usageRows.map((row) => {
    const tokenText = row.totalTokens
      ? `${row.totalTokens} tokens`
      : `字符估算约 ${row.estimatedTotalTokens} tokens`;
    const avgMs = row.calls ? Math.round(row.modelElapsedMs / row.calls) : 0;
    return `${row.assistant}：${tokenText}，平均耗时 ${avgMs}ms`;
  });

  const text = [
    `今日成功 ${successCount}`,
    `今日失败 ${failureCount}`,
    latestRunLabel ? `最近一次任务：${latestRunLabel}` : null,
    latestRun?.runUrl ? `最近一次任务：${latestRun.runUrl}` : '最近一次任务：无',
    latestArtifactsUrl ? `最近一次产物：${latestArtifactsUrl}` : null,
    usageLines.length ? '模型账本：' : null,
    ...usageLines.map((line) => `- ${line}`),
    multiAgentSummary
      ? `多 Agent 训练场：${multiAgentSummary.totalItems || 0} 个样本，失败 ${multiAgentSummary.failedJobs || 0}，赢家：${multiAgentSummary.winner || '平手'}`
      : null,
    multiAgentSummary?.totalTokens ? `多 Agent token：${multiAgentSummary.totalTokens}` : null,
  ].join('\n');

  const html = [
    '<div class="daily-report-board">',
    '<style>',
    '.daily-report-board{font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#172033;background:#f6f8fc;padding:16px;border:1px solid #dde4f0;border-radius:8px}',
    '.daily-report-board h2{margin:0 0 12px;font-size:18px}',
    '.daily-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
    '.daily-card{background:#fff;border:1px solid #d8e1ee;border-radius:8px;padding:10px 12px}',
    '.daily-label{font-size:12px;color:#63708a;margin-bottom:4px}',
    '.daily-value{font-size:16px;font-weight:700;color:#152033;word-break:break-word}',
    '.daily-section{margin-top:12px;background:#fff;border:1px solid #d8e1ee;border-radius:8px;padding:10px 12px}',
    '.daily-section ul{margin:0;padding-left:18px}',
    '.daily-section li{margin:4px 0}',
    '@media (max-width: 720px){.daily-grid{grid-template-columns:1fr}}',
    '</style>',
    '<h2>日报看板</h2>',
    '<div class="daily-grid">',
    `<div class="daily-card"><div class="daily-label">今日成功</div><div class="daily-value">${esc(successCount)}</div></div>`,
    `<div class="daily-card"><div class="daily-label">今日失败</div><div class="daily-value">${esc(failureCount)}</div></div>`,
    `<div class="daily-card"><div class="daily-label">最近任务</div><div class="daily-value">${esc(latestRunLabel || '无')}</div></div>`,
    '</div>',
    '<div class="daily-section">',
    '<strong>UI 自动化</strong>',
    '<ul>',
    latestRun?.runUrl ? `<li>最近一次任务：<a href="${esc(latestRun.runUrl)}">${esc(latestRun.runUrl)}</a></li>` : '<li>最近一次任务：无</li>',
    latestArtifactsUrl ? `<li>最近一次产物：<a href="${esc(latestArtifactsUrl)}">${esc(latestArtifactsUrl)}</a></li>` : '',
    '</ul>',
    '</div>',
    usageLines.length ? [
      '<div class="daily-section">',
      '<strong>模型账本</strong>',
      '<ul>',
      ...usageLines.map((line) => `<li>${esc(line)}</li>`),
      '</ul>',
      '</div>',
    ].join('\n') : '',
    multiAgentSummary ? [
      '<div class="daily-section">',
      '<strong>Multi-Agent Lab</strong>',
      '<ul>',
      `<li>样本数：${esc(multiAgentSummary.totalItems || 0)}</li>`,
      `<li>失败样本：${esc(multiAgentSummary.failedJobs || 0)}</li>`,
      `<li>赢家：${esc(multiAgentSummary.winner || '平手')}</li>`,
      `<li>总 token：${esc(multiAgentSummary.totalTokens || 0)}</li>`,
      '</ul>',
      '</div>',
    ].join('\n') : '',
    '</div>',
  ].join('\n');

  return {
    subject: '自动化测试日报',
    text,
    html,
  };
}

module.exports = {
  buildDailySummary,
};
