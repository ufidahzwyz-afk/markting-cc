# 平台登录、发布和结果回读适配

首批渠道清单保持 16 个：15 个内容渠道与百度营销。指定官网后台和爱番番分别配置；官网后台不增加首批渠道的验收计数。当前完成的是可连接真实服务的执行底座及工程测试，实际渠道账号、当前页面选择器、平台权限、审核契约和业务结果仍须逐账号验收。

## 私有配置与凭据

用户名、密码和百度 API token 由平台后台凭据接口写入本机加密 secret store。数据库只保存 `connections.secret_ref`；运行时按 `orgId + connectionId` 解密。普通 API 不回传密码，浏览器 profile 的绑定清单也不保存密码。持久化浏览器 profile 要放在已经确认加密的私有卷内。

连接的 `scope_json.platform_login` 只保存以下引用：

```json
{"method":"password","recipe_id":"approved-site-login","recipe_version":"reviewed-v1"}
```

`BROWSER_RECIPES_FILE` 指向部署管理员审核的 JSON 数组。每份 recipe 的 `id/version/channelId` 必须与连接引用一致。文件包含限定 HTTPS 域名和页面选择器，不包含用户名、密码或可执行脚本。部署更新 recipe 时应更新版本，再重新核验账号和能力。网站后台的域名还须列入 `BROWSER_WEBSITE_ALLOWED_ORIGINS`。网络代理只放行部署批准的域名；页面导航及资源请求继续受 profile 的域名限制。

私有配置、验收 artifact 和证据文件应设为 `chmod 600`，父目录为 `chmod 700`，所有者应为容器运行的 node 用户。它们放在已有 secrets 私有卷中，由私有备份覆盖；不要加入仓库或公共日志。配置及 artifact 文件在服务启动时载入，安装新的审核版本后重启对应服务。

登录 recipe 的必需字段为：

```json
{
  "id":"approved-site-login",
  "version":"reviewed-v1",
  "channelId":"website",
  "allowedOrigins":["https://YOUR_APPROVED_SITE_HOST"],
  "login":{
    "method":"password",
    "url":"https://YOUR_APPROVED_SITE_HOST/login",
    "accountUrl":"https://YOUR_APPROVED_SITE_HOST/account",
    "account":{"selector":"REVIEWED_ACTUAL_ACCOUNT_SELECTOR","attribute":"data-account-id"},
    "usernameSelector":"REVIEWED_USERNAME_SELECTOR",
    "passwordSelector":"REVIEWED_PASSWORD_SELECTOR",
    "submitSelector":"REVIEWED_LOGIN_SUBMIT_SELECTOR",
    "challengeSelectors":["REVIEWED_MFA_CHALLENGE_SELECTOR"]
  }
}
```

上述占位符不是可运行的平台适配器。`account` 必须读出实际 provider 账号 ID，并与已绑定的 `account_external_id` 一致。只看到登录页面消失、没有报错或配置已保存，均不能通过账号验收。密码失效会重新尝试受控登录；账号不一致、验证码、扫码、OAuth 等强验证需求会进入例外处理。

账号核验通过后，服务端产生绑定当前连接配置、secret 引用、适配版本和 session 版本的登录 proof。负责人或管理员可以根据该 proof 启用账号调度。启用调度不会自行授予发布能力、审批权限或执行策略。

## 独立执行能力验收登记

普通登录证明实际账号身份，连接继续显示 `verifying`，不会生成写入能力证据。负责人或管理员可在后台选择“核验执行能力”，调用空请求体的 `POST /api/v1/platform-accounts/:id/capabilities/verify`。后台只排队一个固定的 `session_verify`，选择器固定为 `capability_artifact: "server-selected"`。请求不能上传 proof、指定 artifact ID、文件路径或脚本。

运行时从 `BROWSER_CAPABILITY_ARTIFACTS_FILE` 选择当前账号的服务端私有验收 artifact。文件是 JSON 数组，每项包含 `id/orgId/accountId/connectionId/externalAccountId/configurationHash/adapterVersion/sessionVersion/acceptedAt/tests`。`configurationHash` 由 `connection_id/account_external_id/read_mode/scope_json/secret_ref` 的稳定 hash 生成。绑定必须与当前数据库和会话完全一致；同一绑定只能有一份 artifact。

