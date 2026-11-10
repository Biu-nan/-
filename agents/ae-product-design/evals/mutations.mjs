#!/usr/bin/env node
/**
 * 上品 Agent 离线评测的变异测试（D3b 配套）
 *
 * 为什么要这个文件
 * ----------------
 * D1b 那次踩过：一条测试永远绿，因为它的断言根本不可能失败。
 * `run-offline.mjs` 现在是 123 条断言全绿，但"全绿"本身不是证据——
 * 除非能证明把它保护的东西破坏掉之后，它会变红。
 *
 * 做法
 * ----
 * 1. 把 agents/_shared 与 agents/ae-product-design 复制到 <repo>/.eval-mutants/
 *    （目录深度与 agents/ 相同，所以 `../../_shared`、`../../../dist` 全部照旧解析）
 * 2. 逐条注入已知缺陷（改字符串，不跑 codemod）
 * 3. 跑那份副本的 run-offline.mjs，要求退出码为 1，且指定的用例出现在 FAIL 列表里
 * 4. 恢复原文件，下一条
 *
 * 结论口径
 * --------
 * CAUGHT       断言抓住了缺陷 → 这条断言是真的
 * MISSED       缺陷注入成功但套件仍然全绿 → 断言是假的，必须修
 * INAPPLICABLE 变异串在源码里找不到 → 是我的变异脚本坏了，同样算失败（防止"变异没生效"冒充"没抓到"）
 *
 * 用法：node agents/ae-product-design/evals/mutations.mjs [--only <substr>] [--keep]
 * 退出码：0 = 全部 CAUGHT；1 = 有 MISSED / INAPPLICABLE
 *
 * 只写 .eval-mutants/ 这个临时目录，跑完删除；不碰 agents/ 下任何真实文件。
 */

import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

const AGENT_DIR = path.join(import.meta.dirname, "..");
const AGENTS_ROOT = path.join(AGENT_DIR, "..");
const REPO_ROOT = path.join(AGENTS_ROOT, "..");
// WORK 是真仓库根的镜像：源码里有 `../../../dist/...`（从 evals/ 上三级到根），
// 所以 WORK 里必须同时有 agents/ 与 dist/ 两棵子树，且层级与真仓库一致。
// 少一层或平铺都会让 `../../../dist/` 解析回真仓库——变异打在副本、被测代码读真身，
// 结果全部 CAUGHT 变成假绿（D3 迁移时实测过这个坑）。
// 目录名带 pid：两个实例共用同一个工作树时，一边 rm/cp 一边被另一边读，
// 会出现"整轮挂死"且不可复现——这类竞争没有意义，直接从命名上隔离掉。
const WORK = path.join(REPO_ROOT, `.eval-mutants-${process.pid}`);
// 干净副本放系统临时区（只读用，深度无所谓）
const PRISTINE = path.join(os.tmpdir(), "aepd-mutants-pristine");

