#!/usr/bin/env node
// agents/ae-product-design/src/cli.js
// 用法见 ../README.md。必须在项目根目录执行（dist/src/config.js 以 process.cwd() 为根）。

import { access } from "node:fs/promises";
import path from "node:path";
import { recordBenchmark } from "./benchmark.js";
import { runAgent } from "./runner.js";
import { ModelClient } from "./model.js";
import { Tracer } from "../../_shared/trace.js";
import { CHROME_DEBUG_PORT, CHROME_PROFILE_DIR } from "../../../dist/src/config.js";

const HELP = `
速卖通产品设计 Agent · ae-product-design

  node agents/ae-product-design/src/cli.js --product "<产品目录>" [选项]

必填
  --product <dir>              产品目录（含 产品图/ 与 product-facts.json）

输入
  --facts <file>               指定 facts 文件（默认 product-facts.json → product-profile.json）
  --slots <file>               覆盖槽位配置（默认 config/image-slots.json）
  --keywords "a,b"             手动指定英文检索词（facts 为中文时必用）
  --category-key <key>         风格缓存键（默认取 facts.category）

风格
  --style-refs <dir>           人工参考图目录（给则完全跳过联网抓取）
  --series <id>                直接指定风格系列，跳过交互闸门
  --auto                       放行推荐系列（O1，无人值守）
  --reuse-dossier              复用 design/style-dossier.json
  --reuse-refs                 复用 design/style-refs/ 里已下载的竞品图（不重新抓取）
  --allow-research-fallback    双源调研全败时用内置风格库降级
  --max-refs <n>               单源抓取上限（默认 8，硬上限 12）
  --product-images <n>         单次出图上传的产品参考图数（默认 3；附件限额时改 1）

出图与验收
  --out <dir>                  输出目录（默认 <产品目录>/design）
  --skip-slots "P6"            跳过指定槽位（如类目无配件/无款式差异，不为凑数重复图片）
  --no-vision-qc               只做比例/尺寸校验（视觉项标 unverified）
  --resume                     从 run-state.json 续跑（跳过已完成槽位）
  --dry-run                    只跑到 prompt-pack，不联网不出图，用于冒烟
  --mode <mode>                market（默认，商品图套图）| a-plus（Amazon A+ 套图）
  --aplus-modules <ids>        只执行指定 A+ 模块（逗号分隔，试点用）
  --aplus-max-images <n>       A+ 最多出图张数（试点用）
  --reuse-plan                 复用已有的 a-plus-plan.json（省一次模型调用）
  --preflight                  只检查 Chrome/CDP 与 ChatGPT 登录态，不出图
  --trace-content              在 trace 里落完整 prompt（默认只落哈希）

上线后回填真实数据（唯一经营结果是 1000×CTR×CVR）
  --record-result '{"slotId":"P1","impressions":12000,"clicks":360,"orders":18,
                    "country":"US","trafficSource":"search","priceBand":"10-20",
                    "baseline":{"impressions":12000,"clicks":240,"orders":12}}'

示例
  node agents/ae-product-design/src/cli.js --product "当前产品" --keywords "makeup bag organizer" --auto
  node agents/ae-product-design/src/cli.js --product "当前产品" --record-result '{"slotId":"P1","impressions":10000,"clicks":300,"orders":15}'
`;

