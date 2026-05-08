const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildHotMonitorSnapshot,
  classifyHotItem,
  formatHotMonitorMessage,
  runHotMonitor,
  scoreHotItem,
  selectAlertItems,
  shouldAlertItem,
} = require('../scripts/hot-monitor');

test('classifyHotItem detects benefits and technical topics', () => {
  assert.deepEqual(
    classifyHotItem({
      title: 'Free AI credits for Playwright agent testing',
      summary: 'cloud credits and browser automation',
      link: 'https://example.com/free',
    }).sort(),
    ['benefit', 'tech'].sort(),
  );
});

test('scoreHotItem rewards star growth and benefit keywords', () => {
  const score = scoreHotItem(
    { title: 'agent testing toolkit free credits', stars: 1300, starsToday: 80 },
    { stars: 1200, firstSeenAt: '2026-05-08T00:00:00.000Z' },
  );

  assert.equal(score.deltaStars, 100);
  assert.equal(score.starsToday, 80);
  assert(score.score >= 200);
});

test('scoreHotItem does not treat first-seen total stars as short-window growth', () => {
  const score = scoreHotItem(
    { title: 'popular old agent toolkit', stars: 44150, starsToday: 0 },
    {},
  );

  assert.equal(score.deltaStars, 0);
  assert.equal(score.isNew, true);
});

test('selectAlertItems reports new benefit and GitHub star growth', () => {
  const now = new Date('2026-05-08T10:00:00.000Z');
  const previousState = {
    items: {
      'github:repo-a': {
        id: 'github:repo-a',
        stars: 1000,
        firstSeenAt: '2026-05-08T09:40:00.000Z',
      },
    },
    alerts: {},
  };
  const snapshot = buildHotMonitorSnapshot([
    {
      id: 'github:repo-a',
      title: 'repo-a playwright agent',
      source: 'GitHub Trending',
      kind: 'github-trending',
      link: 'https://github.com/a/repo-a',
      stars: 1050,
      starsToday: 70,
    },
    {
      id: 'benefit:cloud',
      title: 'Free cloud credits for AI agents',
      source: 'Product Hunt',
      kind: 'benefit-rss',
      link: 'https://example.com/cloud',
    },
  ], previousState, {}, { now });

  const alerts = selectAlertItems(snapshot, previousState, {
    HOT_MONITOR_MIN_DELTA_STARS: '30',
    HOT_MONITOR_MIN_STARS_TODAY: '50',
  });

  assert.equal(alerts.length, 2);
  assert(alerts.some((item) => item.title.includes('repo-a')));
  assert(alerts.some((item) => item.title.includes('Free cloud')));
});

test('selectAlertItems respects alert cooldown', () => {
  const now = new Date('2026-05-08T10:00:00.000Z');
  const previousState = {
    items: {},
    alerts: {
      'benefit:cloud': '2026-05-08T09:55:00.000Z',
    },
  };
  const snapshot = buildHotMonitorSnapshot([
    {
      id: 'benefit:cloud',
      title: 'Free cloud credits for AI agents',
      source: 'Product Hunt',
      kind: 'benefit-rss',
    },
  ], previousState, {}, { now });

  assert.equal(selectAlertItems(snapshot, previousState, {
    HOT_MONITOR_ALERT_COOLDOWN_MINUTES: '360',
  }).length, 0);
});

test('buildHotMonitorSnapshot preserves prior seen items outside the current fetch window', () => {
  const now = new Date('2026-05-08T10:10:00.000Z');
  const previousState = {
    items: {
      'github:repo-a': {
        id: 'github:repo-a',
        title: 'repo-a',
        stars: 1000,
        firstSeenAt: '2026-05-08T09:50:00.000Z',
        lastSeenAt: '2026-05-08T09:50:00.000Z',
      },
    },
    seen: {
      'github:repo-a': {
        firstSeenAt: '2026-05-08T09:50:00.000Z',
        lastSeenAt: '2026-05-08T09:50:00.000Z',
      },
    },
  };

  const snapshot = buildHotMonitorSnapshot([{
    id: 'github:repo-b',
    title: 'repo-b agent',
    source: 'GitHub Trending',
    kind: 'github-trending',
    stars: 2000,
  }], previousState, {}, { now });

  assert.equal(snapshot.seen['github:repo-a'].firstSeenAt, '2026-05-08T09:50:00.000Z');
  assert.equal(snapshot.items['github:repo-b'].deltaStars, 0);
});

