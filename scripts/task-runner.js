const {
  createTask,
  getLatestTask,
  listRecoverableTasks,
  readTask,
  updateTask,
} = require('./background-task-store');
const {
  runTokenLab,
} = require('./qa-token-lab');
const {
  runMultiAgentLab,
} = require('./multi-agent-lab');

function summarizeTokenFactory(tokenLabResult = {}, multiAgentResult = {}) {
  const tokenReport = tokenLabResult.report || {};
  const tokenFiles = tokenLabResult.files || {};
  const multiSummary = multiAgentResult.summary || {};
  const multiFiles = multiAgentResult.files || {};
  return {
    summary: {
      tokenJobs: Number(tokenReport.totalJobs || 0),
      multiAgentItems: Number(multiSummary.totalItems || 0),
      totalTokens: Number(tokenReport.totalTokens || 0) + Number(multiSummary.totalTokens || 0),
      estimatedTotalTokens: Number(tokenReport.estimatedTotalTokens || 0) + Number(multiSummary.estimatedTotalTokens || 0),
      winner: multiSummary.winner || '',
    },
    files: {
      tokenReport: tokenFiles.report || '',
      tokenItems: tokenFiles.items || '',
      multiAgentReport: multiFiles.report || '',
      multiAgentItems: multiFiles.items || '',
      multiAgentSummary: multiFiles.summary || '',
    },
  };
}

async function runTokenFactoryTask(taskId, options = {}) {
  const env = options.env || process.env;
  const tokenLabRunner = options.tokenLabRunner || ((runnerOptions) => runTokenLab(runnerOptions));
  const multiAgentLabRunner = options.multiAgentLabRunner || ((runnerOptions) => runMultiAgentLab(runnerOptions));
  const emailSender = options.emailSender;
  updateTask(taskId, { status: 'running' }, env);
  try {
    const tokenLabResult = await tokenLabRunner({
      env,
      batchSize: env.QA_TOKEN_LAB_BATCH_SIZE,
      outputDir: env.QA_TOKEN_LAB_OUTPUT_DIR,
      emailSender,
    });
    const multiAgentResult = await multiAgentLabRunner({
      env,
      batchSize: env.MULTI_AGENT_LAB_BATCH_SIZE || env.QA_TOKEN_LAB_BATCH_SIZE,
      outputDir: env.MULTI_AGENT_LAB_OUTPUT_DIR || env.QA_TOKEN_LAB_OUTPUT_DIR,
      emailSender,
    });
    const result = summarizeTokenFactory(tokenLabResult, multiAgentResult);
    return updateTask(taskId, {
      status: 'completed',
      summary: result.summary,
      files: result.files,
      error: '',
    }, env);
  } catch (error) {
    return updateTask(taskId, {
      status: 'failed',
      error: String(error.message || error),
    }, env);
  }
}

async function runRecoverableTokenFactoryTasks(options = {}) {
  const env = options.env || process.env;
  const tasks = listRecoverableTasks(env, {
    now: options.now || new Date(),
    staleMs: options.staleMs,
  });
  const runner = options.runner || runTokenFactoryTask;
  const result = {
    scanned: tasks.length,
    completed: 0,
    failed: 0,
    taskIds: tasks.map((task) => task.id),
  };

  for (const task of tasks) {
    updateTask(task.id, {
      status: 'running',
      error: '',
    }, env);
    try {
      const saved = await runner(task.id, options);
      if (saved?.status === 'failed') {
        result.failed += 1;
      } else {
        result.completed += 1;
      }
    } catch (error) {
      updateTask(task.id, {
        status: 'failed',
        error: String(error.message || error),
      }, env);
      result.failed += 1;
    }
  }

  return result;
}

function startTokenFactoryTask(options = {}) {
  const env = options.env || process.env;
  const task = createTask({
    type: 'token-factory',
    status: 'queued',
  }, env);
  const runner = options.runner || runTokenFactoryTask;
  const promise = Promise.resolve()
    .then(() => runner(task.id, options))
    .catch((error) => updateTask(task.id, {
      status: 'failed',
      error: String(error.message || error),
    }, env));
  return {
    task,
    promise,
  };
}

function formatTokenFactoryTask(task) {
  if (!task) {
    return '还没有 token-factory 后台任务记录。';
  }
  const summary = task.summary || {};
  const files = task.files || {};
  return [
    `token-factory 任务：${task.id}`,
    `- 状态：${task.status}`,
    `- 创建：${task.createdAt}`,
    `- 更新：${task.updatedAt}`,
    summary.tokenJobs !== undefined ? `- token 训练任务：${summary.tokenJobs}` : null,
    summary.multiAgentItems !== undefined ? `- 多 Agent 样本：${summary.multiAgentItems}` : null,
    summary.totalTokens !== undefined ? `- 真实 token：${summary.totalTokens}` : null,
    summary.estimatedTotalTokens ? `- 估算 token：${summary.estimatedTotalTokens}` : null,
    summary.winner ? `- 赢家：${summary.winner}` : null,
    files.tokenReport ? `- token 报告：${files.tokenReport}` : null,
    files.multiAgentSummary ? `- 多 Agent 摘要：${files.multiAgentSummary}` : null,
    task.error ? `- 错误：${task.error}` : null,
  ].filter(Boolean).join('\n');
}

function getTokenFactoryTaskStatus(env = process.env, id = '') {
  return id ? readTask(id, env) : getLatestTask(env);
}

module.exports = {
  formatTokenFactoryTask,
  getTokenFactoryTaskStatus,
  runRecoverableTokenFactoryTasks,
  runTokenFactoryTask,
  startTokenFactoryTask,
  summarizeTokenFactory,
};
