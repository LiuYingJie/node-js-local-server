const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const RAR_EXE = path.join(__dirname, '..', 'node_modules', 'super-winrar', 'libs', 'Rar.exe');

function normalizeZipPath(relativePath) {
  const raw = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new Error('压缩包内路径无效');
  }
  return normalized;
}

async function linkOrCopyFile(source, target) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsp.link(source, target);
  } catch {
    await fsp.copyFile(source, target);
  }
}

async function stageArchiveEntries(entries, stagingDir) {
  const roots = new Set();
  for (const entry of entries) {
    const zipPath = normalizeZipPath(entry.relativePath);
    const target = path.resolve(stagingDir, ...zipPath.split('/'));
    const stagingRoot = path.resolve(stagingDir);
    if (!target.startsWith(stagingRoot + path.sep)) throw new Error('压缩包内路径无效');
    await linkOrCopyFile(entry.filePath, target);
    roots.add(zipPath.split('/')[0]);
  }
  return [...roots];
}

function runRar(args, cwd) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(RAR_EXE)) {
      reject(new Error('项目内 RAR 压缩器不存在，请重新执行 npm install'));
      return;
    }
    const child = spawn(RAR_EXE, args, { cwd, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `RAR 压缩失败，退出码 ${code}`));
    });
  });
}

async function createRarArchive(entries, outputPath, stagingDir) {
  const roots = await stageArchiveEntries(entries, stagingDir);
  await runRar(['a', '-r', '-m5', '-idq', '-ep1', path.resolve(outputPath), ...roots], stagingDir);
}

module.exports = {
  createRarArchive,
  normalizeZipPath,
};
