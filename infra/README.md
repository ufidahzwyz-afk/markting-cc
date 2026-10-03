# 本地测试与后续 GCP 部署

本地测试不需要 Google Cloud 项目。`compose.yaml` 启动 PostgreSQL、初始化任务、管理台、公网页面、worker 与浏览器运行时。默认使用隔离模拟身份与数据库，真实发布、广告和接待写入全部关闭。

## Mac Studio

安装 Docker Desktop for Apple Silicon，建议至少 4 CPU、8 GB 内存、30 GB 可用磁盘。镜像不强制 `linux/amd64`，Docker 自动选择宿主架构。首次构建需要访问 npm、Docker 镜像仓库及 Debian 软件仓库。

在仓库根目录运行：

```sh
docker compose -f infra/compose.yaml up --build -d
docker compose -f infra/compose.yaml ps
docker compose -f infra/compose.yaml logs --tail=80 init ops public-site worker browser-runtime
```

管理台 `http://localhost:3000`，公网页面 `http://localhost:3001`。两端口仅绑定 `127.0.0.1`；数据库、worker 和浏览器没有宿主发布端口。`backend` 是内部网络。初始化容器先完成迁移与演练资料准备，应用读取不会执行迁移。

停止：`docker compose -f infra/compose.yaml down`。该命令保留数据库、媒体和浏览器 profile 卷。删除测试数据必须单独选择 `down -v`；不要在保留资料时使用它。模拟环境无平台凭据，不代表平台账号已接通。

本地 Dockerfile 固定 Node 24.19.0、PostgreSQL 17.6、Playwright 1.63.0；Debian 为各架构安装原生 Chromium。Chromium 的发行包会随仓库安全更新变化，需要在目标 Mac 上记录 `chromium --version`，运行 browser-runtime profile 测试，再进行每个平台 POC。当前 Linux 宿主验证使用 Chromium 151.0.7922.173，实际 Docker 构建与 profile 验证使用 154.0.8037.92；这项结果不替代 Apple Silicon 或平台实测。

浏览器 `/healthz` 表示进程存活；未配置服务 OIDC 时 `/readyz` 与命令入口返回 503，这是预期的执行阻断状态。worker 会消费到期已授权外部动作，浏览器每秒消费持久 queued 命令；默认模拟配置将缺身份/真实 hook 的任务记为 blocked 并列出缺失能力，不能记为真实成功。部署模式与组织绑定不能由前端请求修改。真实账号登录代理、验证码接手和平台能力 hook 仍须接入。只创建登录会话或票据不会显示账号已登录。

管理台与公网站共享 `media-data` 卷。实际素材通过对象路径、大小和 SHA-256 校验；不要把密码、Cookie、票据或原始资料放入该卷或公开仓库。真实会话启用前确认 Mac FileVault、Docker 数据盘与备份的加密及访问权限。

## 托管执行环境构建

此环境的 Docker 需要临时代理 CA build secret。保留宿主的代理配置，不把 CA 或凭据复制进镜像：

```sh
docker compose -f infra/compose.yaml -f infra/compose.proxy.yaml build
```

Mac Studio 一般只使用基础 compose。Cloud Run 构建使用 `infra/Dockerfile` 的 `production` target 和 `APP=ops/public-site/worker`。生产浏览器选项为 `infra/Dockerfile.browser-gcp`，Playwright 镜像与 npm 包同为 1.63.0。当前环境对 MCR 重定向目的地返回 403，尚未确认该镜像拉取及 ARM manifest，因此不报告官方镜像构建成功。

## GCP 选项

`terraform/` 声明 `asia-northeast1` 同区域私有 VPC、Cloud SQL PostgreSQL 17、Cloud Run 服务/Job、Tasks、Scheduler、私有浏览器 VM、加密 Persistent Disk、磁盘快照、私有媒体与会话桶、分离服务账号和 GitHub WIF。它不会自动应用。

每个发布镜像必须提供 SHA-256 digest；浏览器 COS 启动镜像必须固定版本。仓库只创建 Secret Manager 容器，不写任何秘密版本。公网访问默认关闭；只有明确选择 `allow_public_site=true` 的公网站拥有匿名 invoker。管理台、worker、SQL 与浏览器维持私有访问，没有公网 IP、CDP、VNC 或通用终端代理。

部署前仍需：成本报价与批准、真实 OIDC、数据库 URL 的秘密版本、SQL 用户最小表权限、Cloud SQL IAM 连接实现、生产浏览器状态回调网关（浏览器服务账号不直接获得数据库凭据）、新profile磁盘的明确首次格式化与镜像仓库短期身份、受控登录代理、逐平台验证的 hook、必要且受限的出口、对象存储读回与备份恢复测试。部署账号 WIF 不附带项目管理员权限，按经过审查的部署操作授予必要资源权限。

已做 HCL 解析；未运行 Terraform init、provider validate、plan 或 apply。当前没有 GCP 身份或秘密，也未申请云资源、改 DNS 或采购服务。

本轮 Linux 已完成冻结源码的两镜像重建、纯镜像顺序冒烟、实际 worker/浏览器队列消费、共享媒体卷和 PG 备份恢复；两镜像各176个复制源文件 SHA 一致，Docker 原生 Chromium 的完整浏览器测试28/28通过。因托管环境 VFS 与32GB磁盘限制，四应用同时容器启动未验证；用户 Mac Studio ARM64 仍需现场复验。具体证据和限制见 `docs/acceptance/T8.md`。CloudScheduler通过OAuth调用实际CloudRunJob `job.ts`，不依赖未实现的dispatch HTTP接口；CloudTasks实际投递集成仍待接入。

停止开关修复后的最终本地镜像已在Linux重新构建；两镜像176个runtime文件SHA全部匹配，dev镜像内独立停止控制/迟到回执围栏QA 15/15通过。该窄复核与此前bd4cb431完整四服务/浏览器/恢复验收分别记录，详见 `docs/acceptance/docker-final.json` 的 `postStopControlRefresh`。最新标签仍为boran-local-dev:0.1.0与boran-local-browser:0.1.0，具体本地image ID见T8；未推送registry，MacStudio ARM64待现场验收。
