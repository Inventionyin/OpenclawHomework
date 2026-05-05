const { execFile } = require('node:child_process');

function runGBrainSearch(query, options = {}) {
  const gbrainBin = options.gbrainBin || process.env.GBRAIN_BIN || 'gbrain';
  const timeout = Number(options.timeout || process.env.GBRAIN_TIMEOUT_MS || 30000);
  const cwd = options.cwd || process.env.GBRAIN_CWD || process.cwd();
  const limit = Number(options.limit || process.env.GBRAIN_RESULT_LIMIT || 6);
  const execFileImpl = options.execFile || execFile;

  return new Promise((resolve, reject) => {
    execFileImpl(
      gbrainBin,
      ['search', String(query || '').trim()],
      {
        cwd,
        timeout,
        windowsHide: true,
        env: {
          ...process.env,
          ...(options.env || {}),
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`GBrain search failed: ${error.message}\n${stderr || ''}`.trim()));
          return;
        }

        const lines = String(stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, limit);

        if (lines.length === 0 || /^No results\./i.test(lines[0])) {
          resolve(`GBrain 没找到相关结果：${String(query || '').trim()}`);
          return;
        }

        resolve([
          '# GBrain 检索结果',
          '',
          ...lines.map((line) => `- ${line}`),
        ].join('\n'));
      },
    );
  });
}

module.exports = {
  runGBrainSearch,
};
