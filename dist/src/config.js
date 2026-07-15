import path from "node:path";
export const PROJECT_ROOT = process.cwd();

// 多用户数据隔离：USER_DATA_DIR 环境变量指定用户数据根目录
// 未设置则默认使用 PROJECT_ROOT
const rawUserDir = process.env.USER_DATA_DIR;
export const USER_DATA_DIR = rawUserDir
    ? path.isAbsolute(rawUserDir)
        ? rawUserDir
        : path.join(PROJECT_ROOT, rawUserDir)
    : PROJECT_ROOT;

export const PRODUCT_ROOT = path.join(USER_DATA_DIR, "当前产品");
export const COMPLETED_PRODUCTS_DIR = path.join(USER_DATA_DIR, "已完成产品");
export const ABANDONED_PRODUCTS_DIR = path.join(USER_DATA_DIR, "已遗弃产品");
export const PRODUCT_PROFILE_FILE = path.join(PRODUCT_ROOT, "product-profile.json");
export const PRODUCT_PROFILE_SCHEMA_FILE = path.join(PROJECT_ROOT, "schemas", "product-profile.schema.json");
export const PRODUCT_PROFILE_LOG_FILE = path.join(USER_DATA_DIR, "product-profile.log");
export const PRODUCT_QUEUE_DIR = path.join(USER_DATA_DIR, "商品队列");
export const PRODUCT_QUEUE_TASKS_DIR = path.join(PRODUCT_QUEUE_DIR, "tasks");
export const PRODUCT_QUEUE_STATE_FILE = path.join(PRODUCT_QUEUE_DIR, "queue-state.json");
export const OPERATION_PROFILES_FILE = path.join(PROJECT_ROOT, "operation-profiles.json");
export const STORE_PROFILES_FILE = path.join(PROJECT_ROOT, "store-profiles.json");
export const LISTING_CARDS_FILE = path.join(PROJECT_ROOT, "listing-cards.json");
export const LISTING_SKU_MAPPINGS_FILE = path.join(PROJECT_ROOT, "listing-sku-mappings.json");
export const PERFORMANCE_SNAPSHOTS_FILE = path.join(PROJECT_ROOT, "performance-snapshots.json");
export const OPERATION_ACTIONS_FILE = path.join(PROJECT_ROOT, "operation-actions.json");
export const OPERATION_RULES_FILE = path.join(PROJECT_ROOT, "operation-rules.json");
export const DATA_COLLECTION_TASKS_FILE = path.join(PROJECT_ROOT, "data-collection-tasks.json");
export const DAILY_WAITING_ITEMS_FILE = path.join(PROJECT_ROOT, "daily-waiting-items.json");
export const OPERATORS_FILE = path.join(PROJECT_ROOT, "operators.json");
export const HIDDEN_DATA_DIR = path.join(USER_DATA_DIR, "data");
export const PRODUCT_VISUAL_ASSETS_DIR = path.join(HIDDEN_DATA_DIR, "product-visual-assets");
export const PRODUCT_VISUAL_ASSETS_FILE = path.join(HIDDEN_DATA_DIR, "product-visual-assets.json");
export const IMAGE_GENERATION_LOG_FILE = path.join(HIDDEN_DATA_DIR, "image-generation-log.jsonl");
export const COMMAND_INBOX_FILE = path.join(HIDDEN_DATA_DIR, "command_inbox.jsonl");
export const EVENT_LOG_FILE = path.join(HIDDEN_DATA_DIR, "event_log.jsonl");
export const QCLAW_TASKS_FILE = path.join(HIDDEN_DATA_DIR, "qclaw_tasks.jsonl");
export const QCLAW_RESULTS_FILE = path.join(HIDDEN_DATA_DIR, "qclaw_results.jsonl");
export const ACTION_LOG_FILE = path.join(HIDDEN_DATA_DIR, "action_log.jsonl");
export const SNAPSHOTS_FILE = path.join(HIDDEN_DATA_DIR, "snapshots.jsonl");
export const REVIEWS_FILE = path.join(HIDDEN_DATA_DIR, "reviews.jsonl");
export const KNOWLEDGE_ITEMS_FILE = path.join(HIDDEN_DATA_DIR, "knowledge_items.jsonl");
export const TASK_STATE_FILE = path.join(HIDDEN_DATA_DIR, "task_state.json");
export const TODAY_DASHBOARD_FILE = path.join(HIDDEN_DATA_DIR, "today_dashboard.json");
export const QCLAW_STATE_FILE = path.join(HIDDEN_DATA_DIR, "qclaw_state.json");
export const PRODUCT_IMAGES_DIR = path.join(PRODUCT_ROOT, "产品图");
export const OUTPUT_DIR = path.join(PRODUCT_ROOT, "output");
export const INSERT_BAG_IMAGES_DIR = path.join(PRODUCT_ROOT, "目标外包图");
export const INSERT_LINER_IMAGES_DIR = path.join(PRODUCT_ROOT, "内胆图");
export const INSERT_OUTPUT_DIR = path.join(PRODUCT_ROOT, "内胆output");
export const PROMPTS_DIR = path.join(PROJECT_ROOT, "prompts");
export const INSERT_PROMPT_FILE = path.join(PROMPTS_DIR, "05_LUXURY_INSERT_PROMPT.md");
export const INSERT_MARKET_RADAR_PROMPT_FILE = path.join(PROMPTS_DIR, "06_INSERT_MARKET_RADAR_PROMPT.md");
export const INSERT_LISTING_CONTENT_PROMPT_FILE = path.join(PROMPTS_DIR, "07_INSERT_LISTING_CONTENT_PROMPT.md");
export const INSERT_STOCK_SHEET_RECORDS_FILE = path.join(PROJECT_ROOT, "insert-stock-sheet-records.json");
export const GOOGLE_SHEETS_WEBHOOK_CONFIG_FILE = path.join(PROJECT_ROOT, "google-sheets-webhook.json");
export const STATE_FILE = path.join(USER_DATA_DIR, "run-state.json");
export const CHROME_PROFILE_DIR = path.join(USER_DATA_DIR, ".chrome-profile");
export const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9223);
export const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
export const RESEARCH_PROMPT_FILE = path.join(PROMPTS_DIR, "01_RESEARCH_PROMPT.md");
export const PLANNING_PROMPT_FILE = path.join(PROMPTS_DIR, "02_VISUAL_PLANNING_PROMPT.md");
export const SEO_KEYWORDS_PROMPT_FILE = path.join(PROMPTS_DIR, "03_SEO_KEYWORDS_PROMPT.md");
export const LISTING_CONTENT_PROMPT_FILE = path.join(PROMPTS_DIR, "04_LISTING_CONTENT_PROMPT.md");
export const MARKET_VISUAL_AUDIT_V2_PROMPT_FILE = path.join(PROMPTS_DIR, "05_MARKET_VISUAL_AUDIT_V2_PROMPT.md");
export const VISUAL_STRATEGY_COMPRESSION_PROMPT_FILE = path.join(PROMPTS_DIR, "06_VISUAL_STRATEGY_COMPRESSION_PROMPT.md");
export const VISUAL_PLANNING_V2_PROMPT_FILE = path.join(PROMPTS_DIR, "07_VISUAL_PLANNING_V2_PROMPT.md");
export const SINGLE_IMAGE_PROMPT_V2_FILE = path.join(PROMPTS_DIR, "08_SINGLE_IMAGE_PROMPT_V2.md");
export const LISTING_IMAGE_QC_PROMPT_FILE = path.join(PROMPTS_DIR, "09_LISTING_IMAGE_QC_PROMPT.md");
export const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? "0.0.0.0";
export const CHATGPT_URL = "https://chatgpt.com/";
export const NOTEBOOKLM_URL = "https://notebooklm.google.com/notebook/e8814b50-af7a-462a-be88-d267b56dbf91";
export const PRODUCT_FACT_PROMPT_FINGERPRINT = "# 产品图片事实提取";
export const TEST_PROMPT = `${PRODUCT_FACT_PROMPT_FINGERPRINT}

请确认你已成功收到本对话上传的全部产品图片，并建立一份供后续市场调研、视觉规划、生图和 Listing 文案直接复用的“产品事实底稿”。

# 事实来源规则

1. 本对话上传的产品实拍图、SKU 图、尺寸图、结构图、材质说明图、包装图和商品参数图，均视为当前可销售产品的信息来源。
2. 图片中清晰可读的文字、数字、单位和参数可以作为商品事实提取，包括尺寸、重量、材质、容量、颜色、SKU、结构、功能、配件和包装内容。
3. 多张图片展示不同颜色、图案、尺寸或款式时，应识别为可见 SKU / 变体，不要默认理解为整套发货。
4. 图片中明确展示且有文字说明的卖点可以记录，但不得扩大解释。例如图片写“防泼水”，不能自行升级成“完全防水”。
5. 纯背景道具、模特、参考包、展示容器、尺子、手机和平板等尺寸参照物，不得默认视为随货销售内容。
6. 如果某张图片明确标注为“风格参考”“效果参考”或明显展示另一款不同产品，只能记录为参考，不得写入当前商品事实。
7. 图片文字模糊、被遮挡、单位不清、不同图片参数冲突或无法确认时，必须写“不确定 / 待人工确认”，不得猜测。
8. 当前任务只提取图片事实，不进行市场调研，不联网，不生成图片，不规划 Image 1–10。

# 输出格式

请使用结构化 Markdown 输出：

## 1. 图片接收确认
- Total Images Received:
- 每张图片的用途判断：实拍图 / SKU 图 / 尺寸图 / 结构图 / 材质图 / 包装图 / 参数图 / 场景图 / 参考图
- 每张图片可提取的关键信息摘要

## 2. Product Fact Sheet
- Recommended Chinese Product Name: 使用简洁、准确、适合作为本地文件夹名称的中文商品名，不包含品牌、标点或营销词
- Recommended Product Name:
- Recommended Product Category:
- Selling Subject:
- Product Quantity Per Sale:
- Visible Overall Shape:
- Exact Visible Structure:
- Visible Materials:
- Surface Texture:
- Visible Colors:
- Visible Patterns:
- Dimensions:
- Weight:
- Capacity:
- Functional Claims Shown:
- Accessories Included:
- Packaging Shown:
- Intended Use Shown:

## 3. SKU / Variant Matrix

请用表格输出：

| SKU / Variant | Color | Pattern | Size | Material | Visible Differences | Evidence Image | Confidence |
|---|---|---|---|---|---|---|---|

如果图片只证明存在多个 SKU，但无法确定完整数量，请明确说明。

## 4. Image Text And Parameter Extraction

逐张转录图片中与商品有关的可读文字和参数：

| Image | Original Text / Number | Normalized Meaning | Can Be Used As Product Fact | Notes |
|---|---|---|---|---|

保留原始单位，不要擅自换算。若进行换算，必须同时保留原始数值并标注“换算值”。

## 5. Sales Content Boundary
- Confirmed Selling Content:
- Visible Optional Variants:
- Props / Reference Objects Not Included:
- Items That Must Not Be Assumed:

## 6. Conflicts And Uncertain Items
- Conflicting Information:
- Unreadable Information:
- Missing Critical Information:
- Items Requiring Human Confirmation:

请尽可能完整提取图片中的商品信息，不要只描述背景和主要颜色。`;
export const PLANNING_COMPLETION_PROMPT = `# 视觉规划自动补全指令

请继续完成刚才的视觉规划任务，不要再向用户提问。

产品名称、类目、目标平台、目标市场、核心卖点、目标人群、心理动因、销售主体或重要备注如为空或仍是占位符，请基于：
1. 本对话已经上传的产品实拍图；
2. 本对话已经完成的市场调研报告；
3. 图片中可见且能够确认的商品事实；
自行完成合理推断。

无法确认的信息标记为“不确定 / 待人工确认”，不得编造，也不得因此停止。

请现在直接输出完整的：
A. 产品视觉情报报告
B. 10 张高转化主图视觉动线规划表
C. Single Image Prompt Pack

必须完整输出从：
<<<IMAGE_01_PROMPT_START>>>
到：
<<<IMAGE_10_PROMPT_END>>>
的全部 20 个固定边界标记。

每个区块必须包含完整、可直接执行的单图 Prompt。
不要输出解释，不要再次询问，不要等待人工确认，当前不要直接生成图片。`;
export const STORYBOARD_GATE_PROMPT = `# STORYBOARD_GATE_PROMPT

你现在只做 Listing 生图前的 Storyboard Gate。

输入来自本对话已经完成的产品事实、市场调研和视觉方向。

本轮只允许输出结构化 storyboard JSON，不允许输出 Prompt Pack，不允许输出 Single Image Prompt，不允许生成图片。

请输出固定边界：

<<<STORYBOARD_GATE_JSON_START>>>
{
  "product_id": "current-product",
  "prompt_version": "storyboard-gate-v0.1",
  "storyboard_version": "v0.1",
  "items": [
    {
      "image_number": "01",
      "image_role": "hero_hook",
      "buyer_question": "",
      "funnel_stage": "attention",
      "core_selling_point": "",
      "visual_proof": "",
      "headline": "",
      "must_show": [],
      "must_not_show": [],
      "duplicate_check_against": {
        "image_numbers": [],
        "fields": ["image_role", "buyer_question", "core_selling_point", "visual_proof", "headline", "composition"]
      },
      "sequence_reason": "",
      "qc_status": "draft"
    }
  ],
  "qc_summary": {
    "duplicate_count": 0,
    "missing_buyer_questions": [],
    "missing_visual_proof": [],
    "sequence_status": "pass",
    "can_generate_prompt_pack": false,
    "errors": [],
    "warnings": []
  }
}
<<<STORYBOARD_GATE_JSON_END>>>

硬性要求：
- 必须输出 10 个 items，image_number 从 01 到 10。
- image_role 必须依次为：
  01 hero_hook
  02 pain_point
  03 core_feature
  04 material_detail
  05 use_demo
  06 benefit_infographic
  07 gift_or_variant
  08 lifestyle_scene
  09 emotional_scene
  10 trust_summary
- 每张图必须只回答一个 buyer_question。
- 每张图只能有一个 core_selling_point。
- 每张图必须有一个可被画面证明的 visual_proof。
- 不允许重复 headline、core_selling_point、visual_proof 或构图任务。
- 不允许输出任何 Prompt Pack 边界标记。
- 不允许输出自然语言解释。`;
export const STORYBOARD_QC_PROMPT = `# STORYBOARD_QC_PROMPT

你现在只审核 Storyboard Gate。

只输出 QC JSON，不允许修改 storyboard，不允许输出 Prompt Pack，不允许输出 Single Image Prompt，不允许生成图片。

待审核 storyboard：

{{STORYBOARD_JSON}}

请输出固定边界：

<<<STORYBOARD_QC_JSON_START>>>
{
  "valid": false,
  "qc_status": "failed",
  "errors": [],
  "warnings": [],
  "block_next_images": true,
  "regenerate_required": false
}
<<<STORYBOARD_QC_JSON_END>>>

必须检查：
- 是否正好 10 张图。
- 是否一图一任务。
- 10 张图角色是否重复或缺失。
- buyer_question 是否重复。
- headline 语义是否重复。
- core_selling_point 是否重复。
- visual_proof 是否重复。
- 顺序是否符合购买决策路径。
- 每张图是否有明确视觉证据。
- 是否存在泛化礼物图、泛化海报、重复居中产品 + badge 构图。

只有全部通过时，valid 才能为 true，qc_status 才能为 "pass"。`;
export const PROMPT_PACK_FROM_STORYBOARD_PROMPT = `# PROMPT_PACK_FROM_STORYBOARD_PROMPT

你现在只基于已通过 QC 的 storyboard 生成 Image 01-10 Prompt Pack。

禁止重新规划 storyboard。
禁止新增、删除或调换 image_role。
禁止改变 core_selling_point、buyer_question、visual_proof、headline。
禁止生成图片。

已通过 QC 的 storyboard：

{{STORYBOARD_JSON}}

输出要求：
- 只输出 Image 01-10 的 Prompt Pack。
- 必须完整输出从 <<<IMAGE_01_PROMPT_START>>> 到 <<<IMAGE_10_PROMPT_END>>> 的全部固定边界。
- 每个 Image Prompt 必须严格对应 storyboard 中同编号 item。
- 每张图只表达该 item 的 core_selling_point。
- 每张图必须使用该 item 的 visual_proof。
- 不允许跨图编号，不允许拼版、宫格、storyboard、contact sheet、multiple images。
- 每张图必须包含 Product Identity Lock。
- 不允许输出解释。`;
export const MARKET_VISUAL_AUDIT_PROMPT_V2 = `# Market Visual Audit Prompt v2.0

你现在是一位跨境电商 Listing 视觉调研专家。

当前任务：联网调研与上传产品类目明确相关的高表现 Listing 图片系统，不生成图片，不生成生图 Prompt。

## Sample Admission Gate

Only include listings where the selling subject is clearly related to the uploaded product category.

Exclude unrelated or weakly related products, even if their images look good.

A listing must reach at least 70/100 product similarity score to enter the Top 10 audit.

## Top 10 Candidate Scoring

Score every candidate listing before selection:

- Product similarity: 40%
- Search visibility: 20%
- Review volume / rating / ranking signal: 15%
- Listing image completeness: 15%
- Category relevance: 10%

Only select the final Top 10 after scoring.
Do not include listings with product similarity below 70/100.

## Mobile Thumbnail Readability

For each listing, evaluate mobile thumbnail readability:

- High readability: main value is clear at 300px width
- Medium readability: product is clear but small text is unreadable
- Low readability: image becomes crowded or unclear on mobile

Do not recommend visual patterns with low mobile readability.

## Output

请输出：

1. Product Identification
2. Search Keywords
3. Candidate Scoring Table
4. Top 10 Listing Visual Audit
5. Visual Pattern Frequency
6. VOC / Pain Point Summary

## Final Visual Decision for Next-Step Planning

- Product similarity confidence:
- Recommended primary hero message:
- Recommended first image composition:
- Recommended first 5 image sequence:
- Maximum recommended image count:
- Must-follow visual habits:
- Low-quality habits to avoid:
- Mobile thumbnail readability rules:
- Maximum text density:
- Claims that require human confirmation:
- Visual opportunities specific to the uploaded product:
- Do-not-copy competitor elements:`;
export const VISUAL_STRATEGY_COMPRESSION_PROMPT_V1 = `# Visual Strategy Compression Prompt v1.0

你现在是一位跨境电商 Listing 视觉策略裁剪专家。

你的任务不是生成图片，也不是生成完整生图 Prompt。

你的唯一任务是：
基于产品事实和 Chrome AI 市场视觉调研报告，压缩出一份可以指导后续视觉规划的“强决策方案”。

---

## 输入

产品事实：
<<<PRODUCT_FACTS_START>>>
{{PRODUCT_FACTS}}
<<<PRODUCT_FACTS_END>>>

Chrome AI 市场视觉调研报告：
<<<CHROME_AI_REPORT_START>>>
{{CHROME_AI_REPORT}}
<<<CHROME_AI_REPORT_END>>>

---

## 最高规则

1. 上传产品图是销售主体唯一视觉真相。
2. 竞品只用于判断市场习惯、痛点、视觉顺序，不得复制竞品产品结构。
3. 不允许把竞品属性写成当前产品事实。
4. 不允许直接规划 10 张图。
5. 不允许生成生图 Prompt。
6. 必须做取舍，不能平均覆盖所有卖点。
7. 所有无法确认的功能、材质、尺寸、认证、配件数量，必须标记为“不确定 / 待人工确认”。

## 任务 1｜市场样本有效性判断

- Product similarity confidence:
- Category relevance confidence:
- Visual pattern consistency:
- Data limitations:
- Listings that should be excluded from visual learning:
- Reason:

## 任务 2｜主卖点排序

| Priority | Selling Point | Why It Matters | Buyer Pain Point | Visual Proof Method | Claim Risk |
|---|---|---|---|---|---|

要求：
- 只保留 5 个以内核心卖点
- 明确哪些卖点适合放首图
- 明确哪些卖点只适合放详情图
- 明确哪些卖点需要人工确认后才能写

## 任务 3｜视觉取舍决策

## Must Follow

## Can Optimize

## Must Avoid

## Do Not Copy

## 任务 4｜首图决策

- Primary hero message:
- Hero image buyer psychology:
- Product angle:
- Background style:
- Text density:
- Must show:
- Must not show:
- Best headline:
- Alternative headline:
- Subtitle:
- Required disclaimer if any:

要求：
- 首图只打一个核心卖点
- 主标题不超过 5 个英文单词
- 副标题不超过 8 个英文单词
- 首图总英文单词不超过 16 个
- 不允许放参数表

## 任务 5｜推荐图组数量与顺序

不要默认 10 张图。请根据产品实际卖点，推荐 6–10 张图。

| Image No. | Role | Core Selling Point | Buyer Question Answered | Keep / Merge / Remove Reason |
|---|---|---|---|---|

要求：
- 每张图必须有唯一角色
- 不允许两张图承担同一销售任务
- 不允许重复白底产品展示图
- 不允许每张图都做信息图
- 如果某个卖点不足以支撑单独一张图，必须合并

## 任务 6｜移动端文字红线

- Main headline max words:
- Subtitle max words:
- Max callouts per image:
- Max total words per image:
- Whether specification table is allowed:
- Which image can contain specification table:
- Small icon rule:
- Minimum font visibility rule:

## 任务 7｜最终输出

# Final Visual Strategy Decision

- Recommended image count:
- Recommended image sequence:
- Hero direction:
- Top 3 visual priorities:
- Top 3 risks to avoid:
- Text density rule:
- Style direction:
- QC focus:`;
export const VISUAL_PLANNING_PROMPT_V2 = `# Visual Planning Prompt v2.0

你现在只做 Listing 图组动线规划。

当前不要生成图片。
当前不要输出完整单图生图 Prompt。
当前只输出图组规划表。
不要默认输出 10 张图。
图片数量必须根据视觉策略裁剪结果确定。
每张图只解决一个买家问题。
每张图必须有唯一角色。
不允许两张图重复承担同一销售任务。

输入：

产品事实：
<<<PRODUCT_FACTS_START>>>
{{PRODUCT_FACTS}}
<<<PRODUCT_FACTS_END>>>

视觉策略裁剪结果：
<<<VISUAL_STRATEGY_DECISION_START>>>
{{VISUAL_STRATEGY_DECISION}}
<<<VISUAL_STRATEGY_DECISION_END>>>

## Mobile Thumbnail Gate

每张图必须满足手机端 300px 宽缩略图可读。

硬规则：
- Main headline max 5 words
- Subtitle max 8 words
- Total visible words max 22
- Max 3 callouts
- No dense tables except dedicated size/spec image
- Avoid tiny icons and tiny labels
- If the image looks like a crowded Amazon infographic, simplify it

## Role Deduplication Gate

规划前必须检查每张图角色是否重复。

可选角色包括：
- Hero Hook
- Pain Point
- Core Feature
- Detail Proof
- Use Demo
- Accessories / Package
- Size / Spec
- Lifestyle Scene
- Trust Summary

不允许重复白底展示图，除非销售任务完全不同。

## 输出结构

1. 产品视觉情报报告
2. 图组动线规划表
3. 角色去重检查
4. 最终执行清单

图组动线规划表必须包含：

| Image Number | Unique Role | Funnel Stage | Buyer Psychology | Buyer Question Answered | Core Selling Point | Market Evidence | Visual Style Direction | Visual Composition | Product Placement | Background & Lighting | English Copy on Image | Text Density Check | Risk Control |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

禁止输出 Single Image Prompt Pack。
禁止输出 IMAGE_01 到 IMAGE_10 的完整生图 Prompt 边界。
禁止输出任何 Ready-to-Generate Prompt。`;
export const SINGLE_IMAGE_PROMPT_GENERATOR_V2 = `# Single Image Prompt Generator v2.0

你现在只生成指定单张图的完整 Ready-to-Generate Prompt。

输入：

Product Facts:
<<<PRODUCT_FACTS_START>>>
{{PRODUCT_FACTS}}
<<<PRODUCT_FACTS_END>>>

Visual Strategy Decision:
<<<VISUAL_STRATEGY_DECISION_START>>>
{{VISUAL_STRATEGY_DECISION}}
<<<VISUAL_STRATEGY_DECISION_END>>>

Visual Plan:
<<<VISUAL_PLAN_START>>>
{{VISUAL_PLAN}}
<<<VISUAL_PLAN_END>>>

Image Number:
{{IMAGE_NUMBER}}

只输出一个图片区块：

<<<IMAGE_PROMPT_START>>>

## Image {{IMAGE_NUMBER}}｜{{IMAGE_NAME}}｜Ready-to-Generate Prompt

请生成 1 张独立 3:4 竖版电商 listing 图片。

### Product Identity Lock

- The uploaded product images are the only source of truth for the product being sold.
- The product being sold must exactly match the uploaded product images.
- Do not alter the shape, structure, material, color, visible details, surface texture, or overall silhouette.
- Style reference images only control background, layout, lighting, typography, icon style, and visual mood.
- Competitor research only informs strategy and must not change the product design.
- Any prop, model, environment, packaging, or reference object is secondary only and must not change the selling product.
- The selling subject is: {{SELLING_SUBJECT}}.
- Avoid all product mismatch risks.

### Market-Validated Style Lock

- The visual style must follow the validated category visual baseline.
- Preserve the most common category visual habits.
- Use only limited optimization for color, layout, lighting, and clarity.
- Do not copy competitor branding, logos, or product-specific design.
- Do not invent unsupported claims.

### Image Task

- Funnel Stage:
- Buyer Psychology:
- Core Selling Point:
- Market Evidence:
- Visual Composition:
- Product Placement:
- Background & Lighting:
- English Copy on Image:
- Text Density Check:

### Base Image Prompt

Generate a clean no-text base image first.

The product being sold must exactly match the uploaded product images. Do not alter the shape, structure, material, color, or visible product details. Any prop, model, environment, packaging, or style reference is secondary only and must not change the product.

[Write the full English base image prompt here.]

### Overlay Instruction

Add only the following English copy after the base image is correct:

Main headline:
"{{HEADLINE}}"

Subtitle:
"{{SUBTITLE}}"

Callouts:
- "{{CALLOUT_1}}"
- "{{CALLOUT_2}}"
- "{{CALLOUT_3}}"

Typography:
Clean sans-serif font, high contrast, mobile-readable, no tiny text, no overlapping with the product.

### Negative Prompt / Avoid

- Do not change the product
- Do not add extra product structures
- Do not change color
- Do not add Chinese text
- Do not generate unreadable text
- Do not add unsupported claims
- Do not overcrowd the layout
- Do not use dense tables unless specified
- Do not copy competitor logos or brand marks

<<<IMAGE_PROMPT_END>>>`;
export const LISTING_IMAGE_QC_PROMPT_V1 = `# Listing Image QC Prompt v1.0

你现在是一位跨境电商 Listing 图片质检官。

请基于上传的成品图、产品事实和图组规划，对每张图片进行评分。

---

## 评分维度

| Dimension | Score |
|---|---:|
| Product Identity Accuracy | /20 |
| Core Selling Point Clarity | /15 |
| Mobile Thumbnail Readability | /15 |
| Visual Premium Feel | /15 |
| Text Density Control | /10 |
| Role Uniqueness | /10 |
| Compliance / Claim Risk | /10 |
| Overall Conversion Value | /5 |

总分 100。

---

## 输出要求

对每张图输出：

- Image Number:
- Score:
- Keep / Revise / Reject:
- Main Problem:
- Product Mismatch Risk:
- Text Readability Issue:
- Duplicate Role Issue:
- Suggested Revision:
- Revised English Copy:
- Whether regeneration is required:

---

## 判定标准

- 85–100: Keep
- 75–84: Minor revise
- 65–74: Regenerate
- Below 65: Reject

任何出现货不对板，直接 Reject。
任何移动端主卖点不可读，最高不得超过 74 分。
任何未确认承诺写成确定事实，最高不得超过 70 分。`;
export function singleImageCommand(imageNumber, prompt) {
    return `请生成 Image ${imageNumber}。

本次消息已重新附上当前商品的源图片。必须以本次附件中的产品作为唯一产品主体和唯一视觉参考。
如果无法识别附件，请不要继续生成错误图片，直接说明缺少可用产品参考图。

严格使用下面的 Image ${imageNumber} Single Image Prompt：

${prompt}

只生成这一张独立 3:4 竖版电商 Listing 图片。
一张图片只能对应一个 Image 编号。

禁止拼版、宫格、长图、故事板、联系表、缩略图合集和多面板构图。
不要生成其他 Image 编号。
不要重新规划。
不要输出解释。`;
}
//# sourceMappingURL=config.js.map