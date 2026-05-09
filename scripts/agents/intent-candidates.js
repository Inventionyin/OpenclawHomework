function normalizeIntentText(text = '') {
  return String(text || '')
    .trim()
    .replace(/^@\S+\s*/, '')
    .replace(/\s+/g, ' ');
}

function hasDangerousIntentSignal(text = '') {
  const value = String(text || '');
  return /(restart|repair|cleanup|exec|重启|修复|修一下|维修|清理)/i.test(value)
    || /执行\s+(?:df|du|ls|rm|cat|tail|journalctl|systemctl|ps|top|free|curl|wget|git|npm|node|python|powershell|bash|cmd|shell|命令)\b/i.test(value);
}

function buildCandidate({
  agent,
  action,
  requiresAuth = true,
  evidence = [],
  score = 0,
  safety = 'safe',
  missing = [],
  params = {},
}) {
  return { agent, action, requiresAuth, evidence, score, safety, missing, params };
}

function collectIntentCandidates(text = '') {
  const normalized = normalizeIntentText(text);
  const candidates = [];
  const lower = normalized.toLowerCase();

  if (!/(不要|别|不用|无需)/.test(normalized) && /(跑|运行|执行).{0,16}(测试|ui|自动化)/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'ui-test-agent',
      action: 'run',
      evidence: ['test-run'],
      score: 0.75,
    }));
  }

  if (/(token|额度|用量|消耗)/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'clerk-agent',
      action: 'token-summary',
      evidence: ['token'],
      score: 0.88,
      params: /(今天|今日)/.test(normalized) ? { dayRange: 'today' } : {},
    }));
  }

  if (/(待办|没做|未完成|失败任务|todo)/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'clerk-agent',
      action: 'todo-summary',
      evidence: ['todo'],
      score: 0.84,
    }));
  }

  if (/(一屏看懂|总览|command center|command-center|主控脑)/i.test(lower)) {
    candidates.push(buildCandidate({
      agent: 'clerk-agent',
      action: 'command-center',
      evidence: ['command-center'],
      score: 0.85,
    }));
  }

  if (/(开源|热点|热榜|趋势|github)/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'clerk-agent',
      action: 'trend-intel',
      evidence: ['trend'],
      score: 0.83,
    }));
  }

  if (/(日报|daily).{0,8}(邮箱|email|发送|发到|发给)|发送.{0,6}(日报|daily)/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'clerk-agent',
      action: 'daily-email',
      evidence: ['daily-email'],
      score: 0.86,
    }));
  }

  if (/(dify|测试用例|缺陷分析|回归测试)/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'qa-agent',
      action: 'dify-testing-assistant',
      evidence: ['dify'],
      score: 0.82,
      params: { query: normalized },
    }));
  }

  if (/(ops|运维|服务器).{0,8}(资源|总结|状态)|内存|硬盘|cpu/i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'ops-agent',
      action: 'load-summary',
      evidence: ['ops-resource'],
      score: 0.8,
    }));
  }

  if (/(浏览器|页面|cdp|协议|抓包|接口)/i.test(normalized) && !/https?:\/\//i.test(normalized)) {
    candidates.push(buildCandidate({
      agent: 'browser-agent',
      action: 'browser-clarify',
      evidence: ['browser'],
      score: 0.7,
      safety: 'clarify',
      missing: ['targetUrl'],
    }));
  }

  if (hasDangerousIntentSignal(normalized)) {
    candidates.push(buildCandidate({
      agent: 'ops-agent',
      action: /(修复|repair)/i.test(normalized) ? 'peer-repair' : 'restart',
      evidence: ['dangerous-op'],
      score: 0.93,
      safety: 'blocked',
      missing: ['confirmation'],
    }));
  }

  return candidates.sort((a, b) => b.score - a.score);
}

module.exports = {
  collectIntentCandidates,
  normalizeIntentText,
  hasDangerousIntentSignal,
};
