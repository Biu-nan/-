#!/usr/bin/env node
// A2 合并执行器（白名单、可演练、可回滚）
//
// 为什么需要它：A2 的合并长期是「94 条清单」这种口口相传的数字，一旦真的执行，
// 任何一次手滑都是往正在跑生产的目录里写代码。这个脚本把合并变成一次**可审计的机械操作**：
//   默认 dry-run，只打印将要发生什么；--apply 才写盘，且写前先备份、写后逐文件比 sha256。
//
// 关键约束（都是踩过的坑，改之前先读 docs/A2_PREREQ_BINDING_2026-11-10.md §9）：
//   1. 合并范围**写死为 dist/ public/ config/**。82 条新增全部落在这三个目录里，
//      而必须排除的 3 条运行态文件（nawu-fetch/chatgpt-config.json、lib/nawu-inventory.cjs、
//      自动化 memory.md）都在 nawu-fetch/ —— 用「目录白名单」而不是「文件黑名单」，
//      这样将来 navwu-fetch 里再冒出什么运行态文件也不会被顺手合进去。
//   2. 绝不按目录 cp -r。按文件逐个 copy，源与目标都先 resolve，越界即中止。
//   3. 脚本**不启停任何服务**。:3000 在监听时直接拒绝 --apply，交给操作者自己停。
//      （停生产服务是人的决定，不是脚本的副作用。）
//
// 用法：
//   node scripts/a2-merge.mjs                     # 演练，打印计划
//   node scripts/a2-merge.mjs --apply             # 执行（需 :3000 已停）
//   node scripts/a2-merge.mjs --rollback <manifest.json>          # 回滚
//   node scripts/a2-merge.mjs --rollback <manifest.json> --apply  # 真回滚
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const MAIN = process.env.A2_MAIN_ROOT ?? "F:/yikuaborder-deploy";
const SHADOW = process.env.A2_SHADOW_ROOT ?? "F:/yikuaborder-shadow-merge";
const BACKUP_ROOT = process.env.A2_BACKUP_ROOT ?? "F:/yikuaborder-backups";
const PROD_PORT = Number(process.env.A2_PROD_PORT ?? 3000);

/** 允许合并的顶层目录。新增/覆盖都必须落在这里面。 */
const SCOPE = ["dist", "public", "config"];

/** 即使落在 SCOPE 内也不合：这些要么是运行态、要么是密钥。命中即跳过并记在 skipped 里。
 *  注意 secret 那条必须带分隔符边界：早一版写成 `[^/]*secret[^/]*` 会把 `secretary-model.js`
 *  也拦下（"secret" 是 "secretary" 的前缀），而它恰恰是被 server.js 依赖的正文代码，
 *  漏合就会变成运行期 ERR_MODULE_NOT_FOUND。 */
const DENY = [
  /(^|\/)node_modules\//,
  /(^|\/)\.env(\.|$)/i,
  /(^|[/._-])(credentials?|tokens?|secrets?|private-key|api-?key)([/._-]|$)/i,
  /(^|\/)data\//,
  /(^|\/)output\//,
  /\.(lock|lease\.json|log)$/i,
  /\.(bak|tmp|orig)(-\d{8})?$/i,
  /\.stale-[^/]+$/,
];

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const rbIdx = args.indexOf("--rollback");
const ROLLBACK_OF = rbIdx >= 0 ? args[rbIdx + 1] : null;

const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

async function walk(root, relDir, out) {
  const dir = path.join(root, relDir);
  if (!(await exists(dir))) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(root, relPath, out);
    else if (entry.isFile()) out.push(relPath);
  }
  return out;
}

async function buildPlan() {
  const plan = { add: [], overwrite: [], unchanged: [], skipped: [] };
  for (const scope of SCOPE) {
    const shadowFiles = await walk(SHADOW, scope, []);
    for (const relPath of shadowFiles) {
      if (DENY.some((re) => re.test(relPath))) {
        plan.skipped.push({ path: relPath, reason: "DENY_PATTERN" });
        continue;
      }
      const src = path.join(SHADOW, relPath);
      const dst = path.join(MAIN, relPath);
      const srcAbs = path.resolve(src);
      const dstAbs = path.resolve(dst);
      if (!srcAbs.startsWith(path.resolve(SHADOW) + path.sep) || !dstAbs.startsWith(path.resolve(MAIN) + path.sep)) {
        plan.skipped.push({ path: relPath, reason: "PATH_ESCAPE" });
        continue;
      }
      if (!(await exists(dst))) {
        plan.add.push({ path: relPath, srcSha: await sha256(src) });
        continue;
      }
      const [a, b] = [await sha256(src), await sha256(dst)];
      if (a === b) plan.unchanged.push({ path: relPath });
      else plan.overwrite.push({ path: relPath, srcSha: a, dstSha: b });
    }
  }
  plan.add.sort((x, y) => x.path.localeCompare(y.path));
  plan.overwrite.sort((x, y) => x.path.localeCompare(y.path));
  return plan;
}

