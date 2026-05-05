const {
  runRecoverableTokenFactoryTasks,
} = require('./task-runner');

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function parseCliArgs(args = process.argv.slice(2), env = process.env) {
  return {
    once: args.includes('--once'),
    intervalMs: Number(readOption(args, '--interval-ms', env.TOKEN_FACTORY_WORKER_INTERVAL_MS || '60000')),
    staleMs: Number(readOption(args, '--stale-ms', env.TOKEN_FACTORY_STALE_MS || String(30 * 60 * 1000))),
  };
}

async function runWorkerOnce(options = {}) {
  const result = await runRecoverableTokenFactoryTasks(options);
  const taskList = result.taskIds.length ? ` (${result.taskIds.join(', ')})` : '';
  console.log(`token-factory worker scanned ${result.scanned} task(s), failed ${result.failed}${taskList}`);
  return result;
}

async function startTokenFactoryWorker(options = {}) {
  const env = options.env || process.env;
  const config = {
    ...parseCliArgs(options.args || [], env),
    ...options,
    env,
  };

  do {
    await runWorkerOnce(config);
    if (config.once) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
  } while (true);
}

if (require.main === module) {
  startTokenFactoryWorker({ args: process.argv.slice(2) })
    .catch((error) => {
      console.error(`token-factory worker failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseCliArgs,
  runWorkerOnce,
  startTokenFactoryWorker,
};
