# CEO 受控初始化与草案存档（P2-A）

承接已确认首店契约和2026-10-26用户“开始”。本批采用既定 Node/SQLite 路线，不重构旧执行器。P2-A 是完整 P2 的输入与持久化基础，不能算经营执行闭环。

## 选择与范围

沿用 `data/metrics/facts/aliexpress/*.jsonl` 作为只读来源，提交受控目标配置，新增独立加载器和同库命名前缀表。相比让 Agent 自填 goal/facts，这能固定宿主所读版本；相比直接改 server/public 接业务，避免覆盖 WorkBuddy 代码及开启未经验收的写入口。数据库路径必须由本地操作者显式提供；服务不默认打开生产数据库。

目标沿用400370/2026年12月/每日支付200件/月利润12000元不含品质罚款。容量和指标核验仍待确认。用户要求参考成熟案例：Asana 的容量与任务努力量对照、Shopify 的日常运营职责可作为方法参考；不推出全托管店的通用人员定额。提议1名经营负责人、120分钟/日、30分钟预留（90分钟可排），仅 PROPOSED_SCENARIO，不写为用户实际承诺。

## 受控输入

`loadCeoOperatingContext({projectRoot,now})` 只读固定配置 `config/ceo-store-400370.json` 与固定来源目录。拒绝越界符号链接、坏JSON/JSONL和超限输入；目录不存在明确 NO_LOCAL_FACTS，不能冒充成功取数。最多100个日期文件、每文件1MiB、合计5MiB、10000条记录。丢弃其他店铺记录，既有 storeId 必须精确等于 env:400370。

对原始事实按 source/store/caliber/subject/window/statDate 组合选最后一版；重复 revision 降序或同版异内容要标冲突、不挑一个伪装可信。保留相对路径、整文件SHA256及行号，注册口径从同一项目字典读取，不允许 Agent 用自己的配置替换。当前原始记录缺完整窗口、覆盖率等，**全部作为 observations 待核对，不进入 P1 可用 facts**。来源新鲜度不以采集时间冒充；不计算利润或把today零值当全天支付零件。此保守适配是明确限制，后续独立核准适配器才可提升为可用事实。

返回 `ceo-operating-context/v1`，含 `contextId`（goal+字典+源文件摘要+观测内容的规范哈希，排除loadedAt和随时钟变化的CAPTURE_FROM_FUTURE诊断）、goal、facts=[]、observations、sourceManifest、gaps、resourceProposal。时间诊断每次重新计算但不产生新的来源版本；相同文件重复读取 contextId 不变，任一内容变化不同。日期、目标配置和结构无效受控报错。不借此宣称本地文件具备密码学身份认证；本地操作者/文件权限仍是信任边界。

## 存档与命令

`CeoDraftWorkspace({dbPath})` 仅新增 ceo_goal_versions、ceo_context_snapshots、ceo_decision_versions、ceo_plan_versions；不改 charm 表，不写可执行任务。`saveDraft({context,decision,candidates,expectedContextId,now})` 在一个 BEGIN IMMEDIATE 事务中核对 contextId、目标版本不可变、决策版本不可变，使用宿主context重新校验/排程，拒绝 INVALID/NEEDS_CONFIRMATION。相同请求幂等复用 planId；决策同ID异内容冲突；保存失败回滚所有新行。NEEDS_EVIDENCE 可以保存，但仍为 DRAFT，未知容量仍 UNCOMMITTED。包含完整候选输入摘要，任何草案内容变化不可覆盖旧行。

CLI `inspect --root <project>` 只读输出context。`save-draft --root <project> --db <absolute.sqlite> --input <JSON> --expected-context <id>` 只接受 decision/candidates，拒绝goal/facts/now额外字段；重新读取宿主上下文后匹配预期版本，输出持久回执。没有审批、执行、完成接口，不调用平台或模型，不改原始输入。错误只输出稳定代码，不回显路径、凭证和原始财务数据。导入CLI无副作用。

## 后续完整 P2

P2-B：同库版本化任务（DRAFT/READY/RUNNING/PENDING_VERIFICATION/DONE/BLOCKED等），权限主体与对象/参数/版本/期限绑定审批，单个执行写入口；计划存档不代表动作授权。

P2-C：占用共享浏览器、尝试唯一键、回执/独立核验、未知结果先对账、人工接管与恢复；只迁入已验证能力。回滚区分本地事务撤销与外部平台补偿，禁止宣称一键撤销不可逆动作。

P2-B/C须各自有准确接口/反例施工单并验收后再启用，本批不开通。P3自动唤醒与P4经营效果观察仍未实现。

来源：[Asana容量规划](https://help.asana.com/s/article/capacity-planning)，[Shopify电商运营](https://www.shopify.com/enterprise/blog/how-to-overcome-your-daily-operational-frustrations-to-focus-on-future-growth)。仅支持规划方法，不支持所提具体工时。
