

## Amazon A+ 套图模式（`--mode a-plus`）

A+ 不是"多几张商品图"，而是一套**有模块结构**的内容：每个模块的图数、像素、图文分工都由
Amazon 规定。因此 A+ 走独立管线，套图逻辑固定在 `config/a-plus-modules.json`，不在代码里另写一套。

### 套图逻辑（先定逻辑，再出图）

1. **模块目录**（来源：Amazon A+ 2026 规格，多源交叉核对）
   | 模块 | 图数 | 像素 | 文案位 |
   |---|---|---|---|
   | hero-banner（Standard Image Header） | 1 | 970×600 | 0 |
   | feature-trio（Three Image & Text） | 3 | 300×300 | 3 |
   | feature-quad-line（Four Image & Text） | 4 | 220×220 | 4 |
   | detail-text-sidebar（Single Image & Sidebar） | 2 | 300×400 + 350×175 | 6 |
   | single-image-highlights | 1 | 300×300 | 2 |
   | image-light-text | 1 | 970×300 | 1 |
   | comparison-chart | ≤5 | 150×300 | 2 |
   | brand-story | 3 | 1464×625 / 362×453 | 3 |
2. **顺序规则**：hero 最前 → 卖点模块 → 细节+详文 → 对比表 → 品牌故事。
3. **模块数 4–6 个**，必须含 hero 与 ≥1 个卖点模块；同类型模块可出现多次。
4. **必须有 hero-banner**；对比表只能对比**自家款式**；缺尺寸/款式数据时禁止用依赖规格的模块。
5. **卖点标题必须是买家问出口的问句**（How/Why/What/Can/Does/Which），正文第一句给答案。
6. **图内不写文案**（文案进 A+ 文案字段，可翻译可编辑）；`image-light-text` 的浅色区可放极短 overlay。
7. 红线：禁价格/折扣/竞品名/联系方式/健康功效/限时表述；JPEG ≤2MB、sRGB、≥72 DPI；移动端优先。

### 管线与产物

S1.5 本地视觉识别（锁 SKU + 反选参考图）→ S_A+1 套图设计（模块编排 + 问句卖点 + 逐图 brief）
→ 逐图出图 → **精确尺寸化**（等比缩放 + 补白到模块像素，绝不拉伸）→ 模块级验收
（图是否讲对该件事 / 图内有无文字 / 是否匹配参考图）。

```
design/a-plus/a-plus-plan.json      套图设计说明（模块顺序、每图 brief、卖点问句）
design/a-plus/a-plus-copy.json       纯文案（标题/副标题/要点），可直接填 A+ 文案字段
design/a-plus/a-plus-qc.json         逐图验收记录（含 source=cloud|local-vl）
design/a-plus/<序号>-<模块>__<槽位>.jpg   成图（尺寸已精确到模块要求）
```

### A+ 专属失败模式

| 编号 | 失败 | 兜底 |
|---|---|---|
| F-25 | 出图时下载到会话里的旧图（配额断供重连后） | md5 去重，重复即重试，连续 2 次相同判失败 |
| F-26 | 精确尺寸化未执行/失败 | 记 `sized.reason` 并判该图失败（不留未达标的尺寸） |
| F-27 | 云端模块验收不返回 JSON | 降级本地视觉模型兜底（只覆盖 SKU/图内文字），标 `source=local-vl` |
