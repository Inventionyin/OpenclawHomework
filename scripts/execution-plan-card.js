'use strict';

const {
  normalizeSkillExecutionPlan,
} = require('./skill-runtime');
const {
  buildBrowserRuntimeDryRun,
  normalizeBrowserRuntimeAction,
} = require('./browser-runtime');

const BROWSER_ACTIONS = new Set([
  'browser-observe',
  'browser-act',
  'browser-extract',
  'browser-dry-run',
  'observe',
  'act',
  'extract',
]);

function buildExecutionPlanCard(route = {}, options = {}) {
  const safeRoute = route && typeof route === 'object' ? route : {};
  const normalizeSkill = options.normalizeSkillExecutionPlan || normalizeSkillExecutionPlan;
  const buildBrowserPlan = options.buildBrowserRuntimeDryRun || buildBrowserRuntimeDryRun;

  let text;
  if (isBrowserRoute(safeRoute)) {
    text = buildBrowserCard(buildBrowserPlan(normalizeBrowserRouteForPlan(safeRoute)));
  } else {
    const skillPlan = normalizeSkill(safeRoute);
    text = skillPlan && skillPlan.status !== 'unsupported'
      ? buildSkillCard(skillPlan, safeRoute)
      : buildUnknownRouteCard(safeRoute);
  }

  return redactSecrets(text);
}

function normalizeBrowserRouteForPlan(route = {}) {
  if (String(route.action || '').trim().toLowerCase() !== 'browser-dry-run') {
    return route;
  }
  return {
    ...route,
    action: 'browser-observe',
    operation: 'observe',
    instruction: route.instruction || route.rawText || route.text || '',
  };
}

function isBrowserRoute(route = {}) {
  const action = String(route.action || route.operation || '').trim().toLowerCase();
  return BROWSER_ACTIONS.has(action);
}

function buildSkillCard(plan = {}, route = {}) {
  return [
    '执行计划卡',
    `目标能力：${formatValue(plan.name || plan.skillId || '未命名 skill')}`,
    `路由：${formatValue(route.action || plan.action || route.skillId || plan.skillId)}`,
    `Skill：${formatValue(plan.skillId)}`,
    `风险：${formatValue(plan.riskLevel)}`,
    `执行方式：${formatSkillExecutionMode(plan)}`,
    `下一步：${formatSkillNextStep(plan.nextStep)}`,
  ].join('\n');
}

function buildBrowserCard(result = {}) {
  const plan = result.plan || {};
  const steps = Array.isArray(result.steps) ? result.steps : [];
  const lines = [
    '执行计划卡｜Browser Runtime',
    `操作：${formatValue(result.operation || normalizeBrowserRuntimeAction())}`,
    `目标：${formatValue(plan.targetUrl || '未指定')}`,
    `状态：${result.blocked ? '已拦截' : '可计划'}`,
  ];

  if (result.blocked) {
    lines.push(`原因：${formatValue(result.reason || plan.safety?.reason || '未知原因')}`);
  }

  lines.push(`步骤摘要：${formatStepSummary(steps)}`);
  return lines.join('\n');
}

function buildUnknownRouteCard(route = {}) {
  return [
    '执行计划卡｜非注册能力',
    `路由：${formatValue(route.action || route.skillId || route.sourceSkillId || '未知')}`,
    '诊断：当前路由不是注册 skill，也不是 browser runtime 能力，请先选择已注册能力或补充可识别动作。',
  ].join('\n');
}

function formatSkillExecutionMode(plan = {}) {
  if (plan.status === 'executable' && plan.autoRun) return '自动执行';
  if (plan.status === 'needs_confirmation') return '需要确认';
  return '暂不可执行';
}

function formatSkillNextStep(nextStep = '') {
  const map = {
    execute_skill: '执行 skill',
    request_confirmation: '请求确认',
    choose_registered_skill: '选择注册能力',
  };
  return map[nextStep] || formatValue(nextStep || '等待补充信息');
}

function formatStepSummary(steps = []) {
  if (!steps.length) return '无可执行步骤';
  return steps
    .map((step, index) => {
      const type = formatValue(step.type || `step_${index + 1}`);
      const detail = formatValue(step.detail || '');
      return detail ? `${index + 1}. ${type}：${detail}` : `${index + 1}. ${type}`;
    })
    .join('；');
}

function formatValue(value) {
  const text = String(value ?? '').trim();
  return text || '未提供';
}

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/\b((?:api[_-]?)?key|token|password|passwd|secret|authorization)\b\s*[:=]\s*["']?[^&\s"',;]+/gi, '$1=[redacted]')
    .replace(/([?&](?:(?:api[_-]?)?key|token|password|passwd|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\bak_[A-Za-z0-9_-]{8,}\b/gi, '[redacted]')
    .replace(/\bck_live_[A-Za-z0-9_-]{8,}\b/gi, '[redacted]');
}

module.exports = {
  buildExecutionPlanCard,
};
