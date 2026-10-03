# 独立 QA：广告取数与报表恢复

2026-10-03 对 T5/T7 实现进行独立测试，未改动广告/报表服务源码。`node --import tsx --test tests/integration/ads-reporting.test.ts`：16/16 通过，0 跳过。测试使用隔离 PGlite 全量迁移数据库、匿名合成数据、注入模拟传输；不代表百度、Google Drive 或通知服务已实际接通。

| 验收项 | 已验证行为 |
| --- | --- |
| 唯一权威汇总 | campaign_daily 汇总不叠加 keyword_daily；完整窗口精确保留整数 microCNY 与小数平台转化 |
| 未采集与币种 | 缺日/未确认窗口 totals 为 null，保留 observed 值；转化缺失不补 0；多币种不折算相加 |
| CSV 安全与修订 | 负数、小数金额、不安全整数拒绝；缺日期不能确认完整；同水位冲突阻断；更正水位后自然键修订 |
| 不可变报告 | 新数据产生 r2，r1 的指标、批次证据保留；重复生成返回同一记录；客户端 facts/actions 不能伪造事实 |
| 归档与回读 | 仅提交不算归档；回读字节/版本不符保留 failed+outbox；恢复发现已有文件并读回，不再次写入 |
| 通知恢复 | 丢失回执先对账；unknown 不重发；读回 delivered 后成功；重复调度及成功重试不重复发送 |
| 就绪与隔离 | 未配置百度能力返回 INTEGRATION_REQUIRED，无 readiness 记录；mock/live transport 互斥；缺数据不可通过七日真实验收 |
| SEO 与保留 | 缺证据/零分母保留 null；传播结束时间为空禁止清理；至少三年与闰日处理、legal hold 生效 |

发现并已由 T5 owner 修复：validated CSV 批次按内容 hash 幂等复用时，原先无法对账后更正错误的来源水位。现在仅允许显式向前更正未提交批次的水位，保留原文件 hash 和批次 ID、审计修改；已提交批次不变。该恢复路径有本文件配套回归测试。T5 owner 另对真实 PostgreSQL 并发预检/提交增加连接锁验证。

HTTP 权限边界另由 `apps/ops/tests/browser-handler.test.ts` 验证 6/6：连接 PATCH 使用当前 edit_version，版本冲突与跨组织访问拒绝；客户端不能提交 connected/capabilities 证明；开启只读报表仍保留 not_configured；已有报表不允许改变币种/时区。真实授权、原生预算、连续七日真实自动取数、Drive 网络写入读回与外部通知送达仍 blocked，需凭据和授权目的地后单独验收。
