# Listing Agent（独立 AI Agent）

把「一跨而境」工作台里处理产品 listing 的职责抽离为**边界清晰、可独立部署与调用**的 AI Agent：

> 接收产品信息 → 生成结构化 listing 内容 → 校验字段完整性 → 可选上架店小秘

## 核心职责

| 职责 | 说明 |
|---|---|
| 1. 接收产品信息（Intake） | 支持 images / factsJson / factsMarkdown / sourceUrl / hybrid 多种输入，归一化为内部 facts |
| 2. 生成结构化 listing（Generate） | 调 AI 提取事实 + 生成 SEO/Listing 文案；`full` 模式额外生图并注入 `images.main` |
| 3. 校验字段完整性（Validate） | 三层校验（ajv schema + 类目必填 + 质量评分）+ 自纠错循环（填默认值 / 重跑 AI / 翻译） |
| 4. 可选上架（Publish） | 经 `ListingPublisher` 端口推到店小秘（默认店小秘实现，可插拔、可选） |
| 5. 结果回报（Report） | 结构化 `ListingResult`：状态 / facts / 校验报告 / 自纠错日志 / 上架结果 / 产物 / 日志 |

## 双形态交付

- **库（进程内）**：`import { ListingAgent } from "listing-agent"`——无 Express 依赖，可单测 / CLI / Worker 调用。
- **独立 HTTP 服务**：`node src/server.js`（默认 `AGENT_PORT=3200`），提供
  `POST /api/listing/run`、`POST /api/listing/validate`、`POST /api/listing/preview`、
  `GET /api/listing/status/:jobId`。
- 现有 `server.js` 通过 `src/agent-client.js`（`ListingAgentClient`）调用：默认优先 HTTP，不可达时回退进程内。

## 目录

```
listing-agent/
  src/
    types.js                  # 契约：ListingRequest / ListingResult / ProductFacts / 端口接口
    listing-agent.js          # 核心编排器（Parse→Generate→Validate(+自纠错)→[Publish]），无 Express 依赖
    stages/{parse,generate,validate}-stage.js
    ai/ai-provider.js         # AIProvider 接口 + FakeAIProvider（内存桩，供测试）
    ai/chatgpt-provider.js    # 唯一 AI 实现：包装网页版 ChatGPT（playwright-core + 本机 Chrome CDP）
    publishers/index.js       # ListingPublisher 接口 + 注册表
    publishers/dianxiaomi-publisher.js  # 默认上架实现：复用 dianxiaomi-adapter（引用模式）
    knowledge/profiles.js     # 类目知识门面
    knowledge/field-spec.js   # 乳贴必填字段规范 loader
    server.js                 # 独立 HTTP 服务（内置 http，无 Express）
    agent-client.js           # 供 server.js 调用的客户端（HTTP 优先 / 进程内兜底）
  test/listing-agent.test.js  # 流水线测试（FakeAIProvider，无需 Chrome）
```

## 依赖关系与解耦边界

- 核心（`listing-agent.js` / `stages/` / `knowledge/`）只依赖 `dist/src` 的**纯逻辑**模块
  （`dianxiaomi-facts.js`、`product-fact-service.js`、`listing-knowledge.js`）与 `types.js`。
- **AI 与上架均通过构造注入**（`ai`、`publisher`），核心不 import 任何浏览器/网站内核。
- 唯一的「网页版」运行时依赖封死在端口实现里：`chatgpt-provider.js`（生文/生图）与
  `dianxiaomi-publisher.js`（上架）直接复用现有 `chatgpt-adapter.js` / `dianxiaomi-adapter.js`。

## 与现有系统的关系（不破坏）

> ⚠️ 本包通过**相对路径**复用 `../dist/src/*` 的纯逻辑与适配器；独立部署时把 `listing-agent/`
> 连同所引用的少量 `dist/src` 常量（`config.js` 的 ChatGPT/店小秘常量、`listing-knowledge.js`）
> 一并携带即可。

- **新增独立 API，共存不覆盖**：现有 `server.js` 已挂载 `POST /api/listing/{run,validate,preview}`
  与 `GET /api/listing/status/:jobId`（见 `dist/src/server.js` 末尾）。这些路由**永不下线**，
  直接调用 `agentClient`：优先 HTTP（`node listing-agent/src/server.js`，`AGENT_PORT=3200`），
  HTTP 不可达时自动回退**进程内**直接 `import ListingAgent`。进程启动只实例化轻量客户端，
  真正的 ChatGPT/店小秘连接是惰性的，因此未登录 Chrome / 未起 Agent 服务也不影响原服务启动。
- **原 4 条路由保持不变（安全 add-only）**：`batch-apply` / `collect-batch-apply` /
  `collect-batch-generate` / `workflow/listing-to-upload` 默认仍走既有逻辑，本次**未改动**，
  零回归风险。环境变量 `LISTING_AGENT_FORWARD=1` 是为「后续把这 4 条路由改写为薄转发层」
  预留的开关（改造时让它们改走 `agentClient`），当前对新路由无影响。

## 运行

```bash
# 1) 单测（无需 Chrome）
node --test test/

# 2) 启动独立 HTTP 服务（需本机已登录 ChatGPT / 店小秘的 Chrome，CDP :9223）
AGENT_PORT=3200 node src/server.js

# 3) 调用示例
curl -s http://localhost:3200/api/listing/run \
  -H 'Content-Type: application/json' \
  -d '{"profileKey":"ruTie","input":{"type":"images","images":["/abs/Image_01.png"]},"options":{"mode":"listing-only","publish":false}}'
```

## 已知约束（「仅网页版」决策的后果）

- 文本与生图均走**网页版 ChatGPT**（playwright-core 操作已登录 Chrome，CDP :9223），**不写任何 OpenAI API**。
  运行 `full` 模式或真实上架前，本机需常驻一只已登录 Chrome；否则 provider 会明确抛错而非静默失败。
- 生图慢（等待上限 8–22 分钟）、有人机验证/限流风险——这些脆弱性只留在端口实现内，不污染核心。
- schema 校验对 `variants` 的「适配端元数据」字段（matrix/colors/sizes…）做**软放宽**（与线上一致）：
  仅对类型错/必填缺失判失败，纯多余字段降级为警告。
