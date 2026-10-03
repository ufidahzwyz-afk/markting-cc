# 独立质检：执行授权与恢复

状态：隔离工程验证通过；真实外部提交及回读 **blocked / 未验收**。测试由 T5/T7 负责人独立编写，T1/worker 负责人修复实现，本质检没有修改 T1/worker 源码。

## 验证范围与结果

`tests/integration/execution-recovery.test.ts` 最近运行 **12/12 通过**，同时在 PostgreSQL 17 独立随机 schema、`TZ=Asia/Shanghai` 中运行全部用例。数据库连接通过 `BORAN_QA_TEST_PG_URL` 提供；测试只创建/删除自己的 schema，不清理共享 public 数据。未配置时使用执行完整 60 表迁移的隔离 PGlite。

- AC07：撤销/替换规则后，旧排队动作不能取得执行权。未知结果完成对账后也再次复核当前授权；已撤销规则的 absent 结果变为 blocked。
- AC02/08：8 个并发同键动作和 8 个同内容导入分别只留下一个意图/批次、一个排队事件和一份自然键事实；不同载荷重用同键被拒绝。
- AC23：同一规则跨两个账号并发预留预算，6 笔各 25 minor 的请求在 100 minor 总限额下只允许 4 笔，拒绝 2 笔。真实 PostgreSQL 多连接事务验证，不将 PGlite 串行事务当作并发证明。
- 目标绑定：同组织内其他连接仍不能与当前账号组合成目标；正确账号/连接组合可用。
- AC09/17：外部租约过期变成 unknown，旧 token 的完成被拒绝，unknown 不取得新提交租约；ambiguous 对账保持 unknown。明确 absent 且授权仍有效时只恢复原 action ID/idempotency key 到 retry_wait。
- worker：步骤顺序、租约接管及 fencing；旧 heartbeat/complete 不覆盖新尝试，缺 handler 不能虚报成功，来源 failed 与 no-change 区分，外部未知步骤停止并 requires human。
- AC14：纯 sales 即使伪造上下文 roles 也不能批准；服务身份不能批准。权限读取实际活跃 membership。
- API：同一成员即使在两个组织都拥有 owner 权限，仍不能用第二组织上下文读第一组织记录。GET tasks/runs/actions/approvals/policies 以当前 membership 检查，缓存上下文 roles 不提供旁路。任务摘要嵌套全角 `apikey` 字段、全角 Bearer 与 percent 编码 token URL key 被拒绝；不保存明文测试凭据。
- 发送前发布窗口：账号 Asia/Shanghai、周一 09:00–11:00 的排队任务在 10:59 可执行，延迟到 11:00 被拒绝并持久 blocked；独立晚间单次精确 approval 仍可执行，不错误套用持续规则窗口。

运行：

```sh
BORAN_QA_TEST_PG_URL="$AUTHORIZED_TEST_PG_URL" node --import tsx --test tests/integration/execution-recovery.test.ts
```

## 独立发现与修复复验

1. 明确 absent 原先变为 failed，无法用原 action/key 恢复。T1 已改为重新检查授权后 retry_wait，授权失效则 blocked；错误停止条件只统计 submit 失败，不将成功确认 absent 的 reconcile 计为新提交错误。复验通过。
2. 目标校验原先只验证组织归属，允许同组织其他 connection 与账号组合。T1 已增加账号别名一致性、账号/connection/conversation 绑定，以及 content variant/account/version 与 page/item 绑定。账号/connection 独立复现已通过；其他内容绑定由 T3 的相关用例共同覆盖。
3. 新增任务摘要检测原先未按 NFKC 检查凭据字段/字符串，全角字段名可存入凭据。独立真实 PostgreSQL 复现后，T1 规范化字段及检测文本、检查 percent 编码值；安全原文与 provenance 不重写。复验通过。

最后新增的发布窗口门槛已独立复验。创建排队意图使用 plan 阶段，执行阶段再次核对账号本地时间；无有效窗口不执行，过期窗口将待执行动作标为 blocked 并留审计，不集中补发历史内容。

T5 另有 `packages/domain/tests/ads-postgres-concurrency.test.ts`，真实 PostgreSQL **1/1 通过**：并发预检复用一批次、提交只保留一份事实、不同批次同水位冲突只允许一笔提交。源连接先于批次加锁，保证与预检/水位更正锁顺序一致。

## 证据边界

PostgreSQL 测试使用匿名 mock 账号与注入证据，证明数据库并发和恢复控制，不证明百度/平台实际执行。服务审批拒绝、租约/幂等/预算控制已验证；真实账号访问、原生双预算、近期真实花费、外部 idempotency 与不可判定结果的实际 readback 仍必须真实联调。对账入口不接受公开客户端自报证据；此处直接调用私有 domain 函数模拟适配器回读。
