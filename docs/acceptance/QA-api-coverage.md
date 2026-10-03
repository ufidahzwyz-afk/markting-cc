# 最终 API 与 worker 跨模块质检

2026-10-03，独立于各模块实现核对工程 OpenAPI、根 catchall、单独的接待/公开表单路由与后台注册表。当前工程契约有 **90 个路径、109 个操作**；逐项定位路由，下面的“已路由”表示静态入口存在，不等同真实平台端到端验收。

验证结果：`tests/integration/api-coverage.test.ts` **22/22 通过**，包含隔离 PGlite 的实际响应 AJV 校验、worker 角色撤销与 live 无 mock 回退、隐私缺下游回执、准确日界与调度时间，以及真正 Next HTTP 批量事务回滚。`apps/ops/tests/execution-api.test.ts` **4/4 通过**；PostgreSQL 17 驱动与并发 **2/2 通过**，分别验证 DATE 在上海/UTC 进程与事务中保持日历字符串，以及独立连接 SKIP LOCKED/回滚。新来源/浏览器/报告派发组合 **23/23 通过**，执行核心 **9/9 通过**；T5 独立真实 PostgreSQL 的执行/权限/编码凭据/发布窗口回归 **12/12 通过**。DB、domain、ops、worker 类型检查通过。共享 HTTP 库只新增匿名 QA 主题并暂停；没有清空公共库。

已修复并复验：

- 内容工作台发布去掉被契约禁止的正文 payload，服务端从 version_id 派生；保存后重读完整版本，避免将创建响应误当编辑 DTO；页面创建后根据 page_id 读详情；列表使用实际 version 字段。
- sources/topics/content/policy/action/browser/manifest/reception 等实际同步响应与工程契约对齐，没有补造 run_id。广告导入/报告先前同步响应已独立验证。
- 主题 task ID 重复校验、批量主题 ID 去重、任何成员版本冲突时整批回滚；负责人使用组织成员 ID。仅 owner/marketer 可访问共享工作区和组织级执行记录，角色从当前会员表复核，纯 sales 留在分配给自己的线索范围。
- 隐私配置禁写未知字段；任务 brief 递归拒绝联系方式、凭据、JWT、带凭据 URL；检测先规范化全角字符与最多两层百分号编码，失败前不写数据库且不在错误响应回显。合法引用 ID、摘要与 provenance 保留。
- worker CLI 与常驻进程都注册业务 handlers。mock/read_only 缺能力进入持久 needs_human；成员失去运营角色后不再生成计划；live 模型未配置不回退 mock。模拟 AI 输出和 ai_runs 摘要/质量记录持久化，未伪造 token/费用。
- 隐私请求入站时即时取消后续营销；后台无可信下游 adapter 时记录 needs_human，删除/导出状态仍为 requested，未当作下游完成。
- 上海时区 07:20 采集、07:50 快照、08:00 日报、12:00 修订及周一 08:00 当前周补跑使用唯一周期键；广告前一业务日包含周末。重跑同一阶段不新增同周期工作流。
- 发布意图可在窗口前排期，实际发送与确认未写入后的恢复按当前账号时区、weekday、时分及账号范围重新校验；延迟到窗口结束后持久 blocked，不发生平台提交。mock 使用相同门槛；单次批准按其不可变载荷和有效期执行。
- 来源 source.changed、execution.queued/publish_jobs、browser_commands、report.ready/notification.deliver/report.archive 已接常驻与单次 worker。站内通知持久送达；外部缺配置保存明确阻塞。已提交/unknown 不重新提交，旧 worker 完成回执不能覆盖新租约。
- PostgreSQL DATE 使用 pool 局部 parser 保持 YYYY-MM-DD；TIMESTAMPTZ 保持 Date。既有进程的连接池须重启后采用该修复。

仍需配置或外部能力验证：

