const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  appendMailLedgerEntry,
  buildMailLedgerSummaryReply,
  filterMailLedgerEntriesForDay,
  readMailLedgerEntries,
} = require('../scripts/mail-ledger');

test('appendMailLedgerEntry writes safe email action summary lines', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mail-ledger-'));
  try {
    const env = {
      MAIL_LEDGER_ENABLED: 'true',
      MAIL_LEDGER_PATH: join(tempDir, 'mail.jsonl'),
    };

    appendMailLedgerEntry(env, {
      assistant: 'Hermes',
      action: 'daily',
      provider: 'evanshine',
      sent: true,
      traceId: 'trace-mail-001',
      subject: '[Daily Summary] 自动化测试日报',
      to: ['1693457391@qq.com', 'agent4.daily@claw.163.com'],
      externalTo: ['1693457391@qq.com'],
      archiveTo: ['agent4.daily@claw.163.com'],
    });

    const entries = readMailLedgerEntries(env);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].assistant, 'Hermes');
    assert.equal(entries[0].action, 'daily');
    assert.equal(entries[0].provider, 'evanshine');
    assert.equal(entries[0].traceId, 'trace-mail-001');
    assert.equal(entries[0].recipientCount, 2);
    assert.deepEqual(entries[0].externalTo, ['1693457391@qq.com']);
    assert.deepEqual(entries[0].archiveTo, ['agent4.daily@claw.163.com']);
    assert.doesNotMatch(JSON.stringify(entries[0]), /pass|token|secret/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('buildMailLedgerSummaryReply explains recent sent mail actions', () => {
  const reply = buildMailLedgerSummaryReply([
    {
      timestamp: '2026-05-06T00:01:02.000Z',
      assistant: 'OpenClaw',
      action: 'report',
      provider: 'default',
      sent: true,
      subject: '[OpenClaw Report] success - main / smoke',
      to: ['watchee.report@claw.163.com'],
    },
    {
      timestamp: '2026-05-06T00:02:03.000Z',
      assistant: 'Hermes',
      action: 'daily',
      provider: 'evanshine',
      sent: true,
      subject: '[Daily Summary] 自动化测试日报',
      externalTo: ['1693457391@qq.com'],
      archiveTo: ['agent4.daily@claw.163.com'],
    },
  ]);

  assert.match(reply, /邮件发送账本/);
  assert.match(reply, /OpenClaw/);
  assert.match(reply, /report/);
  assert.match(reply, /Hermes/);
  assert.match(reply, /daily/);
  assert.match(reply, /1693457391@qq.com/);
  assert.match(reply, /agent4.daily@claw.163.com/);
});

test('filterMailLedgerEntriesForDay uses configured timezone offset', () => {
  const entries = [
    {
      timestamp: '2026-05-05T15:59:59.000Z',
      action: 'before-midnight',
    },
    {
      timestamp: '2026-05-05T16:00:00.000Z',
      action: 'today-start',
    },
    {
      timestamp: '2026-05-06T15:59:59.000Z',
      action: 'today-end',
    },
  ];

  const filtered = filterMailLedgerEntriesForDay(entries, {
    day: '2026-05-06',
    timezoneOffsetMinutes: 480,
  });

  assert.deepEqual(filtered.map((entry) => entry.action), ['today-start', 'today-end']);
});
