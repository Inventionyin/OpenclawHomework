const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function loadMailboxActionConfig(configPath = join(__dirname, '..', 'config', 'mailbox-action-map.json')) {
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

module.exports = {
  loadMailboxActionConfig,
};
