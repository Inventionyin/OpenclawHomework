const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function inventoryPath() {
  return join(process.cwd(), 'data', 'mailbox-inventory.json');
}

function loadMailboxInventory() {
  return JSON.parse(readFileSync(inventoryPath(), 'utf8'));
}

function summarizeMailboxInventory(inventory = loadMailboxInventory()) {
  const mailboxes = inventory.mailboxes || [];
  const primaryCount = mailboxes.filter((item) => item.type === 'primary').length;
  const subCount = mailboxes.filter((item) => item.type === 'sub').length;
  const openClawCount = mailboxes.filter((item) => item.owner === 'OpenClaw').length;
  const hermesCount = mailboxes.filter((item) => item.owner === 'Hermes').length;

  return {
    primaryCount,
    subCount,
    totalCount: mailboxes.length,
    openClawCount,
    hermesCount,
  };
}

function listRegistrationCandidateMailboxes(inventory = loadMailboxInventory()) {
  return (inventory.mailboxes || []).filter((item) => item.canRegister === true);
}

function findMailboxByAddress(email, inventory = loadMailboxInventory()) {
  return (inventory.mailboxes || []).find((item) => item.email === email) || null;
}

module.exports = {
  findMailboxByAddress,
  listRegistrationCandidateMailboxes,
  loadMailboxInventory,
  summarizeMailboxInventory,
};
