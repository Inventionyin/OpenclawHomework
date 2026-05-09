const {
  createTask,
} = require('./background-task-store');

const LOOP_STEPS = [
  {
    id: 'idea',
    label: 'Research',
    description: '明确目标和假设，说明为什么值得做。',
  },
  {
    id: 'plan',
    label: 'Plan',
    description: '拆成可执行步骤，优先复用现有工具。',
  },
  {
    id: 'execute',
    label: 'Development',
    description: '执行 UI 自动化、热点抓取、token 工厂或邮箱动作。',
  },
  {
    id: 'evaluate',
    label: 'Evaluation',
    description: '读取 Allure、ledger、task-center 或抓取结果。',
  },
  {
    id: 'learn',
    label: 'Learning',
    description: '沉淀失败原因、有效经验和可复用资产。',
  },
  {
    id: 'next',
    label: 'Next',
    description: '生成下一轮动作，进入可恢复任务中枢。',
  },
];

function normalizeGoal(goal = '') {
  return String(goal || '').replace(/^文员[，,\s:]*/i, '').trim() || '优化当前 OpenClaw/Hermes 项目';
}

function inferFocus(goal = '') {
  const text = String(goal || '').toLowerCase();
  if (/(ui|自动化|allure|playwright|cypress|测试)/i.test(text)) return 'ui-automation';
  if (/(热点|热榜|新闻|github|开源|福利|额度|token)/i.test(text)) return 'trend-radar';
  if (/(邮箱|邮件|clawemail|审批|日报)/i.test(text)) return 'mail-office';
  if (/(服务器|openclaw|hermes|运维|重启|修复|内存|硬盘)/i.test(text)) return 'ops';
  return 'agent-workflow';
}

function buildHypothesis(goal, focus) {
  const normalizedGoal = normalizeGoal(goal);
  const map = {
    'ui-automation': `如果把 ${normalizedGoal} 拆成“用例生成 -> 执行 -> Allure 复盘 -> 下一轮补用例”，UI 自动化会更稳定。`,
    'trend-radar': `如果把 ${normalizedGoal} 做成“抓取正文 -> 过滤过期 -> 中文总结 -> 入库复盘”，热点雷达会更准确。`,
    'mail-office': `如果把 ${normalizedGoal} 放入“收信 -> 审批 -> 发信 -> 归档 -> 日报”闭环，文员 Agent 会更像真实助理。`,
    ops: `如果把 ${normalizedGoal} 接入“状态检查 -> 安全操作 -> 验证 -> 复盘”，两台服务器互修会更可靠。`,
    'agent-workflow': `如果把 ${normalizedGoal} 固定成 Research -> Development -> Evaluation -> Learning 循环，Agent 会从一次性聊天变成可持续改进系统。`,
  };
  return map[focus] || map['agent-workflow'];
}

function buildExecutionPlan(goal, focus) {
  const base = [
    '确认目标和成功指标',
    '列出可复用的现有脚本、账本和任务中枢数据',
    '先 dry-run，再执行真实动作',
    '把结果写入 task-center、ledger 或 protocol-assets',
    '生成复盘和下一轮动作',
  ];
  const focusPlan = {
    'ui-automation': ['触发 smoke/contract UI 自动化', '读取 GitHub Actions/Allure 链接', '把失败页面转成补测清单'],
    'trend-radar': ['抓取候选网页正文', '过滤过期福利和重复链接', '保存高价值线索到 protocol-assets'],
    'mail-office': ['读取邮箱工作台', '生成待审批动作', '发送日报或归档邮件'],
    ops: ['读取两台服务器状态', '只执行白名单运维动作', '重启/修复后验证 health'],
  };
  return [...(focusPlan[focus] || []), ...base];
}

