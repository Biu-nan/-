# ChatGPT 视觉规划 Prompt

你现在是一位深谙消费者心理学 VOC、亚马逊电商视觉转化、跨境电商 listing 视觉系统和高转化主图规划的首席视觉总监。 我将提供： 1. 产品图片 2. 风格参考图 3. 产品基础信息 4. Chrome AI 市场视觉调研数据 请先分析，再规划。当前不要直接生成图片。

重要执行规则：

- 如果产品名称、类目、目标平台、目标市场、核心卖点、目标人群、心理动因、销售主体或重要备注仍保留 `{{...}}` 占位符或为空，必须结合本对话已经上传的产品实拍图和下方市场调研报告自行推断。
- 无法确认的事实标记为“不确定 / 待人工确认”，但不得停下来向用户提问。
- 不得要求用户补充变量，不得输出确认清单，不得等待人工回复。
- 必须在本次回复中直接完成 A、B、C 三个部分，并完整输出 Image 01–10 的全部固定边界标记。

---

# 产品基础信息

产品名称：
{{PRODUCT_NAME}}

产品类目：
{{PRODUCT_CATEGORY}}

目标平台：
{{TARGET_PLATFORM}}

目标市场：
{{TARGET_MARKET}}

核心卖点：
{{CORE_SELLING_POINTS}}

目标人群：
{{TARGET_AUDIENCE}}

心理动因：
{{BUYER_PSYCHOLOGY}}

销售主体：
{{SELLING_SUBJECT}}

重要备注：
{{IMPORTANT_NOTES}}

Chrome AI 市场视觉调研数据：
<<<CHROME_AI_REPORT_START>>>
{{CHROME_AI_REPORT}}
<<<CHROME_AI_REPORT_END>>>

---

# 最高优先级 1｜Product Identity Lock

请严格执行：

1. 上传产品图是销售主体的唯一视觉真相。
2. 产品必须与上传图一致，包括：
   - shape
   - structure
   - material
   - color
   - surface texture
   - visible details
   - accessory placement
   - pocket / zipper / seam position
   - edge finishing
   - overall silhouette
3. 不允许新增、删除、简化或修改上传图中不存在的产品结构。
4. 风格参考图只控制：
   - background
   - layout
   - lighting
   - typography
   - icon style
   - visual mood
5. 竞品数据只用于：
   - pain point discovery
   - visual strategy
   - listing logic
   - conversion opportunity
6. 参考包、道具、模特、包装、场景只作为辅助元素。
7. 严禁货不对板。

---

# 最高优先级 2｜Market-Validated Style Lock

视觉风格不能基于主观想象。

请优先依据 Chrome AI 提供的 Top 10 高表现 listing 数据，提取：
- 出现频率最高的背景风格
- 出现频率最高的颜色系统
- 出现频率最高的主图构图
- 出现频率最高的字体风格
- 出现频率最高的 icon 风格
- 出现频率最高的信息密度
- 出现频率最高的图片顺序
- 高频购买痛点
- 高频购买动机

请将视觉决策分为：

## Must Follow

市场中高频出现、已经被验证、应优先保留的视觉元素。

## Can Optimize

市场常见但存在同质化，可以在不偏离主流的前提下优化的元素。

## Must Avoid

低质感、误导性强、与目标受众不符、可能导致货不对板的元素。

执行比例：
- 70%–80% 保留类目主流视觉习惯
- 20%–30% 做有限差异化优化

允许优化：
- 更高级的配色
- 更清晰的排版
- 更好的留白
- 更准确的卖点表达
- 更美观的光影
- 更符合当前产品真实结构的展示

不允许：
- 凭空发明风格
- 脱离市场主流
- 为了好看改变产品结构
- 复制竞品 logo 或品牌元素
- 把竞品外观融合进当前产品

如果数据不足或存在冲突，请明确标注：
“不确定 / 待验证”。

---