1. 公共 events 与 leads 短路径和规范 public 前缀均在 public-site 提供受限入口；默认 page_view 只存页面/发布版本与匿名计数，没有 visitor/session/归因标识。行为事件另需有效隐私与访问统计配置、本次同意和告知版本。真实点击到留资归因链尚未验收。
2. 公共 `/actions/{id}/reconcile` 缺服务端可信实际回读 adapter，返回 503，不能提交 JSON 自报 verified。消费者接线已完成，真实发布、会话核验、外部通知与 Drive 仍缺实际凭据/已审核 hook；阻塞、模拟输出和内部注入的测试回读不代表真实平台验收。
3. 四类 source readers 默认未接通，实际采集保存失败与缺口；配置范围映射保留，关闭用户浏览器后的真实 Mac/ChatGPT 增量 POC 未完成。真实 AI 网关、内容生成、SEO/GEO 自动读取与广告在线取数均未接通。
4. 周期调度可恢复当前周期记录，未自动回补全部历史。缺口日报与站内通知已持久化；外部通知/归档另行核验。后台 health=ok 不能证明整条业务完成。事件保留清理已接每分钟 worker 与 Cloud Run Job，使用服务器固定组织、当前有效服务成员，实际到期删除、跨组织保留和幂等回放已验证。
5. 受控登录票据可创建、一次兑换并绑定 user/org/account；登录交互代理、真实会话核验与全渠道发布未实测。GET DTO 不返回 secret_ref、ticket_hash、profile state；首次原始票据不写幂等缓存，重放返回 null。

覆盖清单（依据最终工程契约，具体平台能力按上面的缺口说明）：

