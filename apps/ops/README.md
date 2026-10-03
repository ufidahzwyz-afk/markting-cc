# 泊冉管理台 · M0 界面预览

三个主入口：`/overview` 今日工作、`/themes` 推广主题、`/reports` 效果复盘。齿轮打开系统设置抽屉，也可访问 `/settings`。界面针对 390px 手机与 1440px 桌面适配。

当前所有主题、任务与测试指标均来自隔离 fixture；没有账号连接、真实发布、投放、预算批准或业务数据写入。主题支持状态筛选、搜索、展开与临时编辑预览；编辑刷新后恢复。新建与保存明确关闭。报告默认展示无真实数据，用户可切换到测试样例并展开计算口径。

运行：从仓库根目录 `npm install` 后执行 `npm run dev`。管理台本地端口 3000。单独运行需要显式 `APP_ENV=development AUTH_MODE=mock npm run dev --workspace @boran/ops`。

访问默认关闭：只有 `APP_ENV=development` 或 `test` 且 `AUTH_MODE=mock` 可进入演练页面与 `GET /api/v1/overview`。其他模式返回 503，OIDC 真实身份接入尚未实现。`GET /api/health` 仅返回进程存活状态，不包含身份或业务数据。

验收：根目录运行 `npm run typecheck`、`npm test`、`npm run build`。UI 人工检查包括主题筛选/搜索/临时编辑、报告来源切换/口径展开、设置抽屉 Escape 关闭与键盘 Tab 导航；生产环境和缺省环境必须拒绝页面/API。
