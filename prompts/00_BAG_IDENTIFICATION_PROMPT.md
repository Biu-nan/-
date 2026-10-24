# 奢侈包内胆目标外包识别

> 用途：做内胆 listing 的第一步。拿到**一个具体目标奢侈包**的外包图后，识别其品牌、包型家族、尺寸版本候选，并联网核对公开外部尺寸。**不生成内胆尺寸、不生成图片**。
> 触发：`luxury_insert` 流水线的 `identifyBag()` 阶段（stage: `INSERT_IDENTIFYING_BAG`）。
> 落点：识别结果自动回填 `brand / bagFamily / variants / primaryVariantId`，进入 `INSERT_WAITING_BAG_CONFIRMATION` 等待人工确认。
> 镜像来源：`dist/src/luxury-insert-service.js` 中 `IDENTIFICATION_FINGERPRINT` 与 `identifyBag()` 内联 prompt。代码内联字符串为线上生效版本，本文件为对齐 `prompts/` 规范的阅读/迭代参考。

---

请基于上传的目标奢侈包图片识别品牌、包型家族、尺寸版本候选与年份/版本差异，并联网搜索品牌官网、官方产品页或可信尺寸来源核对公开外部尺寸。

要求：

- 图片是包型与外观事实的最高优先级来源。
- 不得把相似包型当成确定事实。
- 一个任务只保留同一包型家族，可列出 Mini/Small/Medium/Large 等多个尺寸候选。
- 每个候选输出长、宽、高（cm）、原始来源尺寸、来源 URL、来源类型、置信度与冲突项。
- 明确推荐市场最主流的一个尺寸作为 Primary SKU，但最终由用户确认。
- 不生成内胆尺寸，不生成图片。

先输出方便人工阅读的结构化 Markdown 报告。

然后必须在回复末尾输出以下固定边界和严格 JSON，不要添加注释，不要省略字段：

<<<BAG_IDENTIFICATION_DATA_START>>>
{
  "brand": "品牌英文名",
  "bagFamily": "包型家族英文名",
  "primaryVariantId": "SKU-2",
  "variants": [
    {
      "id": "SKU-1",
      "label": "Mini",
      "bagDimensions": {
        "length": 18,
        "width": 8,
        "height": 12.5
      },
      "publicSourceUrl": "https://可信来源页面",
      "version": "版本或年份备注",
      "confidence": "High"
    }
  ]
}
<<<BAG_IDENTIFICATION_DATA_END>>>

规则：

- JSON 数值统一为厘米，不要在数值中包含单位。
- variants 只保留同一包型家族中能够获得完整长宽高的候选。
- id 必须唯一且从 SKU-1 顺序编号。
- primaryVariantId 必须与 variants 中一个 id 完全一致。
- 无法确认品牌、包型或完整尺寸时不要猜测，明确说明后仍输出最可靠候选。
