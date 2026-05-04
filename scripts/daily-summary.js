function buildDailySummary(runs = []) {
  const normalizedRuns = Array.isArray(runs) ? runs : [];
  const successCount = normalizedRuns.filter((run) => run?.conclusion === 'success').length;
  const failureCount = normalizedRuns.filter((run) => run?.conclusion === 'failure').length;
  const latestRun = normalizedRuns[normalizedRuns.length - 1] || null;

  const text = [
    `今日成功 ${successCount}`,
    `今日失败 ${failureCount}`,
    latestRun?.runUrl ? `最近一次任务：${latestRun.runUrl}` : '最近一次任务：无',
  ].join('\n');

  const html = [
    '<h2>自动化测试日报</h2>',
    `<p>今日成功 ${successCount}</p>`,
    `<p>今日失败 ${failureCount}</p>`,
    latestRun?.runUrl ? `<p>最近一次任务：<a href="${latestRun.runUrl}">${latestRun.runUrl}</a></p>` : '<p>最近一次任务：无</p>',
  ].join('\n');

  return {
    subject: '[Daily Summary] 自动化测试日报',
    text,
    html,
  };
}

module.exports = {
  buildDailySummary,
};
