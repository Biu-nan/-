请基于本对话中已经上传的产品实拍图完成联网市场调研

# Chrome AI Top 10 Listing Visual Audit Prompt

你现在是一位资深跨境电商市场分析师和电商视觉研究员。 请基于以下产品信息，使用 Chrome / Google / Amazon / SHEIN / Etsy / Walmart / Shopify 独立站进行联网检索。 产品名称：
{{PRODUCT_NAME}}

产品类目：
{{PRODUCT_CATEGORY}}

目标平台：
{{TARGET_PLATFORM}}

目标市场：
{{TARGET_MARKET}}

核心卖点：
{{CORE_SELLING_POINTS}}

---

# 输入说明

上传的产品图片是当前商品识别的主要事实源。

用户可能只提供：
- 目标平台
- 目标市场
- 销售主体备注
- 产品图片

如果产品名称、产品类目或核心卖点为空，请先基于产品图片进行初步识别，再使用联网检索结果进行交叉验证。

不得将竞品属性直接写成当前产品事实。
不得把无法确认的信息写成确定事实。
无法确认的信息必须标记为：
“不确定 / 待人工确认”。

---

# 任务 0｜产品识别与基础信息提取

请基于上传产品图和可验证联网结果输出：

## Product Identification

- Recommended Product Name:
- Recommended Product Category:
- Visible Product Structure:
- Visible Material Appearance:
- Visible Colors:
- Recommended Core Selling Points:
- Likely Target Audience:
- Likely Buyer Motivations:
- Selling Subject Assumption:
- Visible SKU / Variant Notes:
- Accessories or Packaging Shown:
- Uncertain Items:
- Items Requiring Human Confirmation:

要求：

- 只把图片中可见信息写成产品事实
- 材质成分、尺寸、重量、合规属性无法确认时标记为“不确定 / 待人工确认”
- 如果图片中展示多个 SKU，说明是多个款式展示，不能默认推断为套装
- 如果存在包装、参考包或道具，不能默认推断为销售内容

---

# 任务 1｜生成检索关键词

请生成 5 个英文检索关键词，用于搜索同款或高度相似产品。

---

# 任务 2｜筛选 Top 10 高表现 Listing

优先选择：
- 同款产品
- 高度相似产品
- 搜索结果靠前产品
- 高评价产品
- 高评论量产品
- 高排名产品
- 图片素材完整产品

如果无法确认真实销量，请明确写：
“Sales volume unavailable. Using observable proxies such as ranking, review volume, rating, search visibility, and listing completeness.”

不要伪造销量。

---

# 任务 3｜Top 10 Listing Visual Audit

请逐个输出：

| Rank | Product Title | Platform | Link | Observable Performance Signal | Main Background Style | Main Color Mood | Hero Composition | Typography Style | Icon Style | Information Density | Common Image Sequence | Main Selling Points | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

---

# 任务 4｜视觉元素频次统计

请统计前 10 listing 中以下元素的出现次数：

## Background Style Frequency
- White studio background:
- Lifestyle background:
- Gradient background:
- Colorful themed background:
- Natural scene:
- Other:

## Color Mood Frequency
- Neutral minimal:
- Bright colorful:
- Soft pastel:
- Dark premium:
- Natural warm:
- Other:

## Hero Composition Frequency
- Product centered:
- Product + packaging:
- Product + hand demo:
- Before / after comparison:
- Scene-based composition:
- Multi-angle showcase:
- Other:

## Typography Frequency
- Bold uppercase:
- Rounded playful:
- Serif luxury:
- Clean sans-serif:
- Minimal text:
- Text-heavy infographic:
- Other:

## Graphic / Icon Frequency
- Black line icons:
- Color icons:
- Badge labels:
- Arrows / callouts:
- Bubble labels:
- No icons:
- Other:

## Common Image Sequence Frequency

请总结最常见图片顺序，例如：
1. Hero image
2. Core selling point
3. Use demo
4. Material detail
5. Size / fit proof
6. Lifestyle scene
7. Package / gift
8. Final summary

---

# 任务 5｜VOC 总结

请总结：

## Top 5 高频购买痛点
1.
2.
3.
4.
5.

## Top 5 高频购买动机
1.
2.
3.
4.
5.

## Top 5 高频视觉展现形式
1.
2.
3.
4.
5.

---

# 任务 6｜市场视觉结论

请输出：

## Category Visual Baseline
- Most common visual style:
- Most common color mood:
- Most common hero composition:
- Most common information density:
- Most common typography:
- Most common icon system:
- Most common image sequence:

## Visual Opportunities
- Opportunity 1:
- Opportunity 2:
- Opportunity 3:

## Risks to Avoid
- Risk 1:
- Risk 2:
- Risk 3:

## Uncertain Items

请列出仍然无法确认、需要人工判断的内容。

---

# 输出要求

- 必须基于真实页面或可验证搜索结果
- 不要编造销量
- 不要编造竞品
- 不要生成图片
- 不要直接规划 10 张图
- 输出结构化 Markdown