# 任务 1｜Immutable Product Checklist

请基于上传产品图输出：

- Product name:
- Selling subject:
- Main material:
- Main color:
- Secondary colors:
- Overall shape / silhouette:
- Exact visible structure:
- Visible details:
- Surface texture:
- Accessories / packaging if shown:
- Hard constraints:
- Allowed scene support only:
- Must not be copied from style reference:
- Must not be copied from competitors:

---

# 任务 2｜Market Visual Baseline

请基于 Chrome AI 数据输出：

- Most common visual style:
- Most common color mood:
- Most common hero composition:
- Most common background style:
- Most common typography:
- Most common icon system:
- Most common information density:
- Most common image sequence:
- Top buyer pain points:
- Top buyer motivations:

并输出：

## Must Follow

## Can Optimize

## Must Avoid

## Uncertain / Need Confirmation

---

# 任务 3｜产品视觉情报报告

请输出：

## 视觉深度解析

- 核心材质：
- 结构特点：
- 色彩搭配：
- 可用于视觉表达的真实产品细节：

## 卖点视觉化映射

请将核心卖点和心理动因转化为 3 个可视化物理特征。

每个映射包含：
- 对应卖点：
- 对应心理动因：
- 可视化物理特征：
- 推荐构图：
- 必须出现的元素：
- 必须避免的误导元素：
- 建议使用的图片序号：

## 消费场景构建

请构建 2 个高转化场景。

每个场景包含：
- 场景名称：
- 适合目标人群：
- 用户心理：
- 环境背景设定：
- 光影氛围要求：
- 产品放置方式：
- 推荐道具：
- 应避免元素：
- 适合表达的核心卖点：

---

# 任务 4｜10 张高转化主图规划

请根据 Market Visual Baseline 规划 10 张图。

注意：
- 风格必须符合真实市场样本
- 风格必须统一，但不能单调
- 颜色可以鲜艳、高级、美丽
- 不要默认使用白底极简风
- 不要凭空决定颜色和版式
- 每张图必须独立 3:4 竖版
- 图片中文字必须使用英文
- 每张图只表达一个核心卖点
- 产品结构必须始终一致

建议 10 图动线：
1. Image 1｜Hero Hook：一眼抓住产品价值
2. Image 2｜Pain Point / Emotional Trigger：痛点或情绪共鸣
3. Image 3｜Core Feature Proof：核心功能证明
4. Image 4｜Material / Texture Detail：材质与触感细节
5. Image 5｜Use Demo / How It Works：使用演示
6. Image 6｜Benefit Infographic：核心收益信息图
7. Image 7｜Package / Gift / Variant：包装、礼品感或款式展示
8. Image 8｜Lifestyle Scene 1：高频使用场景
9. Image 9｜Lifestyle Scene 2：情绪价值场景
10. Image 10｜Final Trust Summary：购买理由总结

如该类目 Top 10 的高频图片顺序明显不同，请优先采用市场验证后的顺序，并说明调整原因。

---

# 输出格式

请输出三个部分：

## A. 产品视觉情报报告

包含：
1. Immutable Product Checklist
2. Market Visual Baseline
3. 视觉深度解析
4. 卖点视觉化映射
5. 消费场景构建

## B. 10 张高转化主图视觉动线规划表

请用 Markdown 表格输出：

| Image Number | Funnel Stage | Buyer Psychology | Core Selling Point | Market Evidence | Visual Style Direction | Visual Composition | Product Placement | Background & Lighting | English Copy on Image | AI Image Generation Prompt |
|---|---|---|---|---|---|---|---|---|---|---|

要求：
- Market Evidence 必须说明该图引用了哪些 Top 10 高频视觉元素或 VOC 痛点
- English Copy on Image 必须是完整英文文案
- AI Image Generation Prompt 必须是英文
- 每张图 Prompt 开头必须包含：
  "The product being sold must exactly match the uploaded product images. Do not alter the shape, structure, material, color, or visible product details. Any prop, model, environment, packaging, or style reference is secondary only and must not change the product."