function parseArgs(argv) {
  const opts = { keywords: [], visionQc: true };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} 缺少参数值`);
      i += 1;
      return value;
    };
    switch (arg) {
      case "--product": opts.productDir = next(); break;
      case "--facts": opts.factsFile = next(); break;
      case "--slots": opts.slotsFile = next(); break;
      case "--out": opts.outDir = next(); break;
      case "--style-refs": opts.styleRefsDir = next(); break;
      case "--keywords": opts.keywords = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--category-key": opts.categoryKey = next(); break;
      case "--series": opts.series = next(); break;
      case "--max-refs": opts.maxRefs = Number(next()); break;
      case "--product-images": opts.productImageLimit = Number(next()); break;
      case "--skip-slots": opts.skipSlots = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--record-result": opts.recordResult = next(); break;
      case "--auto": opts.autoApprove = true; break;
      case "--resume": opts.resume = true; break;
      case "--reuse-dossier": opts.reuseDossier = true; break;
      case "--reuse-refs": opts.reuseRefs = true; break;
      case "--allow-research-fallback": opts.allowResearchFallback = true; break;
      case "--no-vision-qc": opts.visionQc = false; break;
      case "--dry-run": opts.dryRun = true; break;
      case "--mode": opts.mode = next(); break;
      case "--aplus-modules": opts.aplusModules = next(); break;
      case "--aplus-max-images": opts.aplusMaxImages = Number(next()); break;
      case "--reuse-plan": opts.reusePlan = true; break;
      case "--preflight": opts.preflight = true; break;
      case "--trace-content": opts.traceContent = true; break;
      case "--help":
      case "-h": opts.help = true; break;
      default: throw new Error(`未知参数：${arg}`);
    }
  }
  return opts;
}

function printResult(result) {
  const { report, error } = result;
  console.log("");
  console.log("═".repeat(64));
  console.log(`状态：${report.status.toUpperCase()}   风格来源：${report.styleSource ?? "-"}   采用系列：${report.styleSeriesChosen ?? "-"}`);
  console.log(`产出：${report.counts.delivered}/${report.counts.requested} 张，QC 通过 ${report.counts.qcPassed} 张`);
  console.log(`预算：模型调用 ${report.budget?.modelCalls ?? 0} 次，出图 ${report.budget?.imageGenerations ?? 0} 次，耗时 ${Math.round((report.budget?.elapsedMs ?? 0) / 1000)}s`);
  if (report.heroScore) {
    const mark = report.heroScore.pass === false ? "  ⚠ 未达阈值" : "";
    console.log(`首图 100 分：${report.heroScore.total}/100（阈值 ${report.heroScore.threshold}）${mark}`);
  }
  const bench = report.benchmark?.slots;
  if (bench && Object.keys(bench).length) {
    console.log("");
    console.log("上线回填（1000×CTR×CVR）：");
    for (const [slotId, item] of Object.entries(bench)) {
      const delta = item.deltaVsBaseline?.ordersPer1000Exposures;
      const cmp = delta === undefined || delta === null ? "无基线" : `${delta >= 0 ? "+" : ""}${delta}`;
      console.log(`  ${slotId.padEnd(5)} 每千次曝光成交 ${item.ordersPer1000Exposures}（对基线 ${cmp}）`);
    }
  }
  if (report.slots?.length) {
    console.log("");
    console.log("槽位                 尝试  QC         文件");
    for (const slot of report.slots) {
      const qc = slot.qc?.verdict ?? "-";
      console.log(
        `${String(slot.id).padEnd(20)} ${String(slot.attempts ?? 0).padEnd(5)} ${String(qc).padEnd(11)} ${slot.file ?? "-"}`,
      );
      if (slot.qc?.reason) console.log(`${" ".repeat(22)}原因：${slot.qc.reason}`);
    }
  }
  if (report.warnings?.length) {
    console.log("");
    console.log("告警：");
    for (const w of report.warnings) console.log(`  · ${w}`);
  }
  if (error) {
    console.log("");
    console.log(`错误 [${error.code}] ${error.message}`);
  }
  console.log("");
  console.log(`输出目录：${report.outDir}`);
  console.log("═".repeat(64));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exit(1);
  }
  if (opts.help || !opts.productDir) {
    console.log(HELP);
    process.exit(opts.help ? 0 : 1);
  }

  // config.js 以 cwd 为项目根，跑错目录会让 Chrome/产物路径全线偏移
  const atRoot = await access(path.join(process.cwd(), "dist", "src", "chatgpt-adapter.js"))
    .then(() => true)
    .catch(() => false);
  if (!atRoot) {
    console.error(`请在项目根目录执行（当前 cwd=${process.cwd()}），否则复用不到 dist/src 的适配器。`);
    process.exit(1);
  }

  // Amazon A+ 套图模式：独立的套图逻辑（模块编排 + 问句卖点 + 精确像素）
  if (opts.mode === "a-plus") {
    const { runAplus } = await import("./a-plus-runner.js");
    const { Tracer: T } = await import("../../_shared/trace.js");
    const { ModelClient: M } = await import("./model.js");
    const tracer = new T({
      file: path.join(path.resolve(opts.outDir ?? path.join(path.resolve(opts.productDir), "design")), "trace.jsonl"),
      runId: `aplus-${Date.now()}`,
      agentId: "ae-product-design",
      principal: "agent:ae-product-design@local",
      delegatedBy: "human:lance@local",
    });
    const model = new M({ tracer });
    const result = await runAplus({
      productDir: path.resolve(opts.productDir),
      outDir: path.resolve(opts.outDir ?? path.join(path.resolve(opts.productDir), "design")),
      model,
      tracer,
      opts,
    });
    console.log("=".repeat(60));
    console.log(`A+ 套图：${result.passed}/${result.total} 张通过模块验收`);
    console.log(`模块编排：${result.plan.modules.map((m) => m.moduleId).join(" → ")}`);
    for (const r of result.results) {
      console.log(
        `${(r.module + "/" + r.slot).padEnd(28)} ${(r.qc?.verdict ?? r.error?.code ?? "?").padEnd(8)} ${(r.requiredSize ?? []).join("x")}`,
      );
    }
    console.log(`输出目录：${result.outDir}`);
    console.log("=".repeat(60));
    process.exit(result.passed === result.total ? 0 : 2);
  }

  // 预检：只验 Chrome/CDP 与 ChatGPT 登录态，不出图、不写产物
  if (opts.preflight) {
    const outDir = path.resolve(opts.outDir ?? path.join(path.resolve(opts.productDir), "design"));
    const tracer = new Tracer({
      file: path.join(outDir, "trace.jsonl"),
      runId: `preflight-${Date.now()}`,
      agentId: "ae-product-design",
      principal: "agent:ae-product-design@local",
      delegatedBy: "human:lance@local",
    });
    console.log(`CDP 端口：${CHROME_DEBUG_PORT}`);
    console.log(`独立 profile：${CHROME_PROFILE_DIR}`);
    try {
      const model = new ModelClient({ tracer });
      const health = await model.healthCheck();
      console.log(`状态：可用 ✓  ${health?.url ? `url=${health.url}` : ""}`);
      process.exit(0);
    } catch (error) {
      console.error(`状态：不可用 ✗  [${error?.code ?? "E_UNKNOWN"}] ${error?.message ?? error}`);
      console.error("处理：在弹出的 Chrome 窗口里手动登录 ChatGPT / 过完人机验证，然后重跑同一命令。");
      process.exit(1);
    }
  }

  // 回填上线真实数据：只写 benchmark.jsonl，不触发出图
  if (opts.recordResult) {
    let payload;
    try {
      payload = JSON.parse(opts.recordResult);
    } catch (error) {
      console.error(`--record-result 不是合法 JSON：${error.message}`);
      process.exit(1);
    }
    const outDir = path.resolve(opts.outDir ?? path.join(path.resolve(opts.productDir), "design"));
    const record = await recordBenchmark(outDir, payload);
    console.log(JSON.stringify(record, null, 2));
    console.log(`\n已写入 ${path.join(outDir, "benchmark.jsonl")}`);
    process.exit(0);
  }

  const result = await runAgent(opts).catch((error) => {
    console.error("");
    console.error(`启动前校验失败 [${error?.code ?? "E_UNKNOWN"}] ${error?.message ?? error}`);
    if (error?.details) console.error(JSON.stringify(error.details, null, 2));
    process.exit(1);
  });
  printResult(result);
  if (result.status === "completed") process.exit(0);
  if (result.status === "partial") process.exit(2);
  process.exit(1);
}

main().catch((error) => {
  console.error(`未捕获异常：${error?.stack ?? error}`);
  process.exit(1);
});