| 方法与路径 | 入口 | 当前行为 |
| --- | --- | --- |
| `POST /imports` | handleAdsReporting | 201 已路由；本地持久读写 |
| `POST /imports/{id}/commit` | handleAdsReporting | 200 已路由；本地持久读写 |
| `GET /imports/{id}` | handleAdsReporting | 200 已路由；本地持久读写 |
| `POST /plans/generate` | handleMarketing | 202 mock 持久模拟输出；live needs_human |
| `POST /content/generate` | handleContent | 202 持久流程；生成器缺能力 needs_human |
| `POST /content/{id}/versions` | handleContent | 201 已路由；本地持久读写 |
| `GET /content/{id}/versions` | handleContent | 200 已路由；本地持久读写 |
| `POST /content/versions/{id}/review` | handleContent | 200 已路由；本地持久读写 |
| `POST /approvals` | handleExecution | 201 已路由；本地持久读写 |
| `GET /approvals` | handleExecution | 200 已路由；本地持久读写 |
| `POST /approvals/{id}/decisions` | handleExecution | 200 已路由；本地持久读写 |
| `POST /actions` | handleExecution | 202 已路由；本地持久读写 |
| `GET /actions` | handleExecution | 200 已路由；本地持久读写 |
| `GET /actions/{id}` | handleExecution | 200 已路由；本地持久读写 |
| `POST /actions/{id}/reconcile` | handleExecution | 503；缺可信平台回读 |
| `POST /actions/{id}/manual-receipt` | handleExecution | 200 已路由；本地持久读写 |
| `POST /pages` | handleContent | 201 已路由；本地持久读写 |
| `GET /pages` | handleContent | 200 已路由；本地持久读写 |
| `GET /pages/{id}/preview` | handleContent | 200 已路由；本地持久读写 |
| `POST /public/leads` | public-site 独立 route | 201 最小回执；隐私未配置 503 |
| `POST /public/events` | public-site 独立 route | 202 持久幂等计数；行为观测需单独配置 |
| `PATCH /leads/{id}` | handleLeads | 200 已路由；本地持久读写 |
| `POST /geo/observations` | handleAdsReporting | 201 已路由；本地持久读写 |
| `POST /sources` | handleMarketing | 201 已路由；本地持久读写 |
| `GET /sources` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /claims` | handleMarketing | 201 已路由；本地持久读写 |
| `GET /claims` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /claims/{id}/verify` | handleMarketing | 200 已路由；本地持久读写 |
| `GET /runs/{id}` | handleExecution | 200 已路由；本地持久读写 |
| `GET /metrics` | handleAdsReporting | 200 已路由；本地持久读写 |
| `GET /reports` | handleAdsReporting | 200 已路由；本地持久读写 |
| `POST /reports` | handleAdsReporting | 201 已路由；本地持久读写 |
| `GET /reports/{id}` | handleAdsReporting | 200 已路由；本地持久读写 |
| `GET /connections/{id}/health` | handleBrowser | 200 已路由；本地持久读写 |
| `POST /connections/{id}/sync` | handleMarketing | 503 needs_human；不推进失败游标 |
| `POST /insights/generate` | handleMarketing | 202 mock 持久模拟输出；live needs_human |
| `POST /topics/{id}/activate` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /platform-profiles/{id}/versions` | handleContent | 201 已路由；本地持久读写 |
| `GET /platform-profiles/{id}/versions` | handleContent | 200 已路由；本地持久读写 |
| `POST /platform-accounts/{id}/session/verify` | handleBrowser | 202 持久 command；后台已接线，真实能力缺口 blocked |
| `GET /platform-accounts/{id}/session` | handleBrowser | 200 已路由；本地持久读写 |
| `POST /publish-jobs` | handleContent | 202 持久排期；后台已接线，真实 adapter 缺口 blocked |
| `GET /publish-jobs` | handleContent | 200 已路由；本地持久读写 |
| `POST /execution-policies` | handleExecution | 201 已路由；本地持久读写 |
| `GET /execution-policies` | handleExecution | 200 已路由；本地持久读写 |
| `POST /execution-policies/{id}/versions` | handleExecution | 201 已路由；本地持久读写 |
| `POST /execution-policies/{id}/activate` | handleExecution | 200 已路由；本地持久读写 |
| `POST /execution-policies/{id}/revoke` | handleExecution | 200 已路由；本地持久读写 |
| `GET /insights` | handleMarketing | 200 已路由；本地持久读写 |
| `GET /topics` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /topics` | handleMarketing | 201 已路由；本地持久读写 |
| `GET /platform-accounts` | handleBrowser | 200 已路由；本地持久读写 |
| `GET /publish-jobs/{id}` | handleContent | 200 已路由；本地持久读写 |
| `POST /platform-accounts/{id}/login-sessions` | handleBrowser | 201 临时票据；交互代理未接通 |
| `GET /login-sessions/{id}` | handleBrowser | 200 已路由；本地持久读写 |
| `POST /login-sessions/{id}/redeem` | handleBrowser | 200 一次兑换；不代表已登录 |
| `GET /business-master` | handleMarketing | 200 已路由；本地持久读写 |
| `GET /distribution-manifest` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /contact-captures` | handleLeads | 201 已路由；本地持久读写 |
| `POST /contacts/{id}/privacy-requests` | handleLeads | 202 即时取消营销；下游缺口 needs_human |
| `GET /metric-policies/current` | handleAdsReporting | 200 已路由；本地持久读写 |
| `POST /metric-policies/versions` | handleAdsReporting | 201 已路由；本地持久读写 |
| `POST /metric-policies/{id}/approve` | handleAdsReporting | 200 已路由；本地持久读写 |
| `POST /reception/events` | ops 私有验签 route | 202 签名与隐私门槛；真实实时连接未接通 |
| `GET /reception/conversations/{id}` | handleLeads | 200 已路由；本地持久读写 |
| `POST /reception/conversations/{id}/handoff` | handleLeads | 入站/SOP/规则门槛；真实发送/交接未接通 |
| `POST /reception/conversations/{id}/reply` | handleLeads | 入站/SOP/规则门槛；真实发送/交接未接通 |
| `POST /leads/{id}/stage-transitions` | handleLeads | 201 已路由；本地持久读写 |
| `GET /connections` | handleBrowser | 200 已路由；本地持久读写 |
| `GET /sources/{id}/versions` | handleMarketing | 200 已路由；本地持久读写 |
| `GET /topics/{id}` | handleMarketing | 200 已路由；本地持久读写 |
| `PATCH /topics/{id}` | handleMarketing | 200 已路由；本地持久读写 |
| `GET /sources/{id}` | handleMarketing | 200 已路由；本地持久读写 |
| `PATCH /sources/{id}` | handleMarketing | 200 已路由；本地持久读写 |
| `DELETE /sources/{id}` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /business-master/initialize` | handleMarketing | 200 已路由；本地持久读写 |
| `POST /imports/preflight` | handleAdsReporting | 201 已路由；本地持久读写 |
| `POST /reports/generate` | handleAdsReporting | 201 已路由；本地持久读写 |
| `GET /content/{id}` | handleContent | 200 已路由；本地持久读写 |
| `GET /pages/{id}` | handleContent | 200 已路由；本地持久读写 |
| `PATCH /pages/{id}` | handleContent | 200 已路由；本地持久读写 |
| `GET /platform-profiles/{id}` | handleContent | 200 已路由；本地持久读写 |
| `GET /content-variants/{id}` | handleContent | 200 已路由；本地持久读写 |
| `GET /pages/{id}/releases` | handleContent | 200 已路由；本地持久读写 |
| `GET /platform-profiles` | handleContent | 200 已路由；本地持久读写 |
| `POST /platform-profiles` | handleContent | 201 已路由；本地持久读写 |
| `GET /content-variants` | handleContent | 200 已路由；本地持久读写 |
| `POST /content-variants` | handleContent | 201 已路由；本地持久读写 |
| `GET /content` | handleContent | 200 已路由；本地持久读写 |
| `POST /content` | handleContent | 201 已路由；本地持久读写 |
| `POST /pages/{id}/publish` | handleContent | 202 原子 release；mock 保持 verification_pending |
| `POST /pages/{id}/rollback` | handleContent | 202 原子 release；mock 保持 verification_pending |
| `POST /platform-profiles/{id}/calibrate` | handleContent | 200 已路由；本地持久读写 |
| `GET /execution-policies/{id}` | handleExecution | 200 已路由；本地持久读写 |
| `GET /workspace/themes` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `POST /workspace/themes` | handleWorkspace | 201 已路由；当前角色与组织隔离 |
| `PATCH /workspace/themes/{id}` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `POST /workspace/themes/batch` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `GET /workspace/members` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `GET /workspace/overview` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `PUT /settings/operating_schedule` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `PUT /settings/privacy_configuration` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `GET /settings` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `GET /notifications` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `POST /notifications/{id}/read` | handleWorkspace | 200 已路由；当前角色与组织隔离 |
| `POST /uploads` | handleWorkspace | 201 已路由；当前角色与组织隔离 |
| `POST /leads` | public-site 独立 route | 201 最小回执；隐私未配置 503 |
| `POST /events` | public-site 独立 route | 202 持久幂等计数；行为观测需单独配置 |
| `PUT /settings/analytics_configuration` | handleWorkspace | 200 已路由；当前角色与组织隔离 |

workspace/themes（含 batch）、成员/overview、settings、uploads、notifications 已补入工程契约。session/CSRF、tasks、contacts/captures 的辅助 GET 等仍需补齐全部读写契约；这些入口已检查权限与输入边界。根路由统一执行身份、Origin/双 CSRF、JSON 大小与幂等检查；公开表单和私有接待分别使用自己的受限接收边界。

复现：

```sh
BORAN_TEST_OPS_URL=http://localhost:3000 node --import tsx --test --test-concurrency=1 tests/integration/api-coverage.test.ts
node --import tsx --test --test-concurrency=1 apps/ops/tests/execution-api.test.ts
# BORAN_TEST_PG_URL 从环境注入；测试使用自身临时 schema，不输出凭据。
node --import tsx --test --test-concurrency=1 packages/db/tests/postgres-concurrency.test.ts
```

以上是本地工程、API 与数据库语义验证；没有真实账号、在线广告取数、真实发布、真实接待 SLA 或隐私下游处理的验收凭据。
