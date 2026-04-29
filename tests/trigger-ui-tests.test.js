const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWorkflowDispatchRequest,
  buildWorkflowRunRequest,
  parseCliArgs,
  waitForLatestWorkflowRun,
} = require('../scripts/trigger-ui-tests');

test('parseCliArgs returns homework defaults and supplied workflow inputs', () => {
  const config = parseCliArgs([
    '--token',
    'ghp_example',
    '--run-mode',
    'contracts',
    '--target-repository',
    'Inventionyin/UItest',
    '--base-url',
    'http://127.0.0.1:5173',
  ]);

  assert.equal(config.owner, 'Inventionyin');
  assert.equal(config.repo, 'OpenclawHomework');
  assert.equal(config.workflowId, 'ui-tests.yml');
  assert.equal(config.ref, 'main');
  assert.equal(config.token, 'ghp_example');
  assert.deepEqual(config.inputs, {
    run_mode: 'contracts',
    target_repository: 'Inventionyin/UItest',
    target_ref: 'main',
    app_repository: 'dengzhekun/projectku-web',
    app_ref: 'main',
    base_url: 'http://127.0.0.1:5173',
  });
});

test('buildWorkflowDispatchRequest creates GitHub workflow_dispatch request', () => {
  const request = buildWorkflowDispatchRequest({
    owner: 'Inventionyin',
    repo: 'OpenclawHomework',
    workflowId: 'ui-tests.yml',
    ref: 'main',
    token: 'ghp_example',
    inputs: {
      run_mode: 'contracts',
      target_repository: 'Inventionyin/UItest',
      target_ref: 'main',
      app_repository: 'dengzhekun/projectku-web',
      app_ref: 'main',
      base_url: 'http://127.0.0.1:5173',
    },
  });

  assert.equal(
    request.url,
    'https://api.github.com/repos/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml/dispatches',
  );
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer ghp_example');
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json');
  assert.deepEqual(JSON.parse(request.options.body), {
    ref: 'main',
    inputs: {
      run_mode: 'contracts',
      target_repository: 'Inventionyin/UItest',
      target_ref: 'main',
      app_repository: 'dengzhekun/projectku-web',
      app_ref: 'main',
      base_url: 'http://127.0.0.1:5173',
    },
  });
});

test('buildWorkflowRunRequest creates GitHub workflow run lookup request', () => {
  const request = buildWorkflowRunRequest({
    owner: 'Inventionyin',
    repo: 'OpenclawHomework',
    workflowId: 'ui-tests.yml',
    ref: 'main',
    token: 'ghp_example',
  });

  assert.equal(
    request.url,
    'https://api.github.com/repos/Inventionyin/OpenclawHomework/actions/workflows/ui-tests.yml/runs?event=workflow_dispatch&branch=main&per_page=10',
  );
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers.Authorization, 'Bearer ghp_example');
});

test('waitForLatestWorkflowRun returns first run created after dispatch', async () => {
  const calls = [];
  const run = await waitForLatestWorkflowRun(
    {
      owner: 'Inventionyin',
      repo: 'OpenclawHomework',
      workflowId: 'ui-tests.yml',
      ref: 'main',
      token: 'ghp_example',
    },
    '2026-04-29T07:00:00.000Z',
    async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          workflow_runs: [
            {
              id: 123,
              status: 'queued',
              conclusion: null,
              created_at: '2026-04-29T07:00:01.000Z',
              html_url: 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123',
            },
          ],
        }),
      };
    },
    {
      attempts: 1,
      intervalMs: 1,
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(run.id, 123);
  assert.equal(run.html_url, 'https://github.com/Inventionyin/OpenclawHomework/actions/runs/123');
});