`tests` 最多 80 项，每项只对应一个已经独立实测的能力：

```json
{
  "capability":"submit_publish",
  "evidenceRef":"YOUR_PRIVATE_ACTUAL_TEST_RECEIPT_REF",
  "evidencePath":"evidence/submit-publish.json",
  "sha256":"SHA256_OF_THE_ORIGINAL_PRIVATE_RECEIPT_BYTES",
  "capturedAt":"ACTUAL_TEST_TIME_IN_ISO_8601",
  "kind":"browser_readback",
  "externalAccountId":"YOUR_ACTUAL_PROVIDER_ACCOUNT_ID"
}
```

每个 `evidencePath` 必须位于 artifact 同目录之下，不能越目录或通过 symlink 指向目录之外。原始 JSON 测试回执必须保留同一 `orgId/accountId/connectionId/configurationHash/adapterVersion/sessionVersion/externalAccountId`、该项 `capability/kind/capturedAt/evidenceRef`、`source: "platform_readback"` 及非空 `observed` 实际观察结果。服务验证文件 hash、绑定、时间和当前实际登录账号。artifact 及每项证据必须在 24 小时内，并且必须由部署负责人审核真实独立测试输出；任意手填 `verified: true` 不能作为验收入口。

登记成功时原子保存当前命令回执、账号/配置/session 绑定、逐项能力、证据引用和核验时间，连接变为 `connected/healthy`。只对 artifact 确实包含的能力设置布尔值；运行时宏能力不会自动授予其它业务细项。内容渠道的 14 项业务能力、百度的 35 项业务能力仍逐项检查，缺少任意必需项的渠道清单继续显示待验收。百度的真实花费批次和原生预算 proof 仍独立，登录和能力登记均不能生成预算或花费数据。

登记操作把会话版本从已验收的版本推进到新的版本，并绑定这次实际登记回执。后续另一次显式登录或 session 核验会推进版本并撤销旧执行能力，需在新版本下完成并登记独立验收。发布及广告每次写入前重新核验当前 proof，过期、配置变更或会话版本变更不能通过内存缓存继续写入。没有匹配 artifact 时保留明确待配置状态。

## 验证码及扫码例外

私有 recipe 可以附加 `challenge`，例如：

```json
{"method":"otp","startUrl":"https://YOUR_APPROVED_SITE_HOST/mfa","codeSelector":"REVIEWED_CODE_SELECTOR","submitSelector":"REVIEWED_CODE_SUBMIT_SELECTOR","codeFormat":"digits"}
```

二维码使用 `method: "qr"` 及 `qrSelector`。管理员还须将 Ops 服务身份加入 `BROWSER_INTERACTION_SERVICES`。后台先创建并由当前成员兑换一次性 ticket，再打开受控 challenge。验证输入只进入指定页面字段，二维码只返回该元素的裁剪图；不开放远程桌面、CDP、任意 URL、脚本或 cookie 接口。验证码不写入命令、审计或数据库。profile 与 ticket、组织、账号、当前成员、session 版本及 fencing token 绑定。

强验证完成后必须实际回读同一账号，才能写入成功 proof。关闭、过期及配置轮换均释放旧 profile。某些平台的 MFA 依赖原登录页状态，其 recipe 必须配置并实测可续转的页面；缺少这种续转契约时仍显示待配置。ChatGPT 来源目前没有连接级人工 challenge session，扫码及 MFA 恢复仍待实现，不能借内容发布账号的登录状态宣告来源已授权。

## 发布及审核

文章 recipe 可附加 `publication`，包含编辑 URL、标题/正文/提交选择器、真实回执 ID、按 ID 定位的回读 URL、回读账号/标题/正文选择器、已发布/审核中/拒绝选择器、公开 URL 及必需标签选择器。`readbackUrlTemplate` 必须包含一个 `{externalId}`。标签必须读回实际文本。配置选择器不等同于能力验收，`verification` 必须来自相同账号和版本的实际逐项测试证据。

当前文章适配器执行已经批准、已经验证且正文 hash 匹配的文字文章。涉及图片、视频或其他附件的内容会阻断，媒体上传适配尚待逐渠道实现。对外事实依据在执行时再次核验有效期和公开权限；AI 内容须配置并读回要求的标识。

