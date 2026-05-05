const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findMailboxByAddress,
  listRegistrationCandidateMailboxes,
  loadMailboxInventory,
  summarizeMailboxInventory,
} = require('../scripts/mailbox-inventory');

test('loadMailboxInventory exposes six primary accounts and thirty total mailboxes', () => {
  const inventory = loadMailboxInventory();
  const summary = summarizeMailboxInventory(inventory);

  assert.equal(summary.primaryCount, 6);
  assert.equal(summary.subCount, 24);
  assert.equal(summary.totalCount, 30);
  assert.equal(summary.openClawCount, 15);
  assert.equal(summary.hermesCount, 15);
});

test('listRegistrationCandidateMailboxes returns only safe testing mailboxes', () => {
  const candidates = listRegistrationCandidateMailboxes();

  assert(candidates.length >= 6);
  assert(candidates.every((item) => item.canRegister === true));
  assert(candidates.some((item) => item.email === 'evasan.account@claw.163.com'));
  assert(candidates.some((item) => item.email === 'shine1@claw.163.com'));
  assert(!candidates.some((item) => item.email === 'agent3.archive@claw.163.com'));
  assert(!candidates.some((item) => item.email === 'shine1.ui@claw.163.com'));
});

test('findMailboxByAddress returns mailbox metadata across all groups', () => {
  const mailbox = findMailboxByAddress('hagent.security@claw.163.com');

  assert.equal(mailbox.primary, 'hagent@claw.163.com');
  assert.equal(mailbox.owner, 'Hermes');
  assert.equal(mailbox.role, 'security');
  assert.equal(mailbox.canRegister, false);
});