test('shouldAlertItem requires score or specific benefit/star triggers', () => {
  assert.equal(shouldAlertItem({
    title: 'ordinary item',
    score: 10,
    categories: ['general'],
  }, { HOT_MONITOR_MIN_SCORE: '80' }), false);

  assert.equal(shouldAlertItem({
    title: 'Free token credits',
    score: 10,
    categories: ['benefit'],
    isNew: true,
  }, { HOT_MONITOR_MIN_SCORE: '80' }), true);
});

test('formatHotMonitorMessage separates benefits and technical hotspots', () => {
  const text = formatHotMonitorMessage([
    {
      title: 'Free GPU credits',
      categories: ['benefit'],
      alertReason: '疑似免费/额度/试用活动',
      score: 120,
      link: 'https://example.com/gpu',
    },
    {
      title: 'microsoft/playwright',
      categories: ['tech', 'github'],
      alertReason: '今日 +100 stars',
      score: 160,
      stars: 71000,
      starsToday: 100,
      link: 'https://github.com/microsoft/playwright',
    },
  ], { total: 2 }, { assistantName: 'Hermes' });

  assert.match(text, /Hermes 10 分钟热点\/福利雷达/);
  assert.match(text, /福利\/免费活动/);
  assert.match(text, /技术热点/);
  assert.match(text, /Free GPU credits/);
  assert.match(text, /microsoft\/playwright/);
});

test('runHotMonitor writes state output task record and sends when alerts exist', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'hot-monitor-'));
  const sent = [];
  try {
    const stateFile = join(tempDir, 'state.json');
    const outputFile = join(tempDir, 'latest.json');
    const result = await runHotMonitor({
      stateFile,
      outputFile,
    }, {
      now: new Date('2026-05-08T10:00:00.000Z'),
      env: {
        LOCAL_PROJECT_DIR: tempDir,
        HOT_MONITOR_FEISHU_RECEIVE_ID: 'chat-a',
        HOT_MONITOR_FEISHU_RECEIVE_ID_TYPE: 'chat_id',
      },
      collectItems: async () => [
        {
          id: 'benefit:credits',
          title: 'Free LLM API credits for developers',
          source: 'Product Hunt',
          kind: 'benefit-rss',
          link: 'https://example.com/credits',
        },
      ],
      sendFeishuTextMessage: async (env, message) => {
        sent.push({ env, message });
        return { ok: true };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.alertCount, 1);
    assert.equal(sent.length, 1);
    assert.match(JSON.parse(sent[0].message.content).text, /Free LLM API credits/);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(Boolean(state.items['benefit:credits']), true);
    const output = JSON.parse(readFileSync(outputFile, 'utf8'));
    assert.equal(output.alertCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runHotMonitor dry-run does not send Feishu message', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'hot-monitor-dry-'));
  try {
    const result = await runHotMonitor({
      stateFile: join(tempDir, 'state.json'),
      outputFile: join(tempDir, 'latest.json'),
      dryRun: true,
    }, {
      now: new Date('2026-05-08T10:00:00.000Z'),
      env: { LOCAL_PROJECT_DIR: tempDir },
      collectItems: async () => [
        { id: 'benefit:credits', title: 'Free server credits', source: 'RSS', kind: 'benefit-rss' },
      ],
      sendFeishuTextMessage: async () => {
        throw new Error('should not send');
      },
    });

    assert.equal(result.notification.sent, false);
    assert.equal(result.notification.reason, 'dry_run');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runHotMonitor dry-run does not update alert cooldown timestamps', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'hot-monitor-dry-cooldown-'));
  try {
    const stateFile = join(tempDir, 'state.json');
    const result = await runHotMonitor({
      stateFile,
      outputFile: join(tempDir, 'latest.json'),
      dryRun: true,
    }, {
      now: new Date('2026-05-08T10:00:00.000Z'),
      env: { LOCAL_PROJECT_DIR: tempDir },
      collectItems: async () => [
        { id: 'benefit:credits', title: 'Free server credits', source: 'RSS', kind: 'benefit-rss' },
      ],
      sendFeishuTextMessage: async () => {
        throw new Error('should not send');
      },
    });

    assert.equal(result.alertCount, 1);
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.deepEqual(state.alerts, {});
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
