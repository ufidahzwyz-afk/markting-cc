# 界面确认与当前开发范围

界面确认分支 `codex/m0-foundation` / PR #1 保存了最初的独立模拟 UI，用户已经确认进入开发。该版浏览器 localStorage 和固定报表仅用于当时的界面展示。

当前 `codex/v1-parallel-development` 已将管理台接入 PostgreSQL 与领域服务，增加内容、官网、线索和持久运行。任务状态、报表和保存操作应以数据库与验收记录为准，不再以最初 UI 预览说明界定后端能力。

模拟模式继续明确标记；真实身份、来源、模型网关、平台动作、接待回执、通知/Drive 回读、Mac Studio 实机及七个完整业务日分别实测。原始资料和凭据不进入公开仓库。

当前使用及剩余限制见 README、infra/README.md 和 docs/acceptance；最初 UI 的截图记录保留用于对照已经确认的布局。
