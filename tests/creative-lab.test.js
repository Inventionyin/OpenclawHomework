const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildCreativeCards,
  formatCreativeLabReply,
  loadCreativeSignals,
  runCreativeLab,
  selectCreativeCards,
} = require('../scripts/creative-lab');
const {
  listTasks,
} = require('../scripts/background-task-store');

function writeJson(file, data) {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

test('loadCreativeSignals reads world news, hot monitor and trend intel files', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'creative-lab-signals-'));
  const worldFile = join(tempDir, 'world.json');
  const hotFile = join(tempDir, 'hot.json');
  const trendFile = join(tempDir, 'trend.json');

  try {
    writeJson(worldFile, {
      items: [{ title: 'Global AI policy shift', source: 'Reuters', link: 'https://example.com/world' }],
    });
    writeJson(hotFile, {
      items: [{ title: 'Free AI server trial', source: 'V2EX', link: 'https://example.com/free' }],
    });
    writeJson(trendFile, {
      items: [{ title: 'microsoft/playwright', source: 'GitHub Trending', link: 'https://github.com/microsoft/playwright' }],
    });

    const signals = loadCreativeSignals({
      WORLD_NEWS_OUTPUT_FILE: worldFile,
      HOT_MONITOR_OUTPUT_FILE: hotFile,
      TREND_INTEL_OUTPUT_FILE: trendFile,
    });

    assert.equal(signals.worldNews.items.length, 1);
    assert.equal(signals.hotMonitor.items.length, 1);
    assert.equal(signals.trendIntel.items.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildCreativeCards converts signals into safe creative task cards', () => {
  const cards = buildCreativeCards({
    worldNews: { items: [{ title: 'Global AI policy shift', source: 'Reuters', summary: 'Regulation update' }] },
    hotMonitor: { items: [{ title: 'Free AI token giveaway', source: 'V2EX', summary: '福利活动' }] },
    trendIntel: { items: [{ title: 'browserbase/stagehand', source: 'GitHub Trending', summary: 'AI browser automation' }] },
  }, {
    maxCards: 10,
  });

  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((card) => card.risk), ['low', 'medium', 'low']);
  assert(cards.every((card) => card.title));
  assert(cards.some((card) => card.suggestedAction === 'trend-token-factory'));
  assert(cards.some((card) => card.suggestedAction === 'manual-review'));
});

test('selectCreativeCards is deterministic with injected random and prioritizes safe cards', () => {
  const cards = [
    { id: 'a', risk: 'medium', weight: 10 },
    { id: 'b', risk: 'low', weight: 5 },
    { id: 'c', risk: 'low', weight: 1 },
  ];

  const selected = selectCreativeCards(cards, { count: 2, random: () => 0 });

  assert.deepEqual(selected.map((card) => card.id), ['b', 'c']);
});

test('runCreativeLab writes artifacts and records completed low-risk task', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'creative-lab-run-'));
  const outputFile = join(tempDir, 'latest.json');
  const taskDir = join(tempDir, 'tasks');

  try {
    const result = runCreativeLab({
      signals: {
        worldNews: { items: [{ title: 'Global logistics disruption', source: 'World RSS' }] },
        hotMonitor: { items: [] },
        trendIntel: { items: [{ title: 'microsoft/playwright', source: 'GitHub Trending' }] },
      },
      outputFile,
      env: { TOKEN_FACTORY_TASK_DIR: taskDir },
      random: () => 0.99,
    });

    assert.equal(existsSync(outputFile), true);
    assert.equal(result.status, 'completed');
    assert.equal(result.pendingConfirmation.length, 0);
    assert.equal(result.selected.length, 1);
    assert.equal(JSON.parse(readFileSync(outputFile, 'utf8')).selected.length, 1);

    const tasks = listTasks({ TOKEN_FACTORY_TASK_DIR: taskDir });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].type, 'creative-lab');
    assert.equal(tasks[0].status, 'completed');
    assert.equal(tasks[0].summary.selectedCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runCreativeLab records medium-risk ideas as awaiting confirmation', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'creative-lab-pending-'));
  const taskDir = join(tempDir, 'tasks');

  try {
    const result = runCreativeLab({
      signals: {
        worldNews: { items: [] },
        hotMonitor: { items: [{ title: 'Free cloud server campaign', source: '福利论坛' }] },
        trendIntel: { items: [] },
      },
      outputFile: join(tempDir, 'latest.json'),
      env: { TOKEN_FACTORY_TASK_DIR: taskDir },
      random: () => 0,
    });

    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal(result.pendingConfirmation.length, 1);
    assert.equal(result.autoRunnable.length, 0);

    const [task] = listTasks({ TOKEN_FACTORY_TASK_DIR: taskDir });
    assert.equal(task.status, 'awaiting_confirmation');
    assert.equal(task.summary.pendingConfirmationCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('formatCreativeLabReply redacts secret-like content', () => {
  const reply = formatCreativeLabReply({
    generatedAt: '2026-05-10T00:00:00.000Z',
    status: 'awaiting_confirmation',
    selected: [{
      title: 'Use sk-secret-token in demo',
      source: 'test',
      risk: 'medium',
      reason: 'contains sk-abcdefghijklmnopqrstuvwxyz',
      suggestedPrompt: '确认后再执行',
    }],
    autoRunnable: [],
    pendingConfirmation: [{ title: 'Use sk-secret-token in demo' }],
    files: { output: '/tmp/out.json' },
  });

  assert.match(reply, /Hermes 创意实验室/);
  assert.match(reply, /\[redacted\]/);
  assert.doesNotMatch(reply, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.match(reply, /待确认/);
});
