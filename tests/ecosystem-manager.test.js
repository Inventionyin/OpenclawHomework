const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  buildInstallShellScript,
  buildEcosystemStatusReply,
  createEcosystemInstallPlan,
  listEcosystemPlugins,
  writeEcosystemState,
} = require('../scripts/ecosystem-manager');

test('listEcosystemPlugins classifies trusted installable and research-only entries', () => {
  const plugins = listEcosystemPlugins();
  const byId = Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin]));

  assert.equal(byId.gbrain.trust, 'trusted');
  assert.equal(byId.gbrain.installMode, 'supported');
  assert.equal(byId.hermes_webui.installMode, 'candidate');
  assert.equal(byId.awesome_hermes_agent.installMode, 'catalog');
  assert.equal(byId.hermes_agent_self_evolution.installMode, 'research');
  assert.equal(byId.g_stack.installMode, 'concept');
});

test('createEcosystemInstallPlan only auto-installs supported trusted entries by default', () => {
  const plan = createEcosystemInstallPlan({ target: 'hermes' });

  assert.equal(plan.target, 'hermes');
  assert.deepEqual(plan.autoInstallIds, ['gbrain']);
  assert.ok(plan.candidateIds.includes('hermes_webui'));
  assert.ok(plan.candidateIds.includes('hermes_agent_self_evolution'));
  assert.ok(plan.researchIds.includes('awesome_hermes_agent'));
});

test('writeEcosystemState writes auditable state without secrets', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ecosystem-state-'));
  try {
    const stateFile = join(tempDir, 'ecosystem.json');
    const state = writeEcosystemState(stateFile, {
      target: 'hermes',
      installed: [{ id: 'gbrain', version: 'abc123' }],
      skipped: [{ id: 'hermes_webui', reason: 'candidate' }],
    });

    const raw = readFileSync(stateFile, 'utf8');
    assert.match(raw, /gbrain/);
    assert.match(raw, /hermes_webui/);
    assert.doesNotMatch(raw, /token|secret|apikey/i);
    assert.equal(state.target, 'hermes');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildEcosystemStatusReply explains safe install policy', () => {
  const reply = buildEcosystemStatusReply({
    target: 'Hermes',
    installed: [{ id: 'gbrain', name: 'GBrain' }],
    skipped: [{ id: 'hermes_webui', name: 'Hermes WebUI', reason: '候选项，待确认仓库和端口' }],
  });

  assert.match(reply, /Hermes/);
  assert.match(reply, /GBrain/);
  assert.match(reply, /Hermes WebUI/);
  assert.match(reply, /不会自动执行来路不明脚本/);
});

test('buildInstallShellScript keeps dirty external gbrain checkout instead of overwriting it', () => {
  const script = buildInstallShellScript();

  assert.match(script, /apt-get install -y unzip/);
  assert.match(script, /git -C \/opt\/gbrain diff --quiet/);
  assert.match(script, /ln -sfn "\$BUN_INSTALL\/bin\/gbrain" \/usr\/local\/bin\/gbrain/);
  assert.match(script, /Skipping GBrain update because \/opt\/gbrain has local changes/);
  assert.doesNotMatch(script, /git reset --hard/);
});