function buildMetrics(focus) {
  const common = [
    { id: 'completion', label: '是否完成闭环', target: '产生 result、learning、nextAction' },
    { id: 'traceability', label: '是否可追踪', target: '写入 task-center 或 ledger' },
  ];
  const map = {
    'ui-automation': [
      { id: 'pass-rate', label: 'UI 通过率', target: 'smoke/contract 结果可读' },
      { id: 'failure-replay', label: '失败可复现', target: '失败有截图、日志或 Allure 链接' },
    ],
    'trend-radar': [
      { id: 'freshness', label: '线索新鲜度', target: '过滤过期活动' },
      { id: 'value-density', label: '高价值比例', target: '保留能学习/能薅额度/能测试的条目' },
    ],
    'mail-office': [
      { id: 'approval-closed-loop', label: '审批闭环', target: '待审批、发送、归档可追踪' },
    ],
    ops: [
      { id: 'health-after-action', label: '操作后健康', target: 'systemd active 且 /health 正常' },
    ],
  };
  return [...(map[focus] || []), ...common];
}

function buildNextActions(goal, focus) {
  const map = {
    'ui-automation': ['跑一轮 smoke UI 自动化', '把失败报告转成补测清单', '用 Dify 测试助手复盘失败原因'],
    'trend-radar': ['抓取 3 个热点网页正文', '过滤过期福利活动', '把高价值线索保存到 protocol-assets'],
    'mail-office': ['查看邮箱工作台', '列出待审批邮件', '发送今天日报到邮箱'],
    ops: ['查看两台服务器状态', '只对异常服务执行修复', '把修复结果写入日报'],
    'agent-workflow': ['选择一个目标跑 RD-Agent-lite 循环', '执行一轮并写入 task-center', '明天复盘结果继续迭代'],
  };
  return map[focus] || map['agent-workflow'];
}

function buildResearchDevLoopPlan(goal = '') {
  const normalizedGoal = normalizeGoal(goal);
  const focus = inferFocus(normalizedGoal);
  return {
    goal: normalizedGoal,
    focus,
    hypothesis: buildHypothesis(normalizedGoal, focus),
    loop: LOOP_STEPS.map((step, index) => ({
      ...step,
      order: index + 1,
    })),
    executionPlan: buildExecutionPlan(normalizedGoal, focus),
    metrics: buildMetrics(focus),
    learningQuestions: [
      '这轮结果是否真的改善目标？',
      '失败是模型、数据源、执行器还是权限问题？',
      '哪些产物可以沉淀成测试资产或技能步骤？',
    ],
    nextActions: buildNextActions(normalizedGoal, focus),
  };
}

async function runResearchDevLoop(input = {}) {
  const env = input.env || process.env;
  const now = input.now || new Date();
  const plan = buildResearchDevLoopPlan(input.goal || input.text || '');
  const taskId = input.taskId || `rd-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const task = createTask({
    id: taskId,
    type: 'research-dev-loop',
    status: input.status || 'queued',
    now: now.toISOString(),
    summary: {
      goal: plan.goal,
      focus: plan.focus,
      hypothesis: plan.hypothesis,
      loop: plan.loop,
      metrics: plan.metrics,
      nextActions: plan.nextActions,
    },
    files: input.files || {},
  }, env);
  return {
    status: 'planned',
    task,
    plan,
  };
}

function formatResearchDevLoopReply(result = {}) {
  const plan = result.plan || buildResearchDevLoopPlan(result.goal || '');
  const task = result.task || {};
  const lines = [
    'RD-Agent-lite 研发循环已建立。',
    task.id ? `- 任务：${task.id}` : null,
    `- 目标：${plan.goal}`,
    `- 假设：${plan.hypothesis}`,
    '',
    '循环步骤：',
    ...plan.loop.map((step) => `${step.order}. ${step.label}：${step.description}`),
    '',
    '衡量指标：',
    ...plan.metrics.map((metric) => `- ${metric.label}：${metric.target}`),
    '',
    '下一步：',
    ...plan.nextActions.map((action) => `- ${action}`),
  ].filter(Boolean);
  return lines.join('\n');
}

module.exports = {
  LOOP_STEPS,
  buildResearchDevLoopPlan,
  formatResearchDevLoopReply,
  inferFocus,
  runResearchDevLoop,
};
