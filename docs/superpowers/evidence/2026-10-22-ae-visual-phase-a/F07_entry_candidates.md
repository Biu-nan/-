# F07 启动入口候选核验
日期：2026-10-22。F07要求：无需模拟网页点击，从既定本地入口启动生产，并可关联结果。

## C1 ChatGPT Work界面/插件
官方概述支持授权本地资源和插件；插件为Work提供工具，不自动提供“任意本地程序启动Work”的反向接口。
未取得在当前账号下从本地管理界面启动实际Work生产的证据。仅打开页面不计通过。
来源：[Work入门](https://learn.chatgpt.com/docs/get-started-with-work)、[插件](https://learn.chatgpt.com/docs/plugins)。

## C2 Workspace Agents触发接口
官方提供已发布Workspace Agent的API channel触发与可选beta状态查询。
需要已发布Agent、agtch标识、共享权限、Workspace Agents scope token和目标输出连接。
这是“触发API”，不是独立生图API；仍需确认用户的无API边界是否允许、套餐/费用和原生生图能力。
当前查询账号为Plus，没有取得可用Agent/API channel/token或本地D盘交付通道的证据；未发送真实请求。
官方文档说明管理端需启用Workspace Agents及token创建权限，不能把普通Plus登录或Codex登录凭据当成该token。
当前指南描述返回conversation_url及beta run id；官方较早cookbook仍称无返回body/run id，接口合同有版本差异。以当前端点指南和真实响应为准。
202排队不等于完成。即使Agent运行成功，也不能据此推断能访问本机SKU目录。
来源：
- [当前触发指南](https://learn.chatgpt.com/workspace-agents/trigger-runs)
- [认证前置条件](https://developers.openai.com/workspace-agents/authentication)
- [较早cookbook](https://developers.openai.com/cookbook/examples/chatgpt/workspace_agents/workspace-agents-api-trigger)
- [Work Cloud本地访问](https://learn.chatgpt.com/docs/enterprise/cloud-local-access)
判定：条件性候选；当前环境未满足/未验证前置条件。

## C3 官方本地Codex App Server
官方文档提供initialize、thread/start、turn/start以及结果事件。
本机CLI版本0.163.0-alpha.11；已成功生成该安装版本的协议Schema。
在本地协议Schema中观察到imageGeneration能力字段、图片结果事件和ephemeral会话选项。
只读元数据测试：
- 沙箱内initialize超时，并有临时目录访问受限诊断。
- 相同程序和请求在获自动审核批准的沙箱外受控复测成功。
- account/read(refreshToken=false)返回type=chatgpt、planType=plus。
- modelProvider/capabilities/read返回imageGeneration=true、webSearch=true。
- 没有读取或输出凭据正文，没有登录、改设置或创建持久聊天。
这证明受控环境下协议元数据可用；能力布尔值不能代替真实生图测试。

追加最小触发测试：仅一个ephemeral只读任务读取专用测试标记文件；具体结果见app_server_trigger_probe.json（完成后保存）。
不将该候选自动等同“Work界面已通过”，不修改第01–03章。若选为实际后端，应将“官方本地runtime”职责与用户可见入口写入第04章修订并审核。
来源：[App Server文档](https://learn.chatgpt.com/docs/app-server)。

## C4 现有网页适配器
model.js直接复用旧ChatGptAdapter，读取/发送网页会话并下载图片。
存在旧实现不能证明它满足本次Work优先接入约束。本轮不运行，不把它作为默认兜底。

## 判定规则
F07仍需“请求→实际运行→可靠结果关联→适用本地交付”的证据，且执行后端与第04章一致。
App Server的最小文本探针即使通过，也只证明官方本地runtime的控制链路；不证明原生生图、完整10图、Work UI或生产管理界面已验收。

