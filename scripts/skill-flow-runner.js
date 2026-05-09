const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { basename, join } = require('node:path');
const {
  createTask,
} = require('./background-task-store');

function slugFromFile(filePath = '') {
  return basename(String(filePath || ''), '.md')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
}

function normalizeLine(line = '') {
  return String(line || '').trim();
}

function parseBulletsUnder(lines = [], headingPattern) {
  const result = [];
  let active = false;
  for (const line of lines) {
    const trimmed = normalizeLine(line);
    if (!trimmed) continue;
    if (/^[#A-Z][^:]*:?$/i.test(trimmed) && active && !/^[-*]\s+/.test(trimmed)) {
      break;
    }
    if (headingPattern.test(trimmed)) {
      active = true;
      continue;
    }
    if (active) {
      const bullet = trimmed.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        result.push(bullet[1].trim());
      }
    }
  }
  return result;
}

function parsePurpose(lines = []) {
  for (const line of lines) {
    const match = normalizeLine(line).match(/^Purpose\s*:\s*(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

function parseSkillMarkdown(markdown = '', filePath = '') {
  const lines = String(markdown || '').split(/\r?\n/);
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : slugFromFile(filePath);
  const id = slugFromFile(filePath || title);
  const steps = parseBulletsUnder(lines, /^(Allowed user commands|Steps|Workflow|Runbook|执行步骤)\s*:?$/i)
    .map((text, index) => ({
      id: `step-${index + 1}`,
      order: index + 1,
      text,
      status: 'pending',
    }));
  const safety = parseBulletsUnder(lines, /^(Safety|安全|Guards?)\s*:?$/i);
  return {
    id,
    title,
    purpose: parsePurpose(lines),
    steps,
    safety,
    sourceFile: filePath,
  };
}

function getSkillsDir(options = {}) {
  return options.skillsDir || join(options.projectDir || process.cwd(), 'docs', 'skills');
}

function listSkillDefinitions(options = {}) {
  const skillsDir = getSkillsDir(options);
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const filePath = join(skillsDir, file);
      return parseSkillMarkdown(readFileSync(filePath, 'utf8'), file);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function findSkillDefinition(skillId = '', options = {}) {
  const normalized = String(skillId || '').toLowerCase().trim();
  const skills = listSkillDefinitions(options);
  if (!normalized) return skills[0] || null;
  return skills.find((skill) => skill.id === normalized || skill.title.toLowerCase().includes(normalized)) || null;
}

async function runSkillFlow(input = {}) {
  const env = input.env || process.env;
  const now = input.now || new Date();
  const skill = input.skill || findSkillDefinition(input.skillId || input.goal || '', input);
  if (!skill) {
    return {
      status: 'not-found',
      reason: 'Skill definition not found.',
      skills: listSkillDefinitions(input),
    };
  }
  const taskId = input.taskId || `skill-${skill.id}-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const task = createTask({
    id: taskId,
    type: 'skill-flow',
    status: 'queued',
    now: now.toISOString(),
    summary: {
      goal: input.goal || skill.purpose || skill.title,
      skillId: skill.id,
      title: skill.title,
      purpose: skill.purpose,
      steps: skill.steps,
      safety: skill.safety,
      nextStep: skill.steps[0] || null,
    },
    files: {
      skill: skill.sourceFile,
    },
  }, env);
  return {
    status: 'queued',
    task,
    skill,
  };
}

function buildSkillFlowReply(result = {}) {
  if (result.status === 'not-found') {
    const skills = Array.isArray(result.skills) ? result.skills : [];
    return [
      'skflow-lite 没找到匹配技能。',
      skills.length ? `可用技能：${skills.map((skill) => skill.id).join('、')}` : '当前 docs/skills 里没有技能文档。',
    ].join('\n');
  }
  const skill = result.skill || {};
  const task = result.task || {};
  const steps = Array.isArray(skill.steps) ? skill.steps : [];
  return [
    'skflow-lite 技能流程已进入任务中枢。',
    task.id ? `- 任务：${task.id}` : null,
    `- 技能：${skill.title || skill.id || 'unknown'}`,
    skill.purpose ? `- 用途：${skill.purpose}` : null,
    '',
    '可恢复步骤：',
    ...(steps.length ? steps.map((step) => `${step.order}. ${step.text}`) : ['1. 暂无显式步骤，先按技能文档人工拆解。']),
    '',
    '安全边界：',
    ...((skill.safety || []).length ? skill.safety.map((item) => `- ${item}`) : ['- 不执行任意 shell；只记录流程状态。']),
  ].filter(Boolean).join('\n');
}

module.exports = {
  buildSkillFlowReply,
  findSkillDefinition,
  listSkillDefinitions,
  parseSkillMarkdown,
  runSkillFlow,
};
