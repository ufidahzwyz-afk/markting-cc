# Mac 真实读取环境的本地登录

本地真实读取使用 `AUTH_MODE=local`、`BORAN_MODE=live`、`APP_ENV=development` 和既有 `BORAN_ORG_ID`。正式生产继续使用组织 OIDC。本地模拟模式沿用原入口，已有模拟连接和记录不会转为真实数据。

升级、备份和私有存储初始化按部署说明完成后，为数据库中**已经存在且有效的 owner 或 marketer 成员**设置独立密码。此步骤不创建业务用户，不运行 seed，也不清理数据。

在项目目录执行（把三个 UUID 参数替换成已有组织、负责人及目标成员的 ID）：

```sh
docker compose -f infra/compose.yaml -f infra/compose.live-readonly.yaml exec ops \
  npx tsx scripts/local-identity.ts \
  --org ORGANIZATION_UUID --owner OWNER_USER_UUID --user TARGET_USER_UUID --login operator-a
```

命令在终端隐藏输入两次密码，至少 12 个字符、最多 256 字节。密码不接受命令行参数或环境变量。没有终端的受保护部署流程可以加 `--password-stdin`，从标准输入提供仅含 `password` 的私有 JSON；不要把该输入文件放入仓库、聊天或公共日志。

访问 `http://localhost:3000/login`，使用对应成员登录名和密码。页面权限继续依据当前数据库成员和角色，浏览器不能自行指定负责人。登录会话最长八小时，成员停用、密码更新或退出后失效。同一登录名十五分钟内连续十次失败后暂时限流。登录和退出均检查同源请求。

“设置 → AI 模型”可以保存 DeepSeek 加密 API 密钥、模型与调用上限；“平台账号 → 登录配置”可以保存加密用户名、密码和服务端适配器引用。有适配器的密码连接会安排自动登录，没有适配器时明确等待配置。自动登录结果须回读真实账号身份；验证码、扫码和授权失效保留例外待办。普通设置 API 不返回本地身份、会话、密码散列或密钥。

读取环境的发布、付费变更和真实个人信息自动处理开关保持独立，登录成功不会启用外部写入。

组织启用本地真实登录、模型配置或真实资料后，匿名模拟入口不能再访问该组织的业务 API。请继续使用独立成员登录；原模拟历史和人工记录保留，已认证成员仍可查看历史。
