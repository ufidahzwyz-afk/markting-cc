# Mac 真实读取与后台账号配置

本次增加真实来源读取、DeepSeek 调用所需的私有存储与受限网络出口，以及后台账号凭据的加密底座。原项目名仍为 `boran-marketing-local`；原数据库、媒体、浏览器资料卷保留。它不会把已有模拟来源、草稿或执行记录改成真实记录，也不会打开发布、广告修改或个人信息自动化。

## 凭据怎样保存

设置页提交的 DeepSeek API Key、Drive OAuth 凭据、渠道用户名和密码进入本机私有的 `secrets-data` 卷，以 AES-256-GCM 加密保存。数据库只保留 `boran-secret:UUID` 引用，引用绑定组织和连接；运行服务只能以同一范围取用。渠道账号关联连接后使用该连接的凭据。接口响应不返回密码、API Key、令牌或原始密文文件。

主密钥 `master.key` 与服务身份密钥 `service.key` 为独立的 32 字节随机文件，目录权限为 700、文件为 600。首次安装初始化，正常重启继续使用原密钥。密钥丢失时读取明确失败；已有密文存在时初始化不会另造密钥。替换凭据会产生新引用，不改写原引用。

自动登录通过经过部署审核的渠道配方在允许的 HTTPS 地址填写用户名、密码，并读取真实账号身份确认登录结果。仅保存密码不会使某个渠道自动成为“已接通”。验证码、扫码、设备确认和二次验证需要本人完成一次；系统随后复用已验证会话，失效时重新登录或明确提示需要本人处理。浏览器资料还须满足现有加密卷校验。

## 升级前备份

从当前代码目录执行，备份目录须为**尚未存在**的绝对路径，其父目录需已创建：

```bash
node scripts/private-backup.mjs backup /absolute/private/backups/boran-before-v14
```

脚本短暂停止当前正在运行的 ops、public-site、worker、browser-runtime 容器，导出 PostgreSQL 并归档媒体、浏览器资料、真实来源原文和密钥卷，然后启动原来的容器。它把数据库恢复到独立且无网络的临时 PostgreSQL，比较每张表的行数及数据摘要；各私有卷也恢复到独立临时卷，逐文件核对内容、权限、属主。不会恢复到运行库，不会覆盖原卷，不使用 `down -v`。输出 `restore-verification.json` 后才表明备份已通过恢复检查。

备份含业务材料和解密密钥，目录权限 700、文件权限 600。把整个目录留在本机私有备份位置，不能上传公开仓库。仅备份数据库不能恢复平台密码和会话。重复验证已有备份：

```bash
node scripts/private-backup.mjs verify /absolute/private/backups/boran-before-v14
```

正在使用多个 Compose 文件时，在备份命令末尾传入相同的文件列表，例如 `infra/compose.yaml infra/compose.live-readonly.yaml`。备份失败会保留现有业务卷；修复备份问题后再迁移。

## 启用本地真实读取

为运行 Compose 的终端设置现有组织 ID（从本地设置或已有安装记录取得），不要把密钥写进 `.env`：

```bash
export BORAN_ORG_ID='<现有组织 UUID>'
docker compose -f infra/compose.yaml -f infra/compose.live-readonly.yaml up -d --build
```

新增的 `private-init` 服务准备 `secrets-data`、`sources-data` 卷及独立密钥；已有密钥不会替换。应用使用本地真实登录模式，生产与预生产继续要求原有 OIDC 身份。首次本地操作者密码初始化见 [本地真实登录说明](local-live-login.md)，密码不进入聊天或公开配置。

worker 和 browser-runtime 留在内部网络。它们通过只接受 HTTPS CONNECT 的出口代理访问 DeepSeek、Google 及明确允许的来源或登录网站；代理重新检查 DNS，拒绝内部地址，并连接已验证的公网地址。PostgreSQL 保持内部网络。默认允许：

```text
api.deepseek.com,www.googleapis.com,oauth2.googleapis.com,docs.google.com,drive.google.com,chatgpt.com,auth.openai.com,cdn.oaistatic.com
```

新增市场、竞品或渠道配方需要的域名时，将**完整允许列表**设置到 `BORAN_EGRESS_ALLOW_HOSTS`，域名以逗号分隔；不支持通配符、任意 URL、HTTP 或自定义端口。重建出口代理后生效。客户端的 `NODE_USE_ENV_PROXY=1` 同时覆盖原生 HTTP/HTTPS 请求及 fetch；Chromium 使用独立的代理配置。

可选部署配置 `BROWSER_RECIPES_FILE`、`BROWSER_CHATGPT_RECIPE_FILE`、`BROWSER_CAPABILITY_ARTIFACTS_FILE`、`BROWSER_BAIDU_REVIEW_CONTRACT_FILE` 指向同一私有卷内经过网站实测审核的 JSON 文件；配方目录权限 700，文件 600，容器内属主为 `node`。`BROWSER_WEBSITE_ALLOWED_ORIGINS` 只填写已授权网站的精确 HTTPS origin。百度原生合同版本与真实审核状态映射通过 `BROWSER_BAIDU_NATIVE_CONTRACT_VERSION` 和审核合同文件配置；未知枚举不能推断为通过。未配置时系统保留明确阻断状态。交互操作服务默认仅 `BROWSER_INTERACTION_SERVICES=boran-ops`；正式 OIDC 部署应配置实际 ops 服务 subject。具体格式见 [平台运行配方说明](platform-runtime-recipes.md)。

模型每日配额按上海日历统计，调用次数在数据库里按组织共享，重启不会清零。超过分钟或当日次数时，只有明确尚未提交任何付费 HTTP 请求的任务才能保存下一次执行时间并自动等候；已发生 JSON 修复、429 重试或未知网络结果的任务保留回执并要求核对，避免盲目重复付费。等待期间旧变化被新来源版本替代时，支付前会阻止旧任务继续；已收到的付费回执可以按原不可变输入恢复保存。

真实 Drive OAuth、DeepSeek API Key、有效来源范围、模型配置和业务规则应从后台配置。只有这些真实输入接通、产生来源变化并形成可编辑草稿，才可验收第一条真实业务闭环。此文档及隔离恢复测试通过，不表示已在用户 Mac 上升级或已登录真实平台。
