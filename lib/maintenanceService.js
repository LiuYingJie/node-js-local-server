const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { ROOT, TEMP_DIR, AUDIT_LOG } = require('./paths');
const { ensureDir } = require('./fileUtils');

const MAINTENANCE_LOG = path.join(path.dirname(AUDIT_LOG), 'maintenance.log');

function execFileText(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { cwd: ROOT, windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
      });
    });
  });
}

async function readTail(filePath, maxChars = 12000) {
  try {
    const stat = await fs.stat(filePath);
    const start = Math.max(0, stat.size - maxChars);
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

async function getMaintenanceStatus() {
  const [branch, commit, dirty] = await Promise.all([
    execFileText('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    execFileText('git', ['rev-parse', '--short', 'HEAD']),
    execFileText('git', ['status', '--porcelain']),
  ]);

  return {
    branch: branch.ok ? branch.stdout : '',
    commit: commit.ok ? commit.stdout : '',
    dirty: Boolean(dirty.stdout),
    dirtySummary: dirty.stdout.split(/\r?\n/).filter(Boolean).slice(0, 30),
    log: await readTail(MAINTENANCE_LOG),
  };
}

function cmdEscape(value) {
  return String(value).replace(/"/g, '""');
}

async function startSelfUpdateJob() {
  await ensureDir(TEMP_DIR);
  await ensureDir(path.dirname(MAINTENANCE_LOG));

  const dirty = await execFileText('git', ['status', '--porcelain']);
  if (dirty.stdout) {
    throw new Error('当前项目存在未提交改动，已拒绝执行 git pull。请先提交或清理工作区。');
  }

  const jobId = crypto.randomUUID();
  const scriptPath = path.join(TEMP_DIR, `maintenance-${jobId}.cmd`);
  const statusPath = path.join(TEMP_DIR, `maintenance-${jobId}.status.txt`);
  const starterPath = path.join(TEMP_DIR, `maintenance-start-${jobId}.cmd`);
  const root = cmdEscape(ROOT);
  const log = cmdEscape(MAINTENANCE_LOG);
  const status = cmdEscape(statusPath);
  const starter = cmdEscape(starterPath);
  const port = process.env.PORT || '3000';

  const script = `@echo off
setlocal enabledelayedexpansion
cd /d "${root}"
echo.>>"${log}"
echo ==== maintenance ${jobId} start %date% %time% ====>>"${log}"
echo Checking working tree...>>"${log}"
git status --porcelain > "${status}" 2>>"${log}"
for %%A in ("${status}") do if %%~zA GTR 0 (
  echo Working tree is dirty. Abort.>>"${log}"
  type "${status}" >>"${log}"
  exit /b 2
)
echo Pulling latest code...>>"${log}"
git pull --ff-only >>"${log}" 2>&1
if errorlevel 1 (
  echo git pull failed. Service remains running.>>"${log}"
  exit /b 3
)
echo Installing dependencies...>>"${log}"
call npm install --ignore-scripts >>"${log}" 2>&1
if errorlevel 1 (
  echo npm install failed. Service remains running.>>"${log}"
  exit /b 4
)
echo Preparing restart script...>>"${log}"
(
  echo @echo off
  echo cd /d "${root}"
  echo node app.js ^>^> "${log}" 2^>^&1
) > "${starter}"
echo Restarting service on port ${port}...>>"${log}"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":${port}" ^| findstr "LISTENING"') do (
  echo Kill PID %%p>>"${log}"
  taskkill /PID %%p /F >>"${log}" 2>&1
)
timeout /t 2 /nobreak >nul
start "File Server" /min cmd /c ""${starter}""
echo Restart command issued.>>"${log}"
exit /b 0
`;

  await fs.writeFile(scriptPath, script, 'utf8');
  const child = spawn('cmd.exe', ['/c', 'start', 'Maintenance', '/min', 'cmd.exe', '/c', scriptPath], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  await fs.appendFile(MAINTENANCE_LOG, `\n==== maintenance ${jobId} queued ${new Date().toISOString()} ====\n`, 'utf8');
  return { jobId };
}

module.exports = {
  getMaintenanceStatus,
  startSelfUpdateJob,
  MAINTENANCE_LOG,
};
