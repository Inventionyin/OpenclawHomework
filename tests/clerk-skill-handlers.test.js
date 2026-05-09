const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClerkSkillReply,
  isClerkSkillAction,
} = require('../scripts/agents/clerk/skill-handlers');

test('isClerkSkillAction identifies extracted clerk skill actions', () => {
  assert.equal(isClerkSkillAction('research-dev-loop'), true);
  assert.equal(isClerkSkillAction('web-content-fetch'), true);
  assert.equal(isClerkSkillAction('skill-flow'), true);
  assert.equal(isClerkSkillAction('trend-intel'), true);
  assert.equal(isClerkSkillAction('token-factory-status'), true);
  assert.equal(isClerkSkillAction('daily-email'), true);
  assert.equal(isClerkSkillAction('mailbox-approval-action'), false);
});

test('buildClerkSkillReply delegates workflow enhancement runners', async () => {
  let researchRequest;
  const researchReply = await buildClerkSkillReply({
    action: 'research-dev-loop',
    goal: '优化热点雷达',
  }, {
    runResearchDevLoop: async (request) => {
      researchRequest = request;
      return {
        task: { id: 'rd-1' },
        plan: {
          goal: request.goal,
          hypothesis: '热点雷达需要闭环。',
          loop: [{ order: 1, label: 'Research', description: '研究热点源' }],
          metrics: [{ label: '可复盘', target: '写入任务中枢' }],
          nextActions: ['检查 trend-intel'],
        },
      };
    },
  });

  assert.equal(researchRequest.goal, '优化热点雷达');
  assert.match(researchReply, /RD-Agent-lite/);
  assert.match(researchReply, /rd-1/);

  let fetchRequest;
  const fetchReply = await buildClerkSkillReply({
    action: 'web-content-fetch',
    url: 'https://github.com/microsoft/RD-Agent',
  }, {
    runWebContentFetch: async (request) => {
      fetchRequest = request;
      return {
        allowed: true,
        url: request.url,
        status: 200,
        title: 'microsoft/RD-Agent',
        summary: 'Research and development agent.',
        links: [],
      };
    },
  });

  assert.equal(fetchRequest.url, 'https://github.com/microsoft/RD-Agent');
  assert.match(fetchReply, /网页正文抽取完成/);
  assert.match(fetchReply, /microsoft\/RD-Agent/);
});

test('buildClerkSkillReply handles token factory status and daily email', async () => {
  const statusReply = await buildClerkSkillReply({
    action: 'token-factory-status',
  }, {
    summarizeTasks: () => ({
      counts: {
        total: 3,
        today: 2,
        running: 1,
        failed: 0,
        recoverable: 1,
      },
      latest: {
        id: 'tf-1',
        status: 'running',
      },
    }),
  });

  assert.match(statusReply, /token-factory 任务中枢/);
  assert.match(statusReply, /tf-1/);

  const emailReply = await buildClerkSkillReply({
    action: 'daily-email',
    recipientEmail: '1693457391@qq.com',
  }, {
    env: {},
    resolveMailboxAction: () => ({ mailbox: 'daily@claw.163.com' }),
  });

  assert.match(emailReply, /文员日报邮件/);
  assert.match(emailReply, /1693457391@qq.com/);
  assert.match(emailReply, /daily@claw.163.com/);
});
