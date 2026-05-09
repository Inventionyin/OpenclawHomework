const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildSkillFlowReply,
  listSkillDefinitions,
  parseSkillMarkdown,
  runSkillFlow,
} = require('../scripts/skill-flow-runner');
const {
  readTask,
} = require('../scripts/background-task-store');

test('parseSkillMarkdown turns headings and bullets into resumable steps', () => {
  const skill = parseSkillMarkdown(`# UI Automation Skill

Purpose: trigger UI automation.

Allowed user commands:
- run smoke
- collect Allure

Safety:
- never expose token
`, 'ui-automation.md');

  assert.equal(skill.id, 'ui-automation');
  assert.equal(skill.title, 'UI Automation Skill');
  assert.equal(skill.purpose, 'trigger UI automation.');
  assert.deepEqual(skill.steps.map((step) => step.text), ['run smoke', 'collect Allure']);
  assert.deepEqual(skill.safety, ['never expose token']);
});

test('listSkillDefinitions reads markdown skills from a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-flow-list-'));
  try {
    writeFileSync(join(dir, 'demo.md'), '# Demo Skill\n\nPurpose: demo.\n\nAllowed user commands:\n- step one\n', 'utf8');
    const skills = listSkillDefinitions({ skillsDir: dir });

    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, 'demo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runSkillFlow records a queued skill-flow task', async () => {
  const taskDir = mkdtempSync(join(tmpdir(), 'skill-flow-task-'));
  const skillsDir = mkdtempSync(join(tmpdir(), 'skill-flow-skills-'));
  const env = { TOKEN_FACTORY_TASK_DIR: taskDir };
  try {
    writeFileSync(join(skillsDir, 'demo.md'), '# Demo Skill\n\nPurpose: demo.\n\nAllowed user commands:\n- step one\n- step two\n', 'utf8');
    const result = await runSkillFlow({
      skillId: 'demo',
      goal: '跑 demo 流程',
      skillsDir,
      env,
      now: new Date('2026-05-09T12:30:00.000Z'),
    });

    assert.equal(result.status, 'queued');
    assert.equal(result.task.type, 'skill-flow');
    assert.equal(result.task.summary.skillId, 'demo');
    assert.equal(result.task.summary.steps.length, 2);
    const saved = readTask(result.task.id, env);
    assert.equal(saved.summary.goal, '跑 demo 流程');
  } finally {
    rmSync(taskDir, { recursive: true, force: true });
    rmSync(skillsDir, { recursive: true, force: true });
  }
});

test('buildSkillFlowReply renders available skills and next step', () => {
  const reply = buildSkillFlowReply({
    skill: { id: 'demo', title: 'Demo Skill', purpose: 'demo', steps: [{ text: 'step one' }] },
    task: { id: 'skill-1' },
  });

  assert.match(reply, /skflow-lite/);
  assert.match(reply, /skill-1/);
  assert.match(reply, /step one/);
});