// =====================================================================
// 变异清单
// file 相对于 agents/ 目录；find 必须唯一命中，否则判 INAPPLICABLE
// =====================================================================
const MUTATIONS = [
  {
    id: "mk2-ratio-check-off",
    file: "agents/ae-product-design/src/image-info.js",
    find: "if (delta > tolerance) {",
    replace: "if (false) {",
    expect: ["failure-mk2-square-instead-of-3x4"],
    note: "关掉比例偏差检查（MK2 出成方形不再被拦）",
  },
  {
    id: "min-width-check-off",
    file: "agents/ae-product-design/src/image-info.js",
    find: "if (spec.minWidth && info.width < spec.minWidth)",
    replace: "if (false)",
    expect: ["regression-upscale-detected"],
    note: "关掉 800px 下限（780×780 冒充合格商品图）",
  },
  {
    id: "hero-floor-off",
    file: "dist/src/agent-shared/schemas.js",
    find: "if (dim.score < floor)",
    replace: "if (false)",
    expect: ["failure-hero-score-below-threshold"],
    note: "取消单项下限（识别度 12/25 也能过）",
  },
  {
    id: "hero-total-tolerance-open",
    file: "dist/src/agent-shared/schemas.js",
    find: "if (Math.abs(payload.total - sum) > 0.51)",
    replace: "if (false)",
    expect: ["failure-hero-score-tampered"],
    note: "不再校验总分=分项和（自评注水放行）",
  },
  {
    id: "benchmark-degrade-to-ctr",
    file: "agents/ae-product-design/src/benchmark.js",
    find: "Number((1000 * ctr * cvr).toFixed(4))",
    replace: "Number((1000 * ctr).toFixed(4))",
    expect: ["regression-benchmark-math"],
    note: "把「每千次曝光成交单量」退化成只看 CTR",
  },
  {
    id: "redaction-off",
    file: "dist/src/agent-shared/permissions.js",
    find: "const SENSITIVE_KEY = /(supplier|vendor|factory|cost|profit|margin|佣金|成本|采购|进价|利润|供应商|工厂|毛利)/i;",
    replace: "const SENSITIVE_KEY = /__never_matches_anything__/i;",
    expect: ["failure-sensitive-egress"],
    note: "关闭敏感字段剔除（供应商/成本被发给外部模型）",
  },
  {
    id: "qc-verdict-never-fail",
    file: "agents/ae-product-design/src/qc.js",
    find: 'const verdict = reasons.length ? "fail" : slot.scoring && !thumbnail ? "unverified" : "pass";',
    replace: 'const verdict = false ? "fail" : slot.scoring && !thumbnail ? "unverified" : "pass";',
    expect: ["failure-hero-score-below-threshold", "failure-text-on-marketing-image"],
    note: "有失败理由也不判 fail",
  },
  {
    id: "scope-guard-off",
    file: "dist/src/agent-shared/permissions.js",
    find: "if (t !== r && !t.startsWith(r.endsWith(\"/\") ? r : r + \"/\")) {",
    replace: "if (false) {",
    expect: ["failure-scope-violation"],
    note: "关闭越界写保护",
  },
  {
    id: "empty-product-tolerated",
    file: "agents/ae-product-design/src/inputs.js",
    // 锚点必须是唯一行。`if (images.length === 0) {` 在 inputs.js 里出现两次
    // （一次是「产品图/ 不存在就退回根目录」，一次是「一张都没有就报错」），
    // 拿它做锚点会改错地方。直接改唯一的那句 throw。
    find: "throw new AgentError(CODES.INPUT_IMAGES, `产品目录下没有任何可用图片：${dir}`, { productDir: dir });",
    replace: "/* mutated: 无图也放行 */",
    expect: ["failure-no-product-images"],
    note: "无产品图仍然开跑（会烧 30 分钟产出无关图）",
  },
  {
    id: "json-truncation-tolerated",
    file: "agents/ae-product-design/src/model.js",
    find: 'throw new AgentError(CODES.MODEL_JSON, "回复中 JSON 未闭合（疑似截断）");',
    replace: "return {};",
    expect: ["failure-json-fence-or-truncated"],
    note: "截断的 JSON 当空对象返回，不报错",
  },
  {
    id: "fallback-claims-real-research",
    file: "agents/ae-product-design/src/planning.js",
    find: 'source: "fallback",',
    replace: 'source: "aliexpress+amazon",',
    expect: ["failure-research-fallback-declared"],
    note: "降级用内置库却自报真实双源调研",
  },
  {
    id: "dryrun-style-source-lie",
    file: "agents/ae-product-design/src/runner.js",
    find: 'report.styleSource = research.styleSource ?? dossier.source ?? "unknown";',
    replace: 'report.styleSource = "aliexpress+amazon";',
    expect: ["golden-dry-run-plumbing", "failure-research-fallback-declared"],
    note: "dry-run 谎报风格来源（把 fallback 说成真实调研）",
  },
  {
    id: "skip-slot-ignored",
    file: "agents/ae-product-design/src/runner.js",
    find: "const requestedSlots = inputs.slots.filter((slot) => !manualSkip.has(slot.id));",
    replace: "const requestedSlots = inputs.slots;",
    expect: ["regression-skip-optional-slot"],
    note: "--skip-slots 失效（照旧给 P6 出图）",
  },
  {
    id: "storyboard-count-unchecked",
    file: "dist/src/agent-shared/schemas.js",
    find: "if (sb.items.length !== slots.length) {",
    replace: "if (false) {",
    expect: ["regression-stale-dossier-reuse"],
    note: "旧 storyboard 条数与槽位配置不符也能复用",
  },
  {
    id: "fit-scale-no-padding",
    file: "agents/ae-product-design/src/fit_scale.py",
    find: "factor = current / target_scale",
    replace: "factor = 1.0",
    expect: ["regression-fit-scale-padding"],
    note: "主体占比超限也不扩画布（90% 主体直接交付）",
  },
  {
    id: "dryrun-calls-model",
    file: "agents/ae-product-design/src/runner.js",
    find: "storyboard = synthesizeStoryboard({ slots: requestedSlots, dossier });",
    replace: "storyboard = await buildStoryboard({ model, slots: requestedSlots, factsText, slotText, dossier, skuLock: skuLockText });",
    expect: ["golden-dry-run-plumbing"],
    note: "dry-run 也走模型分支（离线必须立刻红，而不是悄悄去连浏览器）",
  },
];