- 每张图只表达一个核心卖点
- 10 张图之间必须有清晰递进
- 不要直接生成图片

## C. Single Image Prompt Pack

请为 Image 1–10 输出完整可直接执行的单张生图 Prompt。

每一张图必须按以下格式：

## Image 【编号】｜【图片名称】｜Ready-to-Generate Prompt

请生成 1 张独立 3:4 竖版电商 listing 图片。

### Product Identity Lock

- The uploaded product images are the only source of truth for the product being sold.
- The product being sold must exactly match the uploaded product images.
- Do not alter the shape, structure, material, color, visible details, or overall silhouette.
- Style reference images only control background, layout, lighting, typography, icon style, and overall visual mood.
- Competitor research only informs strategy and must not change the product design.
- Any prop, model, environment, packaging, or reference object is secondary only and must not change the selling product.
- The selling subject is: 【填写销售主体】.
- Avoid all product mismatch risks.

### Market-Validated Style Lock

- The visual style must follow the Top 10 market visual baseline.
- Preserve the most common category visual habits.
- Use only limited optimization for color, layout, lighting, and clarity.
- Do not invent a style direction unsupported by market samples.

### Style

- Recommended visual style direction:
- Color mood:
- Background style:
- Typography style:
- Icon / graphic style:
- Prop style:
- Information density:

### Image Task

- Funnel Stage:
- Buyer Psychology:
- Core Selling Point:
- Market Evidence:
- Visual Composition:
- Product Placement:
- Background & Lighting:
- English Copy on Image:
- Final Image Generation Prompt:

### Rules

- Only generate this one image.
- Do not generate multiple unrelated products.
- Do not create extra product structures.
- Do not change the product color.
- Do not add Chinese text.
- Use only the English copy provided above.
- Keep the product visually consistent with the uploaded product images.

请为 Image 1–10 分别输出完整 Prompt。
每条 Prompt 必须完整可复制执行，不需要我再手动填模板。
当前不要直接生成图片。

# 固定边界标记输出规则

每一张 Ready-to-Generate Prompt 必须使用固定边界标记包裹。

<<<IMAGE_01_PROMPT_START>>>
【Image 1 完整 Prompt】
<<<IMAGE_01_PROMPT_END>>>

<<<IMAGE_02_PROMPT_START>>>
【Image 2 完整 Prompt】
<<<IMAGE_02_PROMPT_END>>>

<<<IMAGE_03_PROMPT_START>>>
【Image 3 完整 Prompt】
<<<IMAGE_03_PROMPT_END>>>

<<<IMAGE_04_PROMPT_START>>>
【Image 4 完整 Prompt】
<<<IMAGE_04_PROMPT_END>>>

<<<IMAGE_05_PROMPT_START>>>
【Image 5 完整 Prompt】
<<<IMAGE_05_PROMPT_END>>>

<<<IMAGE_06_PROMPT_START>>>
【Image 6 完整 Prompt】
<<<IMAGE_06_PROMPT_END>>>

<<<IMAGE_07_PROMPT_START>>>
【Image 7 完整 Prompt】
<<<IMAGE_07_PROMPT_END>>>

<<<IMAGE_08_PROMPT_START>>>
【Image 8 完整 Prompt】
<<<IMAGE_08_PROMPT_END>>>

<<<IMAGE_09_PROMPT_START>>>
【Image 9 完整 Prompt】
<<<IMAGE_09_PROMPT_END>>>

<<<IMAGE_10_PROMPT_START>>>
【Image 10 完整 Prompt】
<<<IMAGE_10_PROMPT_END>>>

要求：
- 固定标记必须独占一行
- START 和 END 必须成对
- 编号必须从 01 到 10
- 每个区块中必须输出完整单图 Prompt
- 不允许缺失
- 不允许重复编号
