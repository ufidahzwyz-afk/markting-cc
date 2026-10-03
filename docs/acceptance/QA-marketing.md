# T2 来源、AI、主数据与主题独立质检

结果：本地集成质检通过。质检由 T1 负责人执行，未修改 T2 实现模块；缺陷交 T2 owner 修复后重新运行 `node --import tsx --test tests/integration/marketing-sources.test.ts`，8 项测试全部通过。

覆盖内容：四类来源未配置时明确失败且不推进水位；部分覆盖不能记完整成功或推进全局 checkpoint；指定 ChatGPT 项目范围须保留会话、消息与分支定位，跨项目快照被拒绝；并发读取只有一个水位提交胜出，同版本载荷冲突会回滚来源标题、快照、游标与 outbox；用户撤销旧主张后已有和新主题均阻断，旧事实不会被改写为决策，也不能重新核实复活；53 项必要主数据初始化幂等、7 行业保留独立项、BIP 等实际成员别名准确、U8 Cloud 仍 pending、YonWork 不与 WorkBuddy 合并；AI 供应方调用前阻断个人信息及授权头/refresh token 等凭据，模型不能新增授权字段，真实模式缺配置不会模拟回退；定性优先级只使用 P0/P1/P2，不制造数值分数，硬门槛阻断始终排在可用主题之后。

本次发现并已由 owner 修复：

1. 部分覆盖原先可作为 changed/healthy 并推进全局游标；现规范化 partial，保留已读快照并守旧水位。
2. 项目范围原先只支持 conversationIds；现支持显式 projectIds，并要求项目、会话、消息和分支覆盖一致。
3. 撤销仅阻断已有主题，旧主张可被新主题复用；现识别生效后继主张、保持旧 fact 语义并将其失效，同时拒绝重新核实旧主张。
4. 产品族别名原先只有组合展示名；现保留实际 family member 别名及 pending alias 边界。
5. AI 输入凭据检测漏 authorization/refresh_token 等键；现递归检查完整请求（含 server context）后才调用供应方。

验证使用匿名固定样例、PGlite 的真实 PostgreSQL 约束与事务语义，以及本地函数式供应方替身。没有真实 ChatGPT 会话/项目、Drive、公开网站或模型账号接入验证；这些连接仍需各自授权范围及真实取数验收。这里只证明边界、持久化和契约行为，不证明外部服务已接通。
