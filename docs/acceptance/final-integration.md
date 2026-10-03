# 最终工程联调

2026-10-03，集成分支 `codex/v1-parallel-development`。本轮完成本地测试工程及独立质检；真实平台验收和 Apple Silicon 实机验收单独保留。

## 任务与独立验收

| 实现任务 | 独立质检 | 记录 |
| --- | --- | --- |
| T1 数据库、授权、执行与恢复 | T5/T7 | [执行恢复](QA-execution.md)、[API 覆盖](QA-api-coverage.md) |
| T2 主数据、四源、洞察与排期 | T1 | [营销与来源](QA-marketing.md) |
| T3 正文、实际素材、官网与回滚 | T6 | [内容与线索](QA-content-leads.md) |
| T4 浏览器、会话与账号执行 | T2 | [浏览器安全](QA-browser.md) |
| T5 广告导入、口径与执行 | T4/T8 | [广告与报告](QA-ads-reporting.md) |
| T6 接待、共享线索与隐私 | T3 | [T6](T6.md)、[内容与线索](QA-content-leads.md) |
| T7 报告、通知与归档 | T4/T8 | [T7](T7.md)、[通知模式 HTTP](notifications-mode-http.json) |
| T8 容器与恢复 | 根集成检查、模块交叉质检 | [T8](T8.md) |

原始业务文档、真实联系人、凭据、Cookie、票据和浏览器 profile 未纳入仓库。业务主数据仅保留工程定义及来源引用。

## 最终验证

- 十个 workspace 类型检查通过。
- 冻结后的全量测试使用真实 PostgreSQL 17、隔离 schema、新优化构建的管理台与官网 HTTP、独立生产身份阻断实例和实际本机 Chromium：**264/264 通过，0 失败、0 跳过**。包含 worker 到期清理、通知 HTTP 模式隔离和报告停写专项；未配置的真实外部 hook 仍不能视为实测通过。统计及日志 SHA256 见 [冻结检查记录](final-checks.json)。
- 通知验证当前成员、组织和 mock/live 模式，跨边界读操作 404；到期清理验证实际删除、跨组织保留和幂等回执保留。
- 管理台和官网最后一次 `npm run build` 通过。运行时本地数据库目录明确排除部署文件追踪；编译没有动态文件系统警告。
- 新生产优化构建下六页面 × 1440/390px 共 12 次检查通过：共享主题及负责人、新建保存刷新、报告导入与缺指标、个人收件箱已读、匿名草稿 404。缺少生产身份配置的独立实例实际返回 503。机器证据见 [生产界面验证](ui-evidence/production-verification.json)。
- 报告外送与 Drive 新写入在提交前复核环境及当前组织停写开关；已发生请求继续只读对账。独立专项 **15/15** 验证停止、恢复及单调租约代次，拒绝已被后续领取取代的迟到响应。个人收件箱暂停提示通过实际 SQL、HTTP 和 390px Chromium 验证 `true → false`，见 [停写专项](QA-report-stop-control.md)、[提示验证](ui-evidence/report-external-pause-verification.json)。
- 契约类型重新生成并校验，实际 API 同步结果、不可变版本 ID、安全浏览器 DTO、事件回执与模式字段均有契约回归。
- 后台已接周期任务、`source.changed`、`report.ready`、持久浏览器命令、接待计时及每分钟事件保留清理。缺少真实模型、平台身份、通知或 Drive hook 时保留缺口，不能以提交回执或模拟读回标记真实成功。

具体容器冻结镜像、主进程消费、原生 Chromium 与数据库恢复证据见 [T8](T8.md)、[容器机器证据](docker-final.json)。生产优化构建的界面检查仍使用明确的 `APP_ENV=test` 隔离身份；这不是生产账号或外部平台认证验收。

## Mac Studio 运行

安装 Docker Desktop for Apple Silicon 后，在仓库根目录执行：

```sh
docker compose -f infra/compose.yaml up --build -d
```

打开 `http://localhost:3000/overview`。镜像随宿主使用 ARM64，没有强制 amd64；管理台和官网仅绑定宿主回环地址，数据库、worker 和浏览器在内部网络。停止使用 `docker compose -f infra/compose.yaml down`，保留数据卷。

## 待真实验收

Apple Silicon 实机、四源实际访问与用户确认范围、真实模型网关、组织 OIDC、逐平台会话和发布回读、百度真实对象及预算执行、爱番番消息与回执、生产隐私下游处理、外部通知与 Drive 回读均待配置与实测。AC35 七个完整业务日和 AC47 十六渠道需要真实连续证据，不能由本轮工程测试替代。GCP 声明未执行 apply；本地测试不依赖购买云项目。
