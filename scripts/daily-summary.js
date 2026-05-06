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

function formatReportDate(input) {
  if (input) {
    return String(input);
  }
  return '今日';
}

function formatRecipient(input) {
  return String(input || '同学');
}

function section(title, body) {
  return [
    '<div class="daily-section">',
    `<div class="daily-section-title">${esc(title)}</div>`,
    body,
    '</div>',
  ].join('\n');
}

function buildDailySummary(input = []) {
  const normalizedRuns = Array.isArray(input) ? input : (Array.isArray(input?.runs) ? input.runs : []);
  const usageRows = normalizeUsageRows(input?.usageEntries || []);
  const multiAgentSummary = input?.multiAgentSummary || null;
  const reportDate = formatReportDate(input?.reportDate || input?.date);
  const recipientName = formatRecipient(input?.recipientName || input?.recipientEmail || input?.recipient || input?.to);
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
  const aiSummary = input?.aiSummary || [
    `今日 UI 自动化成功 ${successCount} 次，失败 ${failureCount} 次。`,
    latestRunLabel ? `最近任务为 ${latestRunLabel}。` : '暂无最近任务记录。',
    usageRows.length ? `模型账本记录 ${usageRows.length} 个助手。` : '模型账本暂无记录。',
    multiAgentSummary ? `多 Agent 当前赢家：${multiAgentSummary.winner || '平手'}。` : '多 Agent 区域暂无新数据。',
  ].join('');
  const latestRunText = latestRun?.runUrl ? latestRun.runUrl : '无';

  const text = [
    `日期：${reportDate}`,
    `收件人：${recipientName}`,
    `AI 总结：${aiSummary}`,
    `今日成功 ${successCount}`,
    `今日失败 ${failureCount}`,
    latestRunLabel ? `最近一次任务：${latestRunLabel}` : null,
    `最近一次任务：${latestRunText}`,
    latestArtifactsUrl ? `最近一次产物：${latestArtifactsUrl}` : null,
    usageLines.length ? '模型账本：' : null,
    ...usageLines.map((line) => `- ${line}`),
    multiAgentSummary
      ? `多 Agent 训练场：${multiAgentSummary.totalItems || 0} 个样本，失败 ${multiAgentSummary.failedJobs || 0}，赢家：${multiAgentSummary.winner || '平手'}`
      : null,
    multiAgentSummary?.totalTokens ? `多 Agent token：${multiAgentSummary.totalTokens}` : null,
  ].join('\n');

  const uiAutomationItems = [
    latestRunLabel ? `<li><span>最近任务</span><strong>${esc(latestRunLabel)}</strong></li>` : '<li><span>最近任务</span><strong>无</strong></li>',
    latestRun?.runUrl ? `<li><span>任务链接</span><a href="${esc(latestRun.runUrl)}">${esc(latestRun.runUrl)}</a></li>` : '<li><span>任务链接</span><strong>无</strong></li>',
    latestArtifactsUrl ? `<li><span>产物链接</span><a href="${esc(latestArtifactsUrl)}">${esc(latestArtifactsUrl)}</a></li>` : '',
  ].filter(Boolean).join('\n');
  const usageBody = usageLines.length
    ? `<ul class="daily-list">${usageLines.map((line) => `<li>${esc(line)}</li>`).join('\n')}</ul>`
    : '<p class="daily-empty">暂无模型账本记录。</p>';
  const multiAgentBody = multiAgentSummary ? [
    '<div class="daily-split">',
    `<div><span>样本数</span><strong>${esc(multiAgentSummary.totalItems || 0)}</strong></div>`,
    `<div><span>失败样本</span><strong>${esc(multiAgentSummary.failedJobs || 0)}</strong></div>`,
    `<div><span>赢家</span><strong>${esc(multiAgentSummary.winner || '平手')}</strong></div>`,
    `<div><span>总 token</span><strong>${esc(multiAgentSummary.totalTokens || 0)}</strong></div>`,
    '</div>',
  ].join('\n') : '<p class="daily-empty">暂无多 Agent 训练场数据。</p>';

  const html = [
    '<div class="daily-report-email">',
    '<style>',
    '.daily-report-email{font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.55;color:#172033;background:#eef3f8;padding:22px;border:1px solid #d9e2ed;border-radius:8px}',
    '.daily-shell{max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dce5ef;border-radius:8px;overflow:hidden}',
    '.daily-hero{background:#1f2937;color:#ffffff;padding:22px 24px}',
    '.daily-kicker{font-size:12px;letter-spacing:0;text-transform:uppercase;color:#b8c4d4;margin-bottom:6px}',
    '.daily-hero h2{margin:0;font-size:24px;line-height:1.2;color:#ffffff}',
    '.daily-date{margin-top:8px;color:#d9e3ef}',
    '.daily-body{padding:22px 24px}',
    '.daily-greeting{margin:0 0 16px;color:#354258}',
    '.daily-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 14px}',
    '.daily-card{background:#f8fafc;border:1px solid #dce5ef;border-radius:8px;padding:12px 14px}',
    '.daily-label{font-size:12px;color:#627087;margin-bottom:4px}',
    '.daily-value{font-size:20px;font-weight:700;color:#152033;word-break:break-word}',
    '.daily-section{margin-top:14px;background:#ffffff;border:1px solid #dce5ef;border-radius:8px;padding:14px 16px}',
    '.daily-section-title{font-size:15px;font-weight:700;color:#152033;margin-bottom:8px}',
    '.daily-summary{margin:0;color:#354258}',
    '.daily-list{margin:0;padding-left:18px}',
    '.daily-list li{margin:5px 0}',
    '.daily-kv{list-style:none;margin:0;padding:0}',
    '.daily-kv li{display:flex;gap:12px;justify-content:space-between;border-top:1px solid #edf1f5;padding:8px 0;word-break:break-word}',
    '.daily-kv li:first-child{border-top:0;padding-top:0}',
    '.daily-kv span,.daily-split span{color:#64748b}',
    '.daily-kv strong,.daily-split strong{color:#172033}',
    '.daily-split{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}',
    '.daily-split div{background:#f8fafc;border:1px solid #e5edf5;border-radius:8px;padding:10px}',
    '.daily-split span{display:block;font-size:12px;margin-bottom:4px}',
    '.daily-split strong{display:block;font-size:16px;word-break:break-word}',
    '.daily-empty{margin:0;color:#64748b}',
    '.daily-footer{padding:12px 24px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e5edf5}',
    '@media (max-width: 720px){.daily-report-email{padding:12px}.daily-body,.daily-hero,.daily-footer{padding-left:16px;padding-right:16px}.daily-grid,.daily-split{grid-template-columns:1fr 1fr}.daily-kv li{display:block}}',
    '</style>',
    '<div class="daily-shell">',
    '<div class="daily-hero">',
    '<div class="daily-kicker">每日收发信报告</div>',
    '<h2>Agent日报</h2>',
    `<div class="daily-date">${esc(reportDate)}</div>`,
    '</div>',
    '<div class="daily-body">',
    `<p class="daily-greeting">${esc(recipientName)}，你好：</p>`,
    '<div class="daily-section-title">关键指标</div>',
    '<div class="daily-grid">',
    `<div class="daily-card"><div class="daily-label">今日成功</div><div class="daily-value">${esc(successCount)}</div></div>`,
    `<div class="daily-card"><div class="daily-label">今日失败</div><div class="daily-value">${esc(failureCount)}</div></div>`,
    `<div class="daily-card"><div class="daily-label">模型助手</div><div class="daily-value">${esc(usageRows.length)}</div></div>`,
    `<div class="daily-card"><div class="daily-label">多 Agent 样本</div><div class="daily-value">${esc(multiAgentSummary?.totalItems || 0)}</div></div>`,
    '</div>',
    section('AI 总结', `<p class="daily-summary">${esc(aiSummary)}</p>`),
    section('UI 自动化', `<ul class="daily-kv">${uiAutomationItems}</ul>`),
    section('模型账本', usageBody),
    section('多 Agent 区域 / Multi-Agent Lab', multiAgentBody),
    '</div>',
    '<div class="daily-footer">日报看板由 OpenClaw 自动生成。</div>',
    '</div>',
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
