const { loadMailboxActionConfig } = require('./mailbox-action-config');

function buildOverrideKey(actionName) {
  return `MAILBOX_ACTION_${String(actionName).toUpperCase()}_TO`;
}

function resolveMailboxAction(actionName, env = process.env, config = loadMailboxActionConfig()) {
  const action = config.actions?.[actionName];
  if (!action) {
    return {
      action: actionName,
      enabled: false,
      skipReason: 'missing',
    };
  }

  const override = env[buildOverrideKey(actionName)];
  return {
    action: actionName,
    mailbox: override || action.mailbox,
    subjectPrefix: action.subjectPrefix,
    description: action.description,
    enabled: Boolean(action.enabled),
    skipReason: action.enabled ? null : 'disabled',
  };
}

module.exports = {
  resolveMailboxAction,
  buildOverrideKey,
};