// =====================================================================
// 工具
// =====================================================================
async function sh(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      timeout: 120_000,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      ...opts,
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    return { code: error.code ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** 从套件输出里提取失败用例 id */
function parseFailures(out) {
  const ids = new Set();
  for (const line of out.split("\n")) {
    const m = line.match(/^FAIL\s+(\S+)/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

async function buildWorkTree() {
  await rm(WORK, { recursive: true, force: true });
  await rm(PRISTINE, { recursive: true, force: true });
  // WORK 必须是真仓库根的镜像，不能只放变异目标：src/ 里还有
  // `../../../dist/src/chatgpt-adapter.js` 与 `config.js` 这类跨层引用，
  // 少一个文件就会让基线进程直接 ERR_MODULE_NOT_FOUND。
  const MIRROR = ["dist/src", "config", "schemas", "prompts", "public", "package.json"];
  await mkdir(PRISTINE, { recursive: true });
  for (const rel of MIRROR) {
    const to = path.join(PRISTINE, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(path.join(REPO_ROOT, rel), to, { recursive: true });
  }
  await mkdir(path.join(PRISTINE, "agents"), { recursive: true });
  await cp(path.join(AGENTS_ROOT, "ae-product-design"), path.join(PRISTINE, "agents/ae-product-design"), { recursive: true });

  await mkdir(WORK, { recursive: true });
  for (const rel of [...MIRROR, "agents"]) {
    const to = path.join(WORK, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await cp(path.join(PRISTINE, rel), to, { recursive: true });
  }
}

async function restoreOne(targetRel) {
  const from = path.join(PRISTINE, targetRel);
  const to = path.join(WORK, targetRel);
  await rm(to, { force: true });
  await cp(from, to);
}

/**
 * 还原所有可能被改过的文件。
 * 第一版只还原「当前这条变异」的文件，结果上一轮改的 image-info.js 一直带着伤，
 * 后面的变异全都是"因为前面没修好"才变红的——那种 CAUGHT 是假的。
 * 所以每轮开始和结束都做一次全量还原，让每条变异都在干净基线上跑。
 */
async function restoreAll() {
  const files = [...new Set(MUTATIONS.map((m) => m.file))];
  for (const f of files) await restoreOne(f);
}

// =====================================================================
// 主流程
// =====================================================================
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const selected = only ? MUTATIONS.filter((m) => m.id.includes(only)) : MUTATIONS;

// --trace：每个阶段打点，用来定位"到底卡在哪一步"（连跑 16 条时曾整轮挂死）
const TRACE = argv.includes("--trace");
const t0 = Date.now();
const trace = (msg) => {
  if (TRACE) process.stderr.write(`[${String(Date.now() - t0).padStart(6)}ms] ${msg}\n`);
};

console.log(`变异测试：${selected.length} 条\n`);

trace("buildWorkTree 开始");
await buildWorkTree();
trace("buildWorkTree 完成");

// 先做一次基线：未注入缺陷时必须全绿，否则后面所有"抓到"都不可信
const baselineRun = await sh(process.execPath, [path.join(WORK, "agents/ae-product-design/evals/run-offline.mjs")]);
const baselineRed = baselineRun.code !== 0;
if (baselineRed) {
  console.log("基线不干净：未注入缺陷时套件就是红的，变异测试无意义。");
  console.log(baselineRun.out.split("\n").filter((l) => /^FAIL|✗/.test(l)).join("\n"));
  // 崩溃（而非断言失败）时上面过滤不出任何行，必须把原始输出尾巴打出来才能定位。
  console.log("--- 基线进程输出（尾部 30 行）---");
  console.log(baselineRun.out.split("\n").slice(-30).join("\n"));
  await rm(WORK, { recursive: true, force: true });
  process.exit(1);
}
const baselineAssertions = (baselineRun.out.match(/断言 (\d+) 条/) ?? [])[1];
console.log(`基线：全绿（${baselineAssertions} 条断言）\n`);

const rows = [];
for (const mut of selected) {
  const abs = path.join(WORK, mut.file);
  trace(`${mut.id}: 全量还原`);
  await restoreAll();

  const original = await readFile(abs, "utf8");
  const hits = original.split(mut.find).length - 1;
  if (hits !== 1) {
    rows.push({ ...mut, verdict: "INAPPLICABLE", hits, caught: new Set(), exit: null });
    console.log(`␀  ${mut.id.padEnd(30)} 变异串命中 ${hits} 次（要求恰好 1 次）`);
    continue;
  }
  await writeFile(abs, original.replace(mut.find, mut.replace), "utf8");
  trace(`${mut.id}: 注入完成，开始跑套件`);

  let run;
  try {
    run = await sh(process.execPath, [path.join(WORK, "agents/ae-product-design/evals/run-offline.mjs")]);
  } finally {
    trace(`${mut.id}: 套件结束，还原`);
    // 立刻还原，避免把伤带进下一条变异
    await restoreOne(mut.file);
    trace(`${mut.id}: 还原完成`);
  }
  const caught = parseFailures(run.out);
  const expectAll = mut.expect.length === 0
    ? run.code !== 0
    : mut.expect.every((id) => caught.has(id)) && run.code !== 0;

  rows.push({
    ...mut,
    verdict: expectAll ? "CAUGHT" : "MISSED",
    hits,
    caught,
    exit: run.code,
  });

  const mark = expectAll ? "✓" : "✗";
  console.log(
    `${mark}  ${mut.id.padEnd(30)} exit=${String(run.code).padEnd(3)} 抓到 ${[...caught].join(",") || "（无）"}`,
  );
  if (!expectAll && mut.expect.length) {
    const missing = mut.expect.filter((id) => !caught.has(id));
    console.log(`     漏抓：${missing.join(",")}　（${mut.note}）`);
  }
  if (!expectAll && run.code === 0) {
    console.log(`     注入成功但套件仍然全绿 —— 这组断言抓不到这个缺陷（${mut.note}）`);
  }
}

// 收尾：全量还原，确保 work 树干净（--keep 时保留供排查）
await restoreAll();

const caught = rows.filter((r) => r.verdict === "CAUGHT").length;
const missed = rows.filter((r) => r.verdict === "MISSED");
const na = rows.filter((r) => r.verdict === "INAPPLICABLE");

console.log("");
console.log(`共 ${rows.length} 条变异｜抓住 ${caught}｜漏抓 ${missed.length}｜变异未生效 ${na.length}`);
if (missed.length) console.log(`漏抓：${missed.map((m) => m.id).join(", ")}`);
if (na.length) console.log(`变异未生效（脚本问题）：${na.map((m) => m.id).join(", ")}`);

if (!argv.includes("--keep")) {
  await rm(WORK, { recursive: true, force: true });
} else {
  console.log(`\n已保留工作树：${WORK}`);
}

process.exit(missed.length === 0 && na.length === 0 ? 0 : 1);
