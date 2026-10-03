# 泊冉公网站点

独立 Next.js SSR 服务，默认端口 3001。只从数据库读取当前 `pages.published_release_id`，正文和 SEO 使用不可变发布快照；预览与发布共享 `@boran/ui/page-renderer`。模块由原始严格 Schema 校验，不接受 HTML、JavaScript、iframe 或外部图片 URL。

配置 `BORAN_MODE=live`、`DATABASE_URL`、`PUBLIC_SITE_ORG_ID`、`PUBLIC_BASE_URL` 和 `PUBLIC_ALLOWED_PATH_PREFIXES` 才开放真实站点。`PUBLIC_BASE_URL` 必须与同域新路由匹配；旧站路由注册为 legacy 后不能被 CMS 覆盖。未配置时返回 503。

本地模拟需显式 `APP_ENV=development BORAN_MODE=mock`，数据库必须先由 CLI 初始化，GET 不迁移或播种。`/preview/{page_id}` 在公网站点保持关闭；草稿仅通过已鉴权管理 API 预览。模拟页面均 noindex，不计真实网站验收。PGlite 不支持跨进程并发写入；多运行部件使用共享 PostgreSQL。

媒体 `BORAN_MEDIA_ROOT` 指向实际文件存储。只服务已发布页面引用且许可 allowed 的素材；阻断路径越界、符号链接越界、未知类型和字节哈希不匹配。不接收任意远程媒体 URL。

`POST /api/v1/leads` 使用同源 JSON、16KB 流式上限、蜜罐、持久幂等和 T6 隐私门槛；默认真实 PII 接收关闭。生产需要至少 32 字符 `PUBLIC_RATE_LIMIT_SECRET`，仅可信反向代理部署可设 `PUBLIC_SITE_TRUST_PROXY=true`。本地测试表单默认关闭，显式 `PUBLIC_SITE_ALLOW_MOCK_FORMS=true` 后仅允许 example.invalid 测试邮箱。长期营销同意单独自愿勾选。

验证：`npm run typecheck --workspace @boran/public-site`、`npm test --workspace @boran/public-site`、`npm run build --workspace @boran/public-site`；内容数据库测试见 `packages/domain/tests/content.test.ts`。