服务先保存实际提交回执，再独立读回实际账号、正文、审核状态、URL 和标识。只有这些证据齐全才能记为 `published_verified`。审核中保持 `in_review`，拒绝保持 `rejected`，字段不一致或回读失败保持 `unknown`。不确定任务只允许只读对账，不能再次点击发布。回执、URL、审核状态及实际字段贯通 browser command、execution action 与 publish job。

## 百度营销 API

百度使用固定 `https://api.baidu.com/json/sms/service/` 边界和受控方法清单。必须配置真实用户名、密码、API token、账号 ID、已审查的 `BROWSER_BAIDU_NATIVE_CONTRACT_VERSION` 和真实逐项 API 能力证据。当前账号、实体、字段和返回契约均实际校验，缺失或不匹配时明确阻断；当前百度 API 契约尚未用用户账号验证。

广告操作读取实际对象的 before snapshot；写入前重新校验租约和授权，写入后再次读取实际有效字段。支持的对象边界包括 campaign、adgroup、keyword、negative 和 creative；搜索词保持只读。报表支持申请、状态和文件 URL 回读，真实报表下载解析及业务验收另行完成。

实际广告调度还要求对应创建/更新对象及报价、地域、时段、暂停/启用等业务细项的独立 proof。广告单元否定词与推广计划否定词分别核验，不把计划级能力冒充账号全局否定词。原生 creative 当前缺少广告及 AI 标识的实际回读字段，真实提交明确阻断，等待该部分平台契约和适配验收。

关键词和创意必须额外读取平台审核 `status`。`BROWSER_BAIDU_REVIEW_CONTRACT_FILE` 指向以下私有契约格式，其版本须与 native 版本一致：

```json
{
  "version":"YOUR_REVIEWED_NATIVE_VERSION",
  "entities":{
    "keyword":{"field":"status","approved":["YOUR_VERIFIED_APPROVED_VALUE"],"pending":["YOUR_VERIFIED_PENDING_VALUE"],"rejected":["YOUR_VERIFIED_REJECTED_VALUE"]},
    "creative":{"field":"status","approved":["YOUR_VERIFIED_APPROVED_VALUE"],"pending":["YOUR_VERIFIED_PENDING_VALUE"],"rejected":["YOUR_VERIFIED_REJECTED_VALUE"]}
  }
}
```

值必须从当前官方契约及真实响应确认，不能使用示例占位值。缺少映射时禁止对应对象写入；未知状态保持不确定，审核中及拒绝分别保留。有效字段与期望值一致也不能替代审核通过。

## ChatGPT 独立来源读取

`BROWSER_CHATGPT_RECIPE_FILE` 保存审核的只读 DOM recipe，版本独立于登录 recipe。包括实际账号 locator、消息/角色/消息 ID/正文/时间 locator、分支 locator、完整历史指示器以及可选项目列表和加载历史按钮。数据库 scope 只授权指定 `conversation_ids` 或 `project_ids`；运行时从该范围产生固定 ChatGPT URL，HTTP 请求不能传任意 URL、凭据或选择器。

读取结果包含角色、消息 ID、时间、分支及覆盖情况。无法证明完整历史或分支/时间时返回 `partial` 和缺口，并保留原 cursor。来源服务把正文和原始 JSON 写入私有不可变 SourceObjectStore，browser command 仅保存安全元数据。来源未登录或真实账号不一致时明确 `auth_required`。

## 验收范围

工程测试使用隔离数据库 schema、真实 Chromium 和明确标注的合成 HTTP/DOM/API fixture，覆盖账号不一致、密码续期、MFA、ticket 与 profile 绑定、配置轮换清理、实际回执要求、审核等待/拒绝、字段不一致及未知结果对账。它们证明执行边界和状态机，不产生平台业务成绩。

真实验收仍需每个账号的授权、当前私有 recipe/API 契约、实际身份读回、独立能力测试、受控发布或广告执行、最终 URL/审核状态/有效字段，以及结果回读。Mac 升级须在已有备份上运行追加迁移，保留用户现有连接、功能和数据。