/** :3000 是否有人在听。只看端口，不读进程树——脚本不负责判断"该不该停"。 */
function portListening(port, host = "127.0.0.1", timeout = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(true)); // 超时按"占用"处理，fail-closed
    sock.once("error", (e) => done(e?.code !== "ECONNREFUSED"));
  });
}

async function doRollback(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.kind !== "a2-merge") throw new Error(`不是 a2-merge 清单: ${manifest.kind}`);
  console.log(`回滚 ${manifest.appliedAt} 的合并（${manifest.add.length} 新增 / ${manifest.overwrite.length} 覆盖）`);
  if (!APPLY) {
    console.log("[dry-run] 将删除 %d 个新增文件、从 %s 恢复 %d 个覆盖文件", manifest.add.length, manifest.backupDir, manifest.overwrite.length);
    return;
  }
  for (const item of manifest.add) await rm(path.join(MAIN, item.path), { force: true });
  for (const item of manifest.overwrite) {
    const src = path.join(manifest.backupDir, item.path);
    if (!(await exists(src))) throw new Error(`备份缺失，回滚中止: ${item.path}`);
    if ((await sha256(src)) !== item.dstSha) throw new Error(`备份 sha256 不符，回滚中止: ${item.path}`);
    await copyFile(src, path.join(MAIN, item.path));
  }
  console.log(`✅ 回滚完成：删除 ${manifest.add.length} 个、恢复 ${manifest.overwrite.length} 个`);
}

async function main() {
  if (ROLLBACK_OF) {
    await doRollback(ROLLBACK_OF);
    return;
  }

  const plan = await buildPlan();
  console.log(`主目录 ${MAIN}\n影子根 ${SHADOW}\n范围   ${SCOPE.join(" / ")}\n`);
  console.log(`新增 ${plan.add.length}　覆盖 ${plan.overwrite.length}　相同跳过 ${plan.unchanged.length}　被规则拦下 ${plan.skipped.length}`);

  if (plan.overwrite.length) {
    console.log("\n--- 覆盖清单（写前会先备份）---");
    for (const o of plan.overwrite) console.log(`  M ${o.path}`);
  }
  if (plan.skipped.length) {
    console.log("\n--- 被规则拦下 ---");
    for (const s of plan.skipped) console.log(`  x ${s.path}  (${s.reason})`);
  }
  if (!APPLY) {
    console.log("\n[dry-run] 未写盘。加 --apply 执行。");
    return;
  }

  // 写盘前的最后两道闸：端口、以及"计划里有没有跑出 SCOPE 的东西"
  if (await portListening(PROD_PORT)) {
    console.error(`\n拒绝执行：:${PROD_PORT} 仍有监听。请先自行停服——本脚本不启停服务。`);
    process.exit(2);
  }
  if ([...plan.add, ...plan.overwrite].some((f) => !SCOPE.some((s) => f.path.startsWith(s + "/")))) {
    console.error("\n拒绝执行：计划里出现 SCOPE 之外的文件。");
    process.exit(3);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const backupDir = path.join(BACKUP_ROOT, `${stamp}_a2-merge`);
  await mkdir(backupDir, { recursive: true });

  for (const o of plan.overwrite) {
    const src = path.join(MAIN, o.path);
    const dst = path.join(backupDir, o.path);
    if ((await sha256(src)) !== o.dstSha) throw new Error(`覆盖前校验失败（目标已变化，可能有人正在改）: ${o.path}`);
    await mkdir(path.dirname(dst), { recursive: true });
    await copyFile(src, dst);
    if ((await sha256(dst)) !== o.dstSha) throw new Error(`备份校验失败: ${o.path}`);
  }

  for (const item of [...plan.add, ...plan.overwrite]) {
    const dst = path.join(MAIN, item.path);
    await mkdir(path.dirname(dst), { recursive: true });
    await copyFile(path.join(SHADOW, item.path), dst);
  }

  // 写完逐个回读比对，不信"copy 成功"这句话
  const bad = [];
  for (const item of [...plan.add, ...plan.overwrite]) {
    const got = await sha256(path.join(MAIN, item.path));
    if (got !== item.srcSha) bad.push(item.path);
  }
  if (bad.length) {
    console.error(`\n❌ 回读校验失败 ${bad.length} 个：\n  ${bad.join("\n  ")}`);
    console.error(`备份在 ${backupDir}，可用 --rollback 恢复。`);
    process.exit(4);
  }

  const manifest = {
    kind: "a2-merge",
    appliedAt: new Date().toISOString(),
    mainRoot: MAIN,
    shadowRoot: SHADOW,
    scope: SCOPE,
    backupDir,
    add: plan.add,
    overwrite: plan.overwrite,
  };
  const manifestPath = path.join(backupDir, "merge-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1), "utf8");

  console.log(`\n✅ 合并完成：新增 ${plan.add.length}、覆盖 ${plan.overwrite.length}，逐个回读 sha256 全部一致`);
  console.log(`备份与清单：${backupDir}`);
  console.log(`回滚命令：node scripts/a2-merge.mjs --rollback "${manifestPath}" --apply`);
}

main().catch((error) => {
  console.error("合并中止：", error.message);
  process.exit(1);
});
