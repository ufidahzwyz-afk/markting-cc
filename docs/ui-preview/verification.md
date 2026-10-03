# 界面确认版本验收

验证日期：2026-10-03。环境：Node 24.19.0，Next.js 16.3.8，Chromium。

- `npm run typecheck`：通过。
- `npm test`：3 项通过，覆盖缺省/生产访问阻断、显式本地模拟身份、推广计划与关键词避免重复汇总。
- `npm run build`：通过，全部管理页按请求服务端渲染。
- 浏览器：今日工作、主题、报告和设置页面 HTTP 200；1440×1040 与 390×844 均无文档级横向溢出、无页面脚本异常。
- 交互：例外详情键盘切换、设置抽屉及 Escape、主题状态筛选/搜索/清除、临时编辑/恢复、保存禁用、测试报告切换/数据口径展开均通过。
- 生产身份未配置：使用独立生产构建运行，页面和 overview API 返回 503，健康入口返回 200 及最小 liveness 信息。显式请求 mock 身份不能在 production 放行。

预览地址使用 `localhost`，与 Next 开发服务器允许的开发资源来源一致；初次浏览器检查使用 `127.0.0.1` 导致 HMR 受限，统一地址后重新完成全部交互检查。

截图为同一版本的真实页面截屏，数据为隔离测试样例：

- [今日工作](overview-desktop.png)
- [推广主题](themes-desktop.png)
- [效果复盘测试样例](reports-fixture-desktop.png)
- [手机今日工作](overview-mobile.png)

详细浏览器结果见 [browser-check.json](browser-check.json)。本记录仅证明界面确认版本，不代表后端、平台连接、实际发布或 PRD AC01–AC47 已通过。
