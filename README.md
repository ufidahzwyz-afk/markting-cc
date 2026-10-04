# 泊冉市场推广自动化系统

这是产品 V1 / PRD 1.2 / 业务基线 V1.4 的本地开发测试工程。管理台已接入持久数据库：两名运营共享主题和推进任务、内容版本与官网页面、留资与线索、广告报表和复盘。后台使用持久任务、幂等键、授权复核和租约恢复。真实资料、账号凭据与逐平台适配仍需本地配置及实测，工程测试通过不代表 AC35 七个完整业务日或 AC47 十六渠道已经验收。

2026-10-04 的 V1.4 增量已实现四源运行读取、DeepSeek 洞察与私有草稿流水线、后台加密凭据及自动登录运行框架。来源二次变化、人工稿保留和重启回执恢复已通过隔离工程联调。真实账号与业务资料尚未在此环境配置，不能计为真实业务验收；逐平台适配和剩余范围见 [本次交付状态](docs/v14-delivery-state.md)。

## Mac Studio（Apple 芯片）

安装 **Docker Desktop for Apple Silicon**，启动 Docker Desktop。首次下载当前集成版本：

```sh
git clone --branch codex/v14-live-automation --single-branch https://github.com/ufidahzwyz-afk/markting-cc.git
cd markting-cc
```

已有安装先按 [私有备份与升级说明](docs/mac-live-readonly-and-credentials.md) 验证备份，再获取并切换到 `codex/v14-live-automation`；保持原 Compose 项目与数据卷。在仓库根目录执行：

```sh
docker compose -f infra/compose.yaml up --build -d
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs --tail=80 init ops public-site worker browser-runtime
```

- 管理台：<http://localhost:3000/overview>
- 官网服务：<http://localhost:3001>；未发布的路径返回 404。在“内容与官网”中登记并发布批准路径后可以访问。
- 数据库、后台任务和浏览器服务位于内部网络，没有宿主公开端口。

镜像不强制 amd64，会按 Apple 芯片使用 ARM64。Linux 容器构建、各服务启动和 PostgreSQL 备份恢复已验证；2026-10-04 Mac 现场任务另验证 ARM64 镜像、五个服务运行、页面/API HTTP 200 及 Chromium profile 2/2。该记录证明本地测试运行，真实平台与持续自动化仍分别待验收。建议 Docker 至少 4 CPU、8 GB 内存、30 GB 可用空间。详见 [本地运行与部署说明](infra/README.md)。

停止而保留数据：

```sh
docker compose -f infra/compose.yaml down
```

不要使用 `down -v`，除非明确要删除测试数据库和浏览器资料。

## 本地功能检查

1. 打开“推广主题”，新建主题并保存；设置中切换“运营 A / B”，两人读取同一数据库。旧版本修改会返回冲突，避免覆盖。
2. 在“今日工作”保存推进备注；规划记录与外部平台执行结果分别显示。
3. 在“内容与官网”保存多版正文、审核公开事实和许可，再登记 `/article/` 等批准路径。页面发布需要负责人启用的规则与不可变正文版本；本地结果明确标记模拟。
4. “效果复盘”先显示数据缺口；预检报表并确认完整窗口后提交。测试样例标记为模拟历史导入，关键词明细不会重复计入计划花费。
5. “共享线索”分别展示留资、真实线索、销售确认与会话。真实个人信息处理默认关闭，合成测试仅使用 `example.invalid` 邮箱。
6. “连接与执行规则”保存来源范围、加密凭据、DeepSeek 路由和周期配置。真实读取需要按 [本地登录说明](docs/local-live-login.md) 启用独立成员登录；来源同步、模型核验和平台登录分别记录实际结果。未配置适配器或覆盖不完整时，后台记录缺口和人工待办。

默认没有真实平台凭据、真实模型产物或真实广告预算。会话和能力未验收时不会显示已接通；提交回执、人工完成说明和模拟回读不代替真实成功。

## 原生 Node 开发

需要 Node 24 LTS、npm 11 与 PostgreSQL 17。四个独立进程必须使用同一个 PostgreSQL；PGlite 仅适用于单进程隔离开发和测试。

```sh
npm ci
# 设置你自己的本地 PostgreSQL DATABASE_URL，再启动四个部件。
npm run dev:services
```

`npm run dev` 只启动管理台，并显式初始化本地开发数据库。开发初始化仅允许 `APP_ENV=development/test` 和模拟模式。生产请求不会执行迁移、种子写入或自动退回模拟身份。

## 验证与任务记录

```sh
npm run typecheck
npm test
npm run build
```

`BORAN_TEST_PG_URL` 启用独立 schema 的真实 PostgreSQL 并发、日期和恢复测试；`BORAN_TEST_OPS_URL`、`BORAN_TEST_PUBLIC_URL` 启用真实 HTTP 联调；`BORAN_TEST_PROTECTED_URL` 检查缺省生产身份阻断，`BORAN_NOTIFICATIONS_HTTP_BASE_URL` 配合测试 PG 检查通知模式隔离。测试不清理共享业务库。GitHub Actions 执行类型、契约生成一致性、单元/跨模块测试、真实 PostgreSQL 检查及两端生产构建。

任务边界和独立验收见 [开发与联调计划](docs/development-plan.md)、[验收目录](docs/acceptance)。真实账号、受控登录代理、平台适配器 POC、模型网关、通知/Drive 外部回读、Apple Silicon 实机以及七业务日对账分别保留待验收状态。

原始业务文档、联系人、账号密钥、Cookie、登录票据和浏览器 profile 不进入公开仓库。生产部署需要已配置组织身份和当前有效成员权限，部署默认拒绝模拟身份。
