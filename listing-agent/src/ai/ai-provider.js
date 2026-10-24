// AIProvider 端口：接口定义 + 内存桩（FakeAIProvider，供单测，无需真实 Chrome）。
//
// 真实实现见 ./chatgpt-provider.js（唯一实现，包装网页版 ChatGPT）。
// agent 核心只认本文件导出的接口形态，不关心底层是网页版还是 API。

/**
 * @typedef {import("../types.js").AIProvider} AIProvider
 */

/**
 * 内存桩 AIProvider：返回结构合法的 facts JSON，用于单测验证 Parse/Generate/Validate 流水线。
 * 按 fingerprint 返回不同内容：
 *  - "FACTS_FILL"：仅补 title/description；
 *  - 其它（FACTS_BRIDGE）：返回一份完整 ruTie facts。
 */
export class FakeAIProvider {
  constructor(opts = {}) {
    this.calls = [];
    this.imageFiles = opts.imageFiles || [];
  }

  async generateText(prompt, fingerprint, ctx = {}) {
    this.calls.push({ kind: "text", fingerprint, ctx });
    if (fingerprint === "FACTS_FILL") {
      return {
        text: JSON.stringify({
          title: { zh: "补中文标题", en: "Nipple Covers Breast Petals Pasties" },
          description: { pc: "补详情 PC", mobile: "补详情 Mobile" },
        }),
      };
    }
    return {
      text: JSON.stringify({
        title: { zh: "[测试] 乳贴 隐形胸贴", en: "Nipple Covers Breast Petals Pasties" },
        category: "内衣配件（乳贴/乳垫/肩带等）(Women's Intimates Accessories)",
        brand: "NONE",
        material: "硅胶(Silicone)",
        keyAttributes: [
          { name: "高关注化学品", value: "天然未处理(None)" },
          { name: "产地（国家或地区）", value: "中国大陆(Origin)(Mainland China)" },
          { name: "是否性暗示", value: "否(No)" },
          { name: "颜色风格", value: "自然色(Natural Color)" },
          { name: "是否暴露图片", value: "否(No)" },
        ],
        variants: {
          dimensions: ["颜色", "尺码"],
          skus: [{ combination: ["肤色", "均码"], stock: 100, price: 3.5, sku: "RUTIE-ST-M", weight: 0.03 }],
        },
        unit: "件(piece)",
        weight: 0.03,
        description: { pc: "测试 PC 详情", mobile: "测试 Mobile 详情" },
        hsCode: "3",
        compliance: { euResponsible: "", trResponsible: "", manufacturer: "" },
        sourceUrl: "",
      }),
    };
  }

  async generateImage(prompt, fingerprint, ctx = {}) {
    this.calls.push({ kind: "image", fingerprint, ctx });
    return { images: this.imageFiles };
  }
}
