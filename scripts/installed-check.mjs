/**
 * 查一下「本机装的桌面版」到底是哪个版本。
 *
 * 为什么需要这个脚本：
 *   v0.5.0 发完之后，用户截图上还是 v0.4.0 的老界面 —— 代码、网页版、
 *   GitHub Release 全是对的，只有 `%LOCALAPPDATA%\Programs\yichen-ledger`
 *   里那份没更新。装完新包但忘了重装，看起来就像「修了个寂寞」。
 *
 *   所以发布之后别只看 CI 绿不绿，跑一下这个，确认本机真的换了。
 *
 * 用法：
 *   node scripts/installed-check.mjs          # 只查，报告版本
 *   node scripts/installed-check.mjs --strict # 版本对不上就以非 0 退出（给 CI 用）
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoVersion = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

/** 从 asar 里读出 dist/index.html 引用的那个 bundle 名，它带着构建时的 hash */
function readBundles(asarPath) {
  const buf = fs.readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + headerSize).toString('utf8'));

  const files = [];
  (function walk(node, prefix) {
    for (const [name, value] of Object.entries(node.files ?? {})) {
      const full = `${prefix}/${name}`;
      if (value.files) walk(value, full);
      else files.push({ path: full, size: value.size, offset: Number(value.offset) });
    }
  })(header, '');

  const base = 16 + headerSize;
  const read = (f) => buf.subarray(base + f.offset, base + f.offset + f.size).toString('utf8');
  const indexHtml = files.find((f) => f.path.endsWith('/dist/index.html'));
  const entry = indexHtml ? (read(indexHtml).match(/index-[A-Za-z0-9_-]+\.js/) ?? [null])[0] : null;
  const bundles = files
    .filter((f) => /\/dist\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(f.path))
    .map((f) => path.basename(f.path));

  return { entry, bundles };
}

/** 各平台的安装位置。只写我们真的验证过的那几个，猜错不如不写。 */
function candidatePaths() {
  const out = [];
  if (process.platform === 'win32') {
    out.push({
      label: 'Windows 安装版',
      asar: path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'yichen-ledger', 'resources', 'app.asar'),
    });
  } else if (process.platform === 'darwin') {
    out.push({
      label: 'macOS 安装版',
      asar: path.join('/Applications', '忆尘记账.app', 'Contents', 'Resources', 'app.asar'),
    });
  }
  return out;
}

const found = candidatePaths().filter((c) => fs.existsSync(c.asar));

if (found.length === 0) {
  console.log(`仓库版本：v${repoVersion}`);
  console.log('本机没找到已安装的桌面版（只查安装目录，不查解压出来的 zip）。');
  console.log('想验的话直接 npm run electron，或者先装一次 npm run pack:win。');
  process.exit(0);
}

let ok = true;
for (const { label, asar } of found) {
  const { entry, bundles } = readBundles(asar);
  const built = fs.statSync(asar).mtime;
  console.log(`${label}`);
  console.log(`  路径     ${asar}`);
  console.log(`  构建时间 ${built.toLocaleString('zh-CN')}`);
  console.log(`  入口     ${entry ?? '(没找到)'}`);
  console.log(`  包内共   ${bundles.length} 个 bundle`);

  // asar 里没有版本号字段（package.json 被打进去了，但读它要再解一层），
  // 所以拿「入口 bundle 在不在当前 dist 里」来判断：对得上就说明装的是这一份。
  const distHtml = path.join(here, '..', 'dist', 'index.html');
  let distEntry = null;
  try {
    distEntry = fs.readFileSync(distHtml, 'utf8').match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
  } catch {
    console.log('  （本地没有 dist/，跳过比对）');
  }

  if (distEntry) {
    const same = distEntry === entry;
    console.log(`  本地 dist ${distEntry}`);
    console.log(`  结论     ${same ? '✅ 一致，装的就是当前这份' : '❌ 不一致，装的是旧的，需要重新安装'}`);
    if (!same) ok = false;
  }
  console.log('');
}

console.log(`仓库版本：v${repoVersion}`);
if (!ok && process.argv.includes('--strict')) {
  console.log('STRICT: 本机安装的版本与当前构建不一致');
  process.exit(1);
}
