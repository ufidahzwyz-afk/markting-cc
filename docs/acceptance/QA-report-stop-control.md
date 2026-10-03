# 报告外送与归档全局停写专项

PRD.txt §4.4（行 260）要求全局停止阻止未来写动作；异常处理（行 585–586）规定 WRITE_DISABLED 不发送外部请求并生成站内通知。执行环境（行 674–680）默认关闭外部写与归档/通知渠道，站内通知开启；已发生请求继续回读（行 746）。此次修复覆盖报告外送与 Drive，沿用现有全局开关，没有另加审批策略。

## 实现证据

- `packages/domain/src/reporting.ts` 的 `assertReportExternalWriteAllowed(ctx, tx?)` 仅 gate 新 live 非 in_app `send` 或 Drive `write`，要求 env 精确字符串 true 和当前数据库组织 flag true；发送前重新验证当前运营成员及租约。
- 停止后 notification/报告归档状态 pending；原 outbox 保持未 dispatched，payload 含 `dispatch_state:needs_human`、`processing_error:WRITE_DISABLED`、mode 与所缺开关，产生 `alert.write_disabled`。站内列表通过同报告未完成 outbox 的此 gap 显示暂停提示；报告快照正文保持不可变。
- stop 复原该 claim 增加的尝试计数，保留单调 payload `leaseGeneration`。发送及完成都比对代次和该次预期 attempts，避免 Aclaim1→Bclaim2停止→attempts退回1→A迟到响应误成功。
- unknown delivered 或 Drive found 的只读核对与严格内容/版本回读继续；absent 后试图新增外部写仍需 gate。尚未调用 adapter 的停写不生成 unknown，恢复开关后能首次提交；已调用 adapter 后返回同名 WRITE_DISABLED 错误保持 unknown，不退款或伪造未提交。
- worker 对 gate 结果计 blocked，保留可恢复事件；私有适配器注册不覆盖停写，public HTTP 不接受 hook/凭据/receipt。

## 验证

`node --import tsx --test --test-concurrency=1 packages/domain/tests/reporting.test.ts tests/integration/report-dispatch.test.ts tests/integration/report-stop-control.test.ts`：**29/29、0 failed、0 skipped**（reporting 9、dispatch 5、独立专项 14 子项+父项）。

独立专项包含部署默认停、组织停、private worker 两位成员的真实 SQL 收件箱不中断、显式开启的合成正向写、notification delivered/absent、Drive found/absent、worker 只读恢复、lease 后组织/env 切换、Drive lookup 后组织切换、恢复开关首次写以及 notification/Drive ABA 迟到 fencing。领域补充两类 notification/Drive ABA/fencing 和 adapter 提交后同名异常回归。

PostgreSQL 17 随机隔离 schema 编排回归：**5/5、0 skipped**；只迁移/删除本测试 schema。domain/worker typecheck 通过。所有外部 hook 是本地合成实现，没有连接或写入百度、外部通知服务或 Drive；这些结果不能作为真实外部交付验收。生产仍无真实私有通知/Drive adapters，保持明确待接入。
