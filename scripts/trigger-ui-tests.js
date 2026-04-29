const DEFAULTS = {
  owner: 'Inventionyin',
  repo: 'OpenclawHomework',
  workflowId: 'ui-tests.yml',
  ref: 'main',
  runMode: 'contracts',
  targetRepository: 'Inventionyin/UItest',
  targetRef: 'main',
  baseUrl: 'http://127.0.0.1:5173',
};

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
  const owner = readOption(args, '--owner', env.GITHUB_OWNER ?? DEFAULTS.owner);
  const repo = readOption(args, '--repo', env.GITHUB_REPO ?? DEFAULTS.repo);
  const workflowId = readOption(args, '--workflow', env.GITHUB_WORKFLOW_ID ?? DEFAULTS.workflowId);
  const ref = readOption(args, '--ref', env.GITHUB_REF_NAME ?? DEFAULTS.ref);
  const token = readOption(args, '--token', env.GITHUB_TOKEN ?? env.GH_TOKEN ?? '');
  const runMode = readOption(args, '--run-mode', env.UI_TEST_RUN_MODE ?? DEFAULTS.runMode);
  const targetRepository = readOption(
    args,
    '--target-repository',
    env.UI_TEST_TARGET_REPOSITORY ?? DEFAULTS.targetRepository,
  );
  const targetRef = readOption(args, '--target-ref', env.UI_TEST_TARGET_REF ?? DEFAULTS.targetRef);
  const baseUrl = readOption(args, '--base-url', env.UI_TEST_BASE_URL ?? DEFAULTS.baseUrl);

  return {
    owner,
    repo,
    workflowId,
    ref,
    token,
    inputs: {
      run_mode: runMode,
      target_repository: targetRepository,
      target_ref: targetRef,
      base_url: baseUrl,
    },
  };
}

function buildWorkflowDispatchRequest(config) {
  if (!config.token) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN, GH_TOKEN, or pass --token.');
  }

  const workflowId = encodeURIComponent(config.workflowId);
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${workflowId}/dispatches`;

  return {
    url,
    options: {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        ref: config.ref,
        inputs: config.inputs,
      }),
    },
  };
}

function buildGitHubHeaders(config) {
  if (!config.token) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN, GH_TOKEN, or pass --token.');
  }

  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function buildWorkflowRunRequest(config) {
  if (!config.token) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN, GH_TOKEN, or pass --token.');
  }

  const workflowId = encodeURIComponent(config.workflowId);
  const branch = encodeURIComponent(config.ref);
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${workflowId}/runs?event=workflow_dispatch&branch=${branch}&per_page=10`;

  return {
    url,
    options: {
      method: 'GET',
      headers: buildGitHubHeaders(config),
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWorkflowRuns(config, fetchImpl = fetch) {
  const request = buildWorkflowRunRequest(config);
  const response = await fetchImpl(request.url, request.options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow run lookup failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const body = await response.json();
  return Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
}

async function waitForLatestWorkflowRun(config, sinceIso, fetchImpl = fetch, options = {}) {
  const attempts = Number(options.attempts ?? 10);
  const intervalMs = Number(options.intervalMs ?? 3000);
  const since = new Date(sinceIso).getTime();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const runs = await fetchWorkflowRuns(config, fetchImpl);
    const run = runs.find((item) => new Date(item.created_at).getTime() >= since - 5000);
    if (run) {
      return run;
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  return null;
}

async function getWorkflowRun(config, runId, fetchImpl = fetch) {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/runs/${runId}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: buildGitHubHeaders(config),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow run status lookup failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response.json();
}

async function waitForWorkflowCompletion(config, runId, fetchImpl = fetch, options = {}) {
  const attempts = Number(options.attempts ?? 60);
  const intervalMs = Number(options.intervalMs ?? 10000);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const run = await getWorkflowRun(config, runId, fetchImpl);
    if (run.status === 'completed') {
      return run;
    }

    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  return getWorkflowRun(config, runId, fetchImpl);
}

async function dispatchWorkflow(config, fetchImpl = fetch) {
  const dispatchedAt = new Date().toISOString();
  const request = buildWorkflowDispatchRequest(config);
  const response = await fetchImpl(request.url, request.options);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub workflow dispatch failed: ${response.status} ${response.statusText}\n${body}`);
  }

  const run = await waitForLatestWorkflowRun(config, dispatchedAt, fetchImpl, {
    attempts: Number(config.runLookupAttempts ?? 10),
    intervalMs: Number(config.runLookupIntervalMs ?? 3000),
  });

  return {
    actionsUrl: `https://github.com/${config.owner}/${config.repo}/actions/workflows/${config.workflowId}`,
    run,
    workflowRunUrl: run?.html_url,
  };
}

async function main() {
  const config = parseCliArgs();
  const result = await dispatchWorkflow(config);
  console.log('UI automation workflow dispatched.');
  console.log(`Workflow: ${result.actionsUrl}`);
  console.log(`Target repository: ${config.inputs.target_repository}`);
  console.log(`Target ref: ${config.inputs.target_ref}`);
  console.log(`Run mode: ${config.inputs.run_mode}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  buildWorkflowDispatchRequest,
  buildWorkflowRunRequest,
  dispatchWorkflow,
  getWorkflowRun,
  parseCliArgs,
  waitForLatestWorkflowRun,
  waitForWorkflowCompletion,
};
