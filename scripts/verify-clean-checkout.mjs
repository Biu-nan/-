// 从 git 干净检出，能否复现出与生产磁盘相同的内容指纹？
//
// 一键运行：node scripts/verify-clean-checkout.mjs
//
// 为什么需要它：A2c 把批准记录绑定到 manifest 指纹，而指纹是对**磁盘文件**
// 算的 sha256。如果 git 里存的不是磁盘字节（例如 core.autocrlf 把 CRLF 归一化成
// LF，见 docs/A2_PREREQ_BINDING_2026-11-10.md §16），那么全新 clone / 任何 checkout
// 得到的字节 ≠ 生产正在跑的字节 ⇒ 同一"版本"复现不出同一份代码内容 ⇒
// 批准机制退化为仪式。逐文件 sha256 比对只能证明"当前工作区干净"，
// 本脚本证明的是"从仓库单独取出来也能跑、且内容一致"。
//
// 做法（纯 Node，不依赖 tar / 不改动工作区）：
//   1. git ls-files 取受管文件清单
//   2. git cat-file -p HEAD:<path> 把每个 blob 的原始字节写进临时目录
//      （-text 规则保证 blob 就是 checkout 后工作区的字节）
//   3. 分别以「生产工作区」和「临时检出」为 codeRoot 构建 PRODUCTION manifest
//   4. 比 manifest.files 的 path/sha256/bytes（排序后算内容指纹）
//   5. 再用临时检出目录里的模块本身构建一次，确认它能独立运行
//
// 注意：manifest.fingerprint 本身包含 codeRoot，两个不同路径必然不同，
// 所以这里比的是「去掉根路径后的纯内容」，不是 fingerprint。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GIT = (args, opts = {}) => execFileSync('git', args, {cwd: REPO, maxBuffer: 64 * 1024 * 1024, ...opts});

const SCOPE = ['dist', 'public', 'schemas', 'prompts', 'config', 'listing-agent', 'package.json', 'package-lock.json'];
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-checkout-'));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-checkout-data-'));

const files = GIT(['ls-files', ...SCOPE], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
for (const rel of files) {
  if (rel.includes('\r')) continue;
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.writeFileSync(dest, GIT(['cat-file', '-p', `HEAD:${rel}`]));
}

const modUrl = pathToFileURL(path.join(REPO, 'dist/src/ceo-main-boundary.js')).href;
const {createMainRuntimeInfo} = await import(modUrl);
const OPTS = {releaseId: 'clean-checkout-probe', mode: 'PRODUCTION'};

const disk = await createMainRuntimeInfo({codeRoot: REPO, dataRoot: DATA, ...OPTS});
const clone = await createMainRuntimeInfo({codeRoot: OUT, dataRoot: DATA, ...OPTS});
const cloneMod = await import(pathToFileURL(path.join(OUT, 'dist/src/ceo-main-boundary.js')).href);
const cloneSelf = await cloneMod.createMainRuntimeInfo({codeRoot: OUT, dataRoot: DATA, ...OPTS});

// 内容指纹：把 files 的 group|path|sha256|bytes 排序后算 sha256。
// 它不含 codeRoot/dataRoot，所以可以直接跨根比较。
const contentKey = (m) => {
  const rows = m.files.map((f) => `${f.group}|${f.path}|${f.sha256}|${f.bytes}`).sort();
  return {key: createHash('sha256').update(rows.join('\n')).digest('hex'), count: rows.length};
};
const kDisk = contentKey(disk.manifest);
const kClone = contentKey(clone.manifest);
const kSelf = contentKey(cloneSelf.manifest);

console.log(`从 HEAD 重建 ${files.length} 个受管文件 → ${OUT}`);
console.log(`生产 worktree : ${REPO}`);
console.log(`dataRoot      : ${DATA}`);
console.log('');
console.log(`  manifest 文件数      磁盘=${kDisk.count}  检出=${kClone.count}  检出模块=${kSelf.count}`);
console.log(`  内容指纹             磁盘=${kDisk.key.slice(0, 24)}`);
console.log(`                       检出=${kClone.key.slice(0, 24)}`);
console.log(`                       检出模块=${kSelf.key.slice(0, 24)}`);
console.log('');
console.log(`  manifest.fingerprint 磁盘=${disk.manifest.fingerprint.slice(0, 16)}  检出=${clone.manifest.fingerprint.slice(0, 16)}`);
console.log('                        （不同是预期的：fingerprint 含 codeRoot）');
console.log(`  准入原因             磁盘=${disk.admission?.reason}  检出=${clone.admission?.reason}`);
console.log(`  health.mode          磁盘=${(await disk.health()).mode}  检出=${(await clone.health()).mode}`);
console.log('');

const ok = kDisk.count > 0 && kDisk.count === kClone.count && kDisk.count === kSelf.count
  && kDisk.key === kClone.key && kDisk.key === kSelf.key
  && disk.manifest.fingerprint !== clone.manifest.fingerprint
  && disk.admission?.reason === clone.admission?.reason;

console.log(ok
  ? '✅ 结论：git 干净检出复现出与生产磁盘逐文件相同的字节，清单可独立构建。'
  : '❌ 结论：内容不一致，git 检出无法复现生产字节。');

for (const dir of [OUT, DATA]) {
  try { fs.rmSync(dir, {recursive: true, force: true}); } catch (_) { /* 临时目录留着也无害 */ }
}
process.exit(ok ? 0 : 1);
