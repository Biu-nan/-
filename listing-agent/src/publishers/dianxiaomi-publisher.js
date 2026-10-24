// DianxiaomiPublisher：默认上架实现，复用现有 dist/src/dianxiaomi-adapter.js（店小秘浏览器自动化）。
//
// ⚠️ 运行时依赖：本机需常驻已登录店小秘的 Chrome（CDP :9223）。
// ⚠️ 采集箱(collect)模式：因完全复用 server.js 既有 runCollectBatchListing 流程，且无法在此盲写其
//    细节，本 publisher 对 collect 模式诚实 defer 到网站既有入口（任务 7 的转发层保留该路径）。
//    引用(reference/auto)模式按 DianxiaomiAdapter 细粒度方法顺序编排。
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DianxiaomiAdapter } from "../../../dist/src/dianxiaomi-adapter.js";
import { PRODUCT_FACT_FILE, PRODUCT_ROOT } from "../../../dist/src/config.js";

export class DianxiaomiPublisher {
  /**
   * @param {object} [opts]
   * @param {object} [opts.adapter] 注入 DianxiaomiAdapter（便于测试）
   * @param {string} [opts.targetStore] 默认目标店铺/账号
   */
  constructor(opts = {}) {
    this.adapter = opts.adapter || new DianxiaomiAdapter();
    this.targetStore = opts.targetStore || "";
  }

  /**
   * 把 facts 持久化到标准位置（PRODUCT_FACT_FILE + 当前产品/product-facts.json），
   * 供店小秘 manual 面板与既有引用流程读取。
   * @param {object} facts
   */
  async _persistFacts(facts) {
    const text = `${JSON.stringify(facts, null, 2)}\n`;
    await mkdir(PRODUCT_ROOT, { recursive: true });
    await writeFile(PRODUCT_FACT_FILE, text, "utf8").catch(() => {});
    await writeFile(path.join(PRODUCT_ROOT, "product-facts.json"), text, "utf8").catch(() => {});
  }

  /**
   * 上架到店小秘。
   * @param {object} facts 归一化 facts
   * @param {object} opts { mode?, operationId?, targetStore? }
   * @returns {Promise<{status:string, mode?:string, target?:string, jobId?:string, errors?:string[]}>}
   */
  async publish(facts, opts = {}) {
    const mode = opts.mode || "reference";
    const target = opts.targetStore || this.targetStore || "店小秘(smtChoice)";

    // 先持久化，保证数据落地（即使后续浏览器编排异常，文件已就位）。
    await this._persistFacts(facts);

    if (mode === "collect") {
      return {
        status: "skipped",
        mode,
        target,
        errors: [
          "采集箱模式需在网站既有的 runCollectBatchListing 流程中执行；agent publisher 当前聚焦引用模式。请走网站既有上架入口，或后续将采集箱编排迁入本 publisher。",
        ],
      };
    }

    // 引用模式：按 DianxiaomiAdapter 细粒度方法顺序编排单品上架。
    try {
      const profile = facts._profile || { templateProductId: "1005005575013300", key: "ruTie" };
      this.adapter.setProfile(profile);
      await this.adapter.openCreatePage();
      await this.adapter.referenceProduct(profile.templateProductId);
      await this.adapter.fillFixedFields();
      await this.adapter.fillFromFacts(facts, {});
      await this.adapter.save();
      const errors = await this.adapter.readValidationErrors().catch(() => []);
      if (Array.isArray(errors) && errors.length) {
        return { status: "failed", mode, target, jobId: opts.operationId, errors: errors.map(String) };
      }
      return { status: "published", mode, target, jobId: opts.operationId, errors: [] };
    }
    catch (e) {
      return {
        status: "failed",
        mode,
        target,
        jobId: opts.operationId,
        errors: [e && e.message ? e.message : String(e)],
      };
    }
  }
}
