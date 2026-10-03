export interface paths {
    "/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建并预检导入 */
        post: operations["post_imports"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 提交预检通过的导入 */
        post: operations["post_imports_id_commit"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询导入状态与错误明细 */
        get: operations["get_imports_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/plans/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 生成内部周计划 */
        post: operations["post_plans_generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建内容生成流程 */
        post: operations["post_content_generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_content_id_versions"];
        put?: never;
        /** 新增不可变正文版本 */
        post: operations["post_content_id_versions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content/versions/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 质量审核，不授予执行权 */
        post: operations["post_content_versions_id_review"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_approvals"];
        put?: never;
        /** 申请规则外例外单次动作授权 */
        post: operations["post_approvals"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals/{id}/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** owner做出执行决策 */
        post: operations["post_approvals_id_decisions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/actions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_actions"];
        put?: never;
        /** 执行持续规则内动作或已批准的例外动作 */
        post: operations["post_actions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/actions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询动作及尝试记录 */
        get: operations["get_actions_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/actions/{id}/reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 请求对账，不重复外部写 */
        post: operations["post_actions_id_reconcile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/actions/{id}/manual-receipt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 回填人工执行凭据 */
        post: operations["post_actions_id_manual_receipt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_pages"];
        put?: never;
        /** 创建页面草稿 */
        post: operations["post_pages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pages/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 受限预览正文，不可索引 */
        get: operations["get_pages_id_preview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/leads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 幂等接收询盘
         * @description 企业/需求可选，先收最小联系方式；可联系+企业商业意图同成立才计真实线索，否则仅capture。生产隐私配置未启用返回503 privacy_configuration_required；不能隐式启用。 public-site提供当前短路径与兼容规范路径；均复用同一接收逻辑。
         */
        post: operations["post_public_leads"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/public/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 批量接收白名单事件
         * @description public-site提供当前短路径与兼容规范路径；均复用同一接收逻辑。
         */
        post: operations["post_public_events"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 修改有权管理的线索
         * @description 服务端由active memberships派生权限并集；owner/marketer可在本组织共享线索范围内更新，额外sales角色不缩小范围；纯sales按负责线索限制。
         */
        patch: operations["patch_leads_id"];
        trace?: never;
    };
    "/geo/observations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 记录实际观察 */
        post: operations["post_geo_observations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get__sources"];
        put?: never;
        /** 登记并解析授权资料 */
        post: operations["post_sources"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/claims": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get__claims"];
        put?: never;
        /** 新增事实主张 */
        post: operations["post_claims"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/claims/{id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 核实事实与公开许可 */
        post: operations["post_claims_id_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询异步任务状态 */
        get: operations["get_runs_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询确定性指标及口径 */
        get: operations["get_metrics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 报告版本列表 */
        get: operations["get_reports"];
        put?: never;
        post: operations["post__reports"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查看不可变报告快照 */
        get: operations["get_reports_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections/{id}/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取连接健康与经过验证的能力 */
        get: operations["get_connections_id_health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections/{id}/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 增量采集批准范围，成功持久化后推进游标 */
        post: operations["post_connections_id_sync"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/insights/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 四类来源快照生成有证据洞察 */
        post: operations["post_insights_generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/topics/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 有效规则内自动选题排期 */
        post: operations["post_topics_id_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-profiles/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_platform-profiles_id_versions"];
        put?: never;
        /** 平台受众风格与发布规则新版本 */
        post: operations["post_platform_profiles_id_versions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-accounts/{id}/session/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 验证API或云端浏览器登录与实际能力
         * @description 写入持久browser_command并返回run_id；命令校验fencing token和会话版本。可用API先验证，浏览器会话仅在云端profile中。登录/验证成功不代表发布已成功。
         */
        post: operations["post_platform_accounts_id_session_verify"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-accounts/{id}/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取真实会话状态，不返回凭据 */
        get: operations["get_platform_accounts_id_session"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/publish-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 发布状态、回执与核验查询 */
        get: operations["get_publish_jobs"];
        put?: never;
        /** 排期并创建幂等发布动作 */
        post: operations["post_publish_jobs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 持续授权规则及当前版本 */
        get: operations["get_execution_policies"];
        put?: never;
        /** 创建持续执行规则草稿 */
        post: operations["post_execution_policies"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-policies/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建持续规则新草稿版本 */
        post: operations["post_execution_policies_id_versions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-policies/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 负责人显式激活持续规则 */
        post: operations["post_execution_policies_id_activate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-policies/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤销规则并阻止未执行动作 */
        post: operations["post_execution_policies_id_revoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/insights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 洞察及证据查询 */
        get: operations["get_insights"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/topics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 选题及自动排期查询 */
        get: operations["get_topics"];
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post__topics"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 平台账号能力及登录状态 */
        get: operations["get_platform_accounts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/publish-jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 实际发布位置、提交回执和核验状态 */
        get: operations["get_publish_jobs_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-accounts/{id}/login-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建绑定当前用户的云端账号登录交互 */
        post: operations["post_platform_accounts_id_login_sessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/login-sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询本人云端登录交互，不返回原始票据或Cookie */
        get: operations["get_login_sessions_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/login-sessions/{id}/redeem": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 60秒内一次兑换云端登录票据并绑定当前用户交互 */
        post: operations["post_login_sessions_id_redeem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/business-master": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取当前组织业务主数据及来源 */
        get: operations["get_business_master"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/distribution-manifest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取16渠道真实能力验收及缺口 */
        get: operations["get_distribution_manifest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contact-captures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建联系方式捕获，意图确认后关联真实线索 */
        post: operations["post_contact_captures"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/contacts/{id}/privacy-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 撤回、删除或导出请求及停止营销 */
        post: operations["post_contacts_id_privacy_requests"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metric-policies/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取独立归因、成熟期及评分策略 */
        get: operations["get_metric_policies_current"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metric-policies/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 创建指标策略草稿，不启用生产 */
        post: operations["post_metric_policies_versions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metric-policies/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 负责人批准精确指标策略版本 */
        post: operations["post_metric_policies_id_approve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reception/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 私有connector幂等录入已验证接待事件 */
        post: operations["post_reception_events"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reception/conversations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 两人共享读取脱敏接待会话及状态 */
        get: operations["get_reception_conversations_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reception/conversations/{id}/handoff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 处理明确人工请求并指派现有两人之一 */
        post: operations["post_reception_conversations_id_handoff"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reception/conversations/{id}/reply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 生成并按有效接待规则校验自动答复 */
        post: operations["post_reception_conversations_id_reply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leads/{id}/stage-transitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 带证据更新销售漏斗，校验报价与成交条件 */
        post: operations["post_leads_id_stage_transitions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织内只读模型 */
        get: operations["listConnectionRead"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sources/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织内只读模型 */
        get: operations["listSourceVersionRead"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/topics/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get__topics_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 组织范围内持久化接口 */
        patch: operations["patch__topics_id"];
        trace?: never;
    };
    "/sources/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get__sources_id"];
        put?: never;
        post?: never;
        /** 组织范围内持久化接口 */
        delete: operations["delete__sources_id"];
        options?: never;
        head?: never;
        /** 组织范围内持久化接口 */
        patch: operations["patch__sources_id"];
        trace?: never;
    };
    "/business-master/initialize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post__business-master_initialize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__imports_preflight"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/reports/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post__reports_generate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_content_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pages/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_pages_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 组织范围内持久化接口 */
        patch: operations["patch_pages_id"];
        trace?: never;
    };
    "/platform-profiles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_platform-profiles_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content-variants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_content-variants_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pages/{id}/releases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_pages_id_releases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_platform-profiles"];
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post_platform-profiles"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content-variants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_content-variants"];
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post_content-variants"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_content"];
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post_content"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pages/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post_pages_id_publish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pages/{id}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post_pages_id_rollback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/platform-profiles/{id}/calibrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 组织范围内持久化接口 */
        post: operations["post_platform-profiles_id_calibrate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/execution-policies/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 组织范围内持久化接口 */
        get: operations["get_execution-policies_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace/themes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前组织已实施的持久化接口 */
        get: operations["get_workspace_themes"];
        put?: never;
        /** 当前组织已实施的持久化接口 */
        post: operations["post_workspace_themes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace/themes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 当前组织已实施的持久化接口 */
        patch: operations["patch_workspace_themes_id"];
        trace?: never;
    };
    "/workspace/themes/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 当前组织已实施的持久化接口 */
        post: operations["post_workspace_themes_batch"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前组织已实施的持久化接口 */
        get: operations["get_workspace_members"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/workspace/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前组织已实施的持久化接口 */
        get: operations["get_workspace_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/operating_schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 当前组织已实施的持久化接口 */
        put: operations["put_settings_operating_schedule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/privacy_configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 当前组织已实施的持久化接口 */
        put: operations["put_settings_privacy_configuration"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前组织已实施的持久化接口 */
        get: operations["get_settings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 当前组织已实施的持久化接口
         * @description 只读当前成员、当前服务模式报告的站内通知；行mode与meta.mode一致。
         */
        get: operations["get_notifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 当前组织已实施的持久化接口
         * @description 通知必须属于当前成员、当前组织及当前服务模式；幂等标记已读。
         */
        post: operations["post_notifications_id_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 当前组织已实施的持久化接口 */
        post: operations["post_uploads"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 幂等接收询盘
         * @description 企业/需求可选，先收最小联系方式；可联系+企业商业意图同成立才计真实线索，否则仅capture。生产隐私配置未启用返回503 privacy_configuration_required；不能隐式启用。 public-site提供当前短路径与兼容规范路径；均复用同一接收逻辑。
         */
        post: operations["post_public_leads_public_site"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 批量接收白名单事件
         * @description public-site提供当前短路径与兼容规范路径；均复用同一接收逻辑。
         */
        post: operations["post_public_events_public_site"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/analytics_configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 负责人以当前配置版本更新行为统计配置
         * @description 仅当前有效owner可更新；If-Match为当前schema_version，首次为0。批准字段由服务器填入，启用不替代访客本次明确同意。
         */
        put: operations["put_settings_analytics_configuration"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Meta: {
            request_id: string;
            next_cursor?: string;
            /** Format: date-time */
            data_cutoff?: string;
            /** @enum {string} */
            quality?: "complete" | "partial" | "stale" | "missing" | "quarantined";
            /** @enum {unknown} */
            mode?: "mock" | "live";
            idempotency_replay?: boolean;
        };
        Error: {
            error: {
                code: string;
                message: string;
                details?: {
                    [key: string]: unknown;
                };
                request_id: string;
            };
        };
        Async: {
            data: {
                /** Format: uuid */
                run_id: string;
                /** @enum {string} */
                status: "queued" | "needs_human";
                /** Format: uuid */
                resource_id?: string;
                simulation?: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        Resource: {
            data: {
                [key: string]: unknown;
            };
            meta: components["schemas"]["Meta"];
        };
        /** @description 客户端观测线索仅输入，不视作付费归因证明。服务端核验实际点击/会话/内容映射，未确认字段保存unknown；query脱敏后入模型。 */
        Attribution: {
            utm_source?: string;
            utm_medium?: string;
            utm_campaign?: string;
            utm_content?: string;
            utm_term?: string;
            click_id?: string;
            referrer_origin?: string;
            /** Format: uuid */
            session_id?: string;
            /** Format: uuid */
            anonymous_id?: string;
            query?: string;
            conversation_external_id?: string;
            campaign_external_id?: string;
            unit_external_id?: string;
            keyword_external_id?: string;
            /** Format: uuid */
            content_item_id?: string;
            /** Format: uuid */
            publish_job_id?: string;
        };
        /** @description 新自动推广使用topic_id+targets，按账号受众/风格/平台规则分别产出content_variants。旧target_channels仅兼容母稿草稿，未映射实测账号/档案不得自动发布。 */
        ContentGenerate: {
            /** @enum {string} */
            business_line: "yonyou" | "seeyon" | "shared";
            /** @enum {string} */
            kind: "mother_draft" | "article" | "landing_page" | "case" | "ad_copy" | "qa" | "image_text" | "video_script" | "subtitle" | "storyboard";
            /** Format: uuid */
            task_id?: string;
            brief: string;
            evidence_ids: string[];
            target_channels?: string[];
            /** Format: uuid */
            topic_id?: string;
            targets?: components["schemas"]["ContentTarget"][];
        } & (unknown | unknown);
        ImportCreate: {
            /** Format: uuid */
            connection_id: string;
            /** @enum {string} */
            report_type: "campaign_daily" | "keyword_daily" | "adgroup_daily" | "creative_daily" | "search_term_daily" | "account_daily";
            object_key: string;
            file_hash: string;
            /** Format: date */
            window_start: string;
            /** Format: date */
            window_end: string;
            currency: string;
            timezone: string;
            mapping: {
                [key: string]: string;
            };
        };
        ImportCommit: {
            expected_file_hash: string;
            confirm_complete_window: boolean;
            /** @enum {string} */
            revision_policy: "upsert_by_natural_key";
        };
        PlanGenerate: {
            /** Format: date */
            week_start: string;
            business_lines: ("yonyou" | "seeyon" | "shared")[];
            goal_ids: string[];
            capacity_hours?: number;
            instructions?: string;
        };
        /** @description 模块data需按模板注册表二次校验；禁止任意HTML或脚本 */
        Module: {
            /** @enum {string} */
            type: "hero" | "problem" | "solution" | "scope" | "process" | "proof" | "case" | "faq" | "cta" | "lead_form";
            schema_version: number;
            data: {
                [key: string]: unknown;
            };
        };
        ContentVersionCreate: {
            title: string;
            modules: components["schemas"]["Module"][];
            claim_ids: string[];
            channel_variants?: {
                channel: string;
                title: string;
                body: string;
                /** Format: uri */
                target_url?: string;
            }[];
        };
        PageCreate: {
            host: string;
            path: string;
            /** @enum {string} */
            business_line: "yonyou" | "seeyon" | "shared";
            /** @enum {string} */
            template_key: "service" | "industry" | "case" | "article";
            /** Format: uuid */
            content_item_id: string;
            /** Format: uuid */
            primary_keyword_id?: string;
            seo_title: string;
            description: string;
            /** Format: uri */
            canonical_url: string;
            /** @enum {string} */
            index_policy: "index" | "noindex";
            form_schema_id?: string;
            /** Format: uuid */
            owner_user_id: string;
        };
        /** @description 仅例外单次授权；规则内动作复用已激活policy版本，无需逐次审批。服务器生成载荷hash和预算影响；例外expires_at由负责人显式指定。 */
        ApprovalCreate: {
            /** @enum {string} */
            action_type: "content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply";
            target: components["schemas"]["ActionTarget"];
            /** Format: uuid */
            version_id?: string;
            payload: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            expires_at: string;
            reason?: string;
        };
        ApprovalDecision: {
            /** @enum {string} */
            decision: "approved" | "rejected" | "revoked";
            expected_payload_hash: string;
            reason?: string;
        };
        /** @description policy_version_id XOR approval_id；审批分支不接受替换载荷，规则分支只能在当前已激活范围内执行；服务端持续规则可复用，例外审批一次性消费。 */
        ActionCreate: components["schemas"]["ApprovalActionCreate"] | components["schemas"]["PolicyActionCreate"];
        /** @description 企业/需求可选，先收最小联系方式；可联系+企业商业意图同成立才计真实线索，否则仅capture。生产隐私配置未启用返回503 privacy_configuration_required；不能隐式启用。 */
        LeadSubmit: {
            /** Format: uuid */
            submission_id: string;
            /** Format: uuid */
            page_id: string;
            /** Format: uuid */
            release_id: string;
            company?: string;
            contact_phone?: string;
            /** Format: email */
            contact_email?: string;
            need?: string;
            privacy_notice_version: string;
            /**
             * @description 本次咨询处理告知，不代表长期营销联系同意。
             * @constant
             */
            consent: true;
            attribution?: components["schemas"]["Attribution"];
            honeypot?: string;
            contact_wechat?: string;
            /**
             * @description 仅开发/验收白名单可指定；服务端独立识别内部测试防止客户端篡改经营口径
             * @default false
             */
            test_record: boolean;
            allowed_contact_channels?: ("phone" | "wechat" | "email")[];
            /**
             * @description 长期营销联系单独自愿选择，与本次咨询处理告知同意分开；未勾选不能推定营销同意。
             * @default false
             */
            marketing_consent: boolean;
        } | unknown | unknown | unknown;
        LeadReceipt: {
            data: {
                /** Format: uuid */
                receipt_id: string;
                /** @enum {string} */
                status: "received";
            };
            meta: components["schemas"]["Meta"];
        };
        /** @description status=invalid时必须提供invalid_reason。owner/marketer具有组织共享运营权限；兼任sales不收窄其可读/可更新线索范围。仅缺少组织共享能力的纯sales账号按其负责线索限制；授权能力按角色并集计算。 status为处理状态，funnel_stage为漏斗阶段；迁移需证据和下一步，并校验报价/成交实际记录，不能跳过销售确认。 quality_level独立real_lead/qualified_lead；确认qualified需企业背景、需求、负责人、下一步和证据，qualified_by/at由服务端当前操作者/时间写入，不可由模型自行确认。 */
        LeadUpdate: {
            /** Format: uuid */
            owner_user_id?: string;
            /** @enum {string} */
            status?: "new" | "assigned" | "contacted" | "qualified" | "invalid";
            /** @enum {string} */
            invalid_reason?: "spam" | "duplicate" | "no_need" | "unreachable" | "out_of_scope" | "other";
            need?: string;
            note?: string;
            /** @enum {string} */
            funnel_stage?: "CONTACTED" | "QUALIFIED" | "OPPORTUNITY" | "DEMO" | "PROPOSAL" | "QUOTED" | "WON" | "LOST" | "NURTURE" | "REACTIVATED";
            feedback?: {
                /** @enum {string} */
                validity?: "valid" | "invalid" | "pending";
                invalid_reason?: string;
                product_interest?: string;
                need_type?: string;
                persona?: string;
                region?: string;
                urgency?: string;
                budget_signal?: string;
                next_step?: string;
                lost_reason?: string;
            };
            transition_evidence_ref?: {
                kind: string;
                value: string;
            };
            /** @enum {string} */
            quality_level?: "real_lead" | "qualified_lead";
            qualification_evidence_ref?: {
                [key: string]: unknown;
            };
        } & unknown;
        EventBatch: {
            events: {
                /** Format: uuid */
                event_id: string;
                /** @enum {string} */
                event_type: "page_view" | "cta_click" | "form_start" | "form_submit";
                /** Format: date-time */
                occurred_at: string;
                /** Format: uuid */
                page_id: string;
                /** Format: uuid */
                release_id?: string;
                attribution?: components["schemas"]["Attribution"];
                properties?: {
                    [key: string]: unknown;
                };
            }[];
        };
        GeoObservation: {
            /** Format: uuid */
            question_id: string;
            batch_key: string;
            repetition_no: number;
            platform: string;
            product_mode: string;
            model_version?: string;
            region: string;
            /** Format: date-time */
            observed_at: string;
            /** @enum {string} */
            status: "valid" | "timeout" | "refused" | "invalid";
            answer_text?: string;
            evidence_object_key?: string;
            citations?: string[];
        };
        ReviewContent: {
            /** @enum {string} */
            review_status: "in_review" | "approved" | "changes_requested";
            reason?: string;
        };
        SourceCreate: {
            /** @enum {string} */
            provider: "upload" | "drive" | "url";
            provider_file_id?: string;
            /** Format: uri */
            source_url?: string;
            object_key?: string;
            title: string;
            /** @enum {string} */
            visibility: "internal" | "public";
            /** Format: uuid */
            connection_id?: string;
            /** @enum {string} */
            source_kind?: "market_public" | "competitor_public" | "mac_drive" | "chatgpt" | "other";
            conversation_id?: string;
        };
        /** @description 默认assertion_type=fact；决策必须有decision_status，confirmed/revoked须定位明确用户表达；推断不当公开事实。 */
        ClaimCreate: {
            claim_text: string;
            /** Format: uuid */
            source_version_id: string;
            locator: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            public_permission: "allowed" | "anonymous_only" | "denied" | "unknown";
            /** Format: date-time */
            valid_until?: string;
            /** @enum {string} */
            assertion_type?: "fact" | "inference" | "decision";
            decision_status?: ("proposed" | "confirmed" | "revoked" | "disputed") | null;
            decision_evidence_ref?: {
                [key: string]: unknown;
            } | null;
            supersedes_claim_id?: string | null;
            inference_rationale?: string | null;
        };
        ClaimVerify: {
            /** @enum {string} */
            verification_status: "verified" | "disputed" | "expired";
            /** @enum {string} */
            public_permission?: "allowed" | "anonymous_only" | "denied" | "unknown";
            permission_evidence_ref?: {
                [key: string]: unknown;
            };
            reason?: string;
        };
        /** @description 至少url或evidence_object_key一个；需owner或获授权operator确认 */
        ManualReceipt: {
            external_id?: string;
            /** Format: date-time */
            executed_at: string;
            /** Format: uri */
            url?: string;
            evidence_object_key?: string;
            note?: string;
        } | unknown | unknown;
        ImportAccepted: {
            data: {
                /** Format: uuid */
                batch_id: string;
                /** Format: uuid */
                run_id: string;
                /** @enum {string} */
                status: "queued";
            };
            meta: components["schemas"]["Meta"];
        };
        ActionAccepted: {
            data: components["schemas"]["ExecutionActionRow"];
            meta: components["schemas"]["Meta"];
        };
        VersionCreated: {
            data: {
                /** Format: uuid */
                id: string;
                version: number;
                payload_hash: string;
            };
            meta: components["schemas"]["Meta"];
        };
        PageCreated: {
            data: {
                /** Format: uuid */
                page_id: string;
                version?: number;
            };
            meta: components["schemas"]["Meta"];
        };
        ApprovalCreated: {
            data: components["schemas"]["ApprovalRow"];
            meta: components["schemas"]["Meta"];
        };
        ObservationCreated: {
            data: {
                /** Format: uuid */
                observation_id: string;
                version?: number;
                duplicate?: boolean;
                /** @enum {unknown} */
                mode?: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        ClaimCreated: {
            data: {
                /** Format: uuid */
                claim_id: string;
                version?: number;
            };
            meta: components["schemas"]["Meta"];
        };
        EventAccepted: {
            data: {
                accepted_count: number;
                duplicate_count: number;
            };
            meta: components["schemas"]["Meta"];
        };
        ActionTarget: {
            /** Format: uuid */
            page_id?: string;
            /** Format: uuid */
            connection_id?: string;
            external_resource_id?: string;
            channel?: string;
            /** Format: uuid */
            platform_account_id?: string;
            /** Format: uuid */
            content_variant_id?: string;
            /** Format: uuid */
            conversation_id?: string;
        };
        ApprovalActionCreate: {
            /** Format: uuid */
            approval_id: string;
            expected_payload_hash: string;
        };
        /** @description field/value必须经目标平台适配器固定Schema校验，禁止任意脚本或未知字段。 */
        AdsChange: {
            /** @enum {string} */
            field: "name" | "daily_budget_minor" | "bid_minor" | "enabled" | "keyword" | "negative_keyword" | "match_type" | "title" | "description" | "landing_url" | "region_ids" | "time_windows" | "content_version_id";
            value: string | number | boolean | unknown[] | Record<string, never> | null;
        };
        /** @description 每次回读目标原值，hash不匹配阻止变更；创意事实/许可和预算由服务器验证。 ads.update为协议动作类别，其create/update/enable/pause子命令必须在policy.allowed_ad_operations及allowed_ad_entity_levels中逐项允许；ads.pause只允许pause。create时expected_before_hash指已验证父对象/目标不存在快照。 */
        AdsActionPayload: {
            /** @enum {string} */
            operation: "create" | "update" | "enable" | "pause";
            /** @enum {string} */
            entity_level: "account" | "campaign" | "unit" | "keyword" | "negative_keyword" | "creative";
            changes: components["schemas"]["AdsChange"][];
            expected_before_hash: string;
        };
        /** @description 规则分支：正文发布由version_id/target解析不可变内容，广告动作使用固定AdsActionPayload；服务器重算hash并重验当前规则。 reception.reply使用固定ReceptionReplyPayload，发送实际受同一授权XOR及幂等/未知结果对账控制。 */
        PolicyActionCreate: {
            /** Format: uuid */
            policy_version_id: string;
            /** @enum {string} */
            action_type: "content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply";
            target: components["schemas"]["ActionTarget"];
            /** Format: uuid */
            version_id?: string;
            payload?: components["schemas"]["AdsActionPayload"] | components["schemas"]["ReceptionReplyPayload"];
            expected_payload_hash: string;
        } & (unknown & unknown & unknown);
        ContentTarget: {
            /** Format: uuid */
            platform_account_id: string;
            /** Format: uuid */
            platform_profile_version_id: string;
            format: string;
        };
        /** @description 游标由服务器读取，客户端不能跳过未采集来源。 */
        SourceSync: {
            /** @enum {string} */
            mode: "incremental" | "full";
        };
        InsightGenerate: {
            source_version_ids: string[];
            /** Format: date-time */
            data_cutoff: string;
            /** Format: uuid */
            policy_version_id: string;
        };
        TopicActivate: {
            /** Format: uuid */
            plan_cycle_id: string;
            /** Format: uuid */
            policy_version_id: string;
            /** Format: date-time */
            scheduled_at?: string;
            platform_account_ids?: string[];
        };
        /** @description rules_json/asset_requirements由provider适配器固定JSON Schema验证，不接受模型臆测规则。 */
        PlatformProfileVersionCreate: {
            audience: string;
            style_samples: {
                [key: string]: unknown;
            }[];
            allowed_formats: string[];
            rules_json: {
                [key: string]: unknown;
            };
            rules_source_urls: string[];
            /** Format: date-time */
            rules_checked_at: string;
            asset_requirements: {
                [key: string]: unknown;
            };
        };
        /** @description 广告动作要求日/总预算非null；调价要求max_bid_change_pct；valid_until=null持续有效直到撤销/替换。嵌套规则固定Schema在领域服务校验。 content.publish限已批准新模块路径；接待账号和SOP范围单独配置。新稿新hash质检且规则匹配即自动执行，例外approval严格hash绑定。 */
        PolicyDefinition: {
            business_scope: {
                [key: string]: unknown;
            };
            account_ids: string[];
            allowed_actions: ("content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply")[];
            currency: string;
            daily_budget_minor: number | null;
            total_budget_minor: number | null;
            max_bid_change_pct: number | null;
            publish_frequency: {
                [key: string]: unknown;
            };
            publish_windows: {
                [key: string]: unknown;
            }[];
            stop_conditions: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            valid_from: string;
            valid_until: string | null;
            allowed_ad_operations: ("create" | "update" | "enable" | "pause")[];
            allowed_ad_entity_levels: ("account" | "campaign" | "unit" | "keyword" | "negative_keyword" | "creative")[];
            approved_path_prefixes: string[];
            reception_scope: {
                connection_ids?: string[];
                sop_version?: string;
                allowed_reply_classes?: string[];
                stop_conditions?: {
                    /** @constant */
                    on_withdrawal?: true;
                    /** @constant */
                    max_silent_followups?: 2;
                    /** @constant */
                    max_questions_per_turn?: 1;
                };
            };
        };
        /** @description 新建draft及版本，不能仅POST后就视为已授权。 */
        ExecutionPolicyCreate: {
            name: string;
            definition: components["schemas"]["PolicyDefinition"];
        };
        /** @description 仅owner显式激活版本，服务器记录approved_by/at；worker不得调用。 */
        ExecutionPolicyActivate: {
            /** Format: uuid */
            version_id: string;
        };
        /** @description 撤销即阻止未执行动作，实际已发布内容的撤回另走授权动作。 */
        ExecutionPolicyRevoke: {
            reason: string;
        };
        /** @description 服务器从绑定素材解析内容hash和排期槽位，policy_version_id XOR approval_id；只有实际核验才算published_verified。 */
        PublishJobCreate: {
            /** Format: uuid */
            content_variant_id: string;
            /** Format: uuid */
            platform_account_id: string;
            /** Format: date-time */
            scheduled_at: string;
            /** Format: uuid */
            policy_version_id?: string;
            /** Format: uuid */
            approval_id?: string;
        } & (unknown | unknown);
        PublishAccepted: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                job_id: string;
                /** Format: uuid */
                action_id: string;
                /** @enum {string} */
                status: "scheduled" | "queued" | "executing" | "submitted" | "in_review" | "published_verified" | "retry_wait" | "blocked" | "rejected" | "failed" | "unknown" | "cancelled";
                /** @enum {string} */
                verification_status: "unverified" | "verified" | "absent" | "mismatch" | "unknown";
                /** @enum {string} */
                mode: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        ConnectionHealth: {
            data: components["schemas"]["ConnectionRead"];
            meta: components["schemas"]["Meta"];
        };
        PlatformSessionState: {
            data: components["schemas"]["PlatformAccountRead"];
            meta: components["schemas"]["Meta"];
        };
        LoginSessionCreate: {
            /**
             * @description 人工交互最长时限，默认900秒；不是票据寿命。票据固定60秒内一次兑换。
             * @default 900
             */
            ttl_seconds: number;
        };
        LoginSessionCreated: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                ticket_expires_at: string;
                /** Format: date-time */
                expires_at: string;
                /** @constant */
                interaction_ready: false;
                /** @constant */
                status: "login_proxy_integration_required";
                interaction_ticket: string | null;
                interaction_url: null;
                replay: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        LoginSessionState: {
            data: components["schemas"]["LoginSessionRead"];
            meta: components["schemas"]["Meta"];
        };
        /** @description 只在当前已认证且与该login_session.user_id匹配的用户会话兑换；服务端仅计算hash验证，不存原文；过期或已消费返回403/409。 */
        LoginSessionRedeem: {
            ticket: string;
        };
        ScoreComponent: {
            value: number | null;
            /** @description 仅已批准numeric_calibrated配置的实际权重，不使用固定预设 */
            weight: number;
            claim_ids: string[];
            metric_snapshot_refs: {
                [key: string]: unknown;
            }[];
        };
        ScoreBreakdown: {
            /** @enum {string} */
            mode: "qualitative" | "numeric_calibrated";
            rule_version: string;
            components: {
                key: string;
                /** @enum {string} */
                label: "high" | "medium" | "low" | "unknown";
                reason: string;
                numeric: components["schemas"]["ScoreComponent"] | null;
                claim_ids: string[];
            }[];
            coverage: number | null;
            available_weight: number | null;
            /** @enum {string} */
            calibration_status: "pending" | "approved" | "revoked";
        };
        /** @description qualitative为初始模式：priority_score=null，按理由与业务规则排列；数值仅批准校准后可用，不能替代执行授权。 */
        InsightRead: {
            /** Format: uuid */
            id: string;
            summary: string;
            /** @enum {string} */
            business_line: "yonyou" | "seeyon" | "shared";
            customer_problem: string;
            opportunity: string;
            inference_text: string | null;
            priority_score: number | null;
            score_breakdown: components["schemas"]["ScoreBreakdown"] | Record<string, never>;
            /** Format: date-time */
            data_cutoff: string;
            /** @enum {string} */
            state: "candidate" | "ready" | "blocked" | "superseded" | "discarded";
            claim_ids: string[];
            /** @enum {string} */
            priority_label: "P0" | "P1" | "P2";
            /** @enum {string} */
            scoring_mode: "qualitative" | "numeric_calibrated";
            /** Format: uuid */
            metric_policy_version_id: string | null;
        } & unknown;
        TopicRead: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            insight_id: string | null;
            title: string;
            audience: string;
            problem: string;
            offer: string;
            angle: string;
            /**
             * @description 定性优先级；无数值评分默认值。
             * @enum {string}
             */
            priority: "P0" | "P1" | "P2";
            /** @enum {string} */
            state: "candidate" | "ready" | "scheduled" | "active" | "completed" | "blocked" | "discarded";
            /** Format: date-time */
            scheduled_at: string | null;
            /** Format: uuid */
            policy_version_id: string | null;
            claim_ids: string[];
            version: number;
            industry_key: string | null;
            product_family_key: string | null;
            domain_keys: string[];
        };
        PublishJobRead: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            action_id: string;
            /** Format: uuid */
            platform_account_id: string;
            /** Format: uuid */
            content_variant_id: string;
            /** Format: date-time */
            scheduled_at: string;
            /** @enum {string} */
            delivery_state: "scheduled" | "queued" | "executing" | "submitted" | "in_review" | "published_verified" | "retry_wait" | "blocked" | "rejected" | "failed" | "unknown" | "cancelled";
            external_id: string | null;
            /** Format: uri */
            published_url: string | null;
            /** @enum {string} */
            verification_status: "unverified" | "verified" | "absent" | "mismatch" | "unknown";
            /** Format: date-time */
            verified_at: string | null;
            submission_receipt: {
                [key: string]: unknown;
            } | null;
            /** @description 实际账号/内容/发布位置核验的私有证据引用与脱敏回读摘要；尚未核验时null；不含Cookie/token或原始临时票据 */
            verification_evidence_ref: {
                [key: string]: unknown;
            } | null;
        };
        InsightList: {
            data: components["schemas"]["InsightRead"][];
            meta: components["schemas"]["Meta"];
        };
        TopicList: {
            data: components["schemas"]["TopicRead"][];
            meta: components["schemas"]["Meta"];
        };
        PublishJobList: {
            data: components["schemas"]["PublishJobRow"][];
            meta: components["schemas"]["Meta"];
        };
        PublishJobResource: {
            data: components["schemas"]["PublishJobRowFull"];
            meta: components["schemas"]["Meta"];
        };
        /** @description 必须精确匹配服务端保存的脱敏AI提议/会话快照；任意客户端文字不自动授权发送。重新检查会话version、当前规则、隐私及取消条件后实际发送并回读。 */
        ReceptionReplyPayload: {
            /** Format: uuid */
            conversation_id: string;
            conversation_version: number;
            /** Format: uuid */
            ai_run_id: string;
            reply_text: string;
            question_count: number;
            /** @enum {string} */
            reply_class: "useful_answer" | "one_question" | "contact_value_explanation" | "identity_disclosure" | "silent_followup" | "handoff_acknowledgement" | "contact_captured_acknowledgement";
            expected_conversation_hash: string;
        };
        BusinessMasterRead: {
            data: {
                version: string;
                /** @enum {string} */
                category: "product_family" | "business_domain" | "industry" | "service" | "business_rule" | "all";
                items: {
                    /** Format: uuid */
                    id: string;
                    category: string;
                    business_key: string;
                    version_no: number;
                    name: string;
                    aliases: string[];
                    /** @enum {string} */
                    status: "confirmed" | "recommended" | "pending" | "revoked";
                    payload: {
                        [key: string]: unknown;
                    };
                    /** Format: uuid */
                    source_version_id: string;
                    source_locator: {
                        [key: string]: unknown;
                    };
                }[];
            };
            meta: components["schemas"]["Meta"];
        };
        ChannelAcceptanceRead: {
            data: {
                channelId: string;
                displayName: string;
                role: string;
                requiredCapabilities: string[];
                formatCandidates: string[];
                /** @constant */
                requiredInV1: true;
                /** @enum {string} */
                implementationStatus: "pending" | "verified";
                enabled: boolean;
                accounts: {
                    /** Format: uuid */
                    id: string;
                    accessStatus: string;
                    sessionStatus: string;
                }[];
                credentialConfigured: boolean;
            }[];
            meta: components["schemas"]["Meta"];
        };
        /** @description lawful_basis由已批准隐私配置派生且服务端核验，非客户端自由授予合法依据；咨询处理与长期营销同意独立。 */
        ContactCaptureCreate: {
            event_key: string;
            /** @enum {string} */
            contact_type: "phone" | "wechat" | "email" | "inbound_call";
            contact_value: string;
            company?: string;
            source_channel: string;
            /** Format: uuid */
            conversation_id?: string | null;
            commercial_intent?: string;
            intent_evidence_ref?: {
                [key: string]: unknown;
            };
            privacy_notice_version: string;
            /** @constant */
            consent: true;
            allowed_contact_channels: ("phone" | "wechat" | "email")[];
            lawful_basis?: string;
            /** @default false */
            marketing_consent: boolean;
        };
        ContactCaptureAccepted: {
            data: {
                /** Format: uuid */
                contact_id: string;
                /** Format: uuid */
                capture_id: string;
                /** Format: uuid */
                lead_id: string | null;
                /** @enum {string} */
                classification: "contact_capture" | "real_lead";
                deduplicated: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        /** @description 受理request_id关联privacy_request workflow及追加审计，下游停止/删除/导出回执不可覆盖；撤回即时取消持续营销任务。 */
        ContactPrivacyUpdate: {
            /** @enum {string} */
            request_type: "withdraw" | "delete" | "export";
            channels?: ("phone" | "wechat" | "email")[];
            reason?: string;
        };
        /** @description 只创建draft，不启用。归因和成熟期未配置时optimization_enabled必须false；numeric_calibrated必须有校准证据。批准另由owner显式调用，百度写还须持续执行规则。 */
        MetricPolicyVersionCreate: {
            dedupe_window_days: number;
            attribution_window_days: number | null;
            cohort_maturation_window_days: number | null;
            /** @enum {string} */
            scoring_mode: "qualitative" | "numeric_calibrated";
            scoring_config: {
                [key: string]: unknown;
            };
            calibration_evidence_refs: {
                [key: string]: unknown;
            }[];
            optimization_enabled: boolean;
        };
        MetricPolicyRead: {
            data: {
                /** Format: uuid */
                id: string | null;
                version_no: number | null;
                /** @enum {string} */
                status: "pending" | "draft" | "approved" | "revoked";
                dedupe_window_days: number;
                attribution_window_days: number | null;
                cohort_maturation_window_days: number | null;
                /** @enum {string} */
                scoring_mode: "qualitative" | "numeric_calibrated";
                optimization_enabled: boolean;
                /** Format: uuid */
                approved_by: string | null;
                /** Format: date-time */
                approved_at: string | null;
            };
            meta: components["schemas"]["Meta"];
        };
        MetricPolicyApprove: {
            payload_hash: string;
            reason?: string;
        };
        /** @description 仅已鉴权内部connector调用。原PII在采集边界按隐私配置加密、脱敏；验证平台签名/来源去重，禁止用户任意伪造真实接待事件。 */
        ReceptionEventIngest: {
            /** Format: uuid */
            connection_id: string;
            external_event_id: string;
            external_conversation_id: string;
            external_message_id?: string;
            /** @enum {string} */
            event_type: "visitor_message" | "contact_captured" | "delivery_receipt" | "handoff_receipt" | "closed";
            /** Format: date-time */
            occurred_at: string;
            sanitized_text?: string;
            encrypted_payload_ref?: string;
            receipt?: {
                [key: string]: unknown;
            };
        };
        ReceptionConversationRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                connection_id: string;
                external_conversation_id: string;
                /** Format: uuid */
                contact_id: string | null;
                /** Format: uuid */
                lead_id: string | null;
                /** @enum {string} */
                state: "bot_active" | "waiting_customer" | "contact_captured" | "handoff_requested" | "human_active" | "closed" | "blocked";
                /** @enum {string} */
                handoff_status: "none" | "requested" | "assigned" | "completed" | "failed";
                /** Format: date-time */
                first_response_at: string | null;
                silent_followup_count: number;
                version: number;
                messages: {
                    /** Format: uuid */
                    id: string;
                    /** @enum {string} */
                    role: "visitor" | "assistant" | "human" | "system";
                    sanitized_text: string;
                    /** Format: date-time */
                    occurred_at: string;
                    /** @enum {string} */
                    delivery_status: "received" | "proposed" | "submitted" | "delivered_verified" | "unknown" | "failed";
                }[];
            };
            meta: components["schemas"]["Meta"];
        };
        ReceptionHandoff: {
            /** Format: uuid */
            owner_user_id: string;
            reason: string;
            next_step?: string;
        };
        ReceptionReplyGenerate: {
            conversation_version: number;
            /** @enum {string} */
            reason: "visitor_message" | "silent_followup" | "identity_question" | "handoff_request";
            /** Format: uuid */
            policy_version_id: string;
        };
        /** @description funnel_stage为独立漏斗字段，quality_level单独真实/销售确认质量字段。允许实际流程跳过演示/方案/报价；商机、报价、成交仍分别核实必需字段。完整证据下可同事务保存sales接受/机会/成交事件；缺销售接受或合同金额日期不能直接WON。 */
        LeadTransitionCreate: {
            /** @enum {string} */
            funnel_stage: "CONTACTED" | "QUALIFIED" | "OPPORTUNITY" | "DEMO" | "PROPOSAL" | "QUOTED" | "WON" | "LOST" | "NURTURE" | "REACTIVATED";
            evidence_ref: {
                [key: string]: unknown;
            };
            next_step: string;
            /** Format: uuid */
            opportunity_id: string | null;
            opportunity_details?: {
                problem?: string;
                product_or_scope?: string;
                sales_acceptance_evidence?: {
                    [key: string]: unknown;
                };
                quote_external_id?: string;
                /** Format: date */
                quote_date?: string;
                quote_scope?: string;
                contract_or_order_ref?: {
                    [key: string]: unknown;
                };
                amount_minor?: number;
                currency?: string;
                /** Format: date-time */
                won_at?: string;
            };
        };
        ConnectionRead: {
            /** Format: uuid */
            id: string;
            provider: string;
            display_name: string;
            timezone: string;
            currency: string;
            /** @enum {string} */
            health: "unknown" | "healthy" | "partial" | "stale" | "rate_limited" | "failed" | "disabled";
            enabled_for_reporting: boolean;
            authoritative_report_type: string | null;
            last_success_at: string | null;
            capabilities_verified_at: string | null;
            source_kind: ("market_public" | "competitor_public" | "mac_drive" | "chatgpt" | "other") | null;
            /** @enum {string} */
            read_mode: "native_api" | "authorized_browser" | "drive_sync" | "manual_import" | "mock";
            /** @enum {string} */
            access_status: "not_configured" | "verifying" | "connected" | "auth_required" | "unsupported" | "disabled";
            last_attempt_at: string | null;
            last_error_code: string | null;
            edit_version: string;
        };
        TopicReadItem: {
            data: components["schemas"]["TopicRead"];
            meta: components["schemas"]["Meta"];
        };
        SourceVersionRead: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            document_id: string;
            revision: string;
            content_hash: string;
            object_key: string;
            mime_type: string;
            extraction_status: string;
            text_object_key: string | null;
            /** Format: date-time */
            retrieved_at: string;
            source_modified_at: string | null;
            /** @enum {string} */
            visibility: "internal" | "public" | "restricted";
            coverage_json: Record<string, never> | unknown[];
        };
        BusinessMasterReadItem: {
            /** Format: uuid */
            id: string;
            /** @enum {unknown} */
            category: "product_family" | "business_domain" | "industry" | "service" | "business_rule";
            business_key: string;
            name: string;
            /** @enum {unknown} */
            status: "confirmed" | "recommended" | "pending" | "revoked";
            aliases: string[];
            version_no: number;
        };
        TopicCreate: {
            title: string;
            /** @enum {unknown} */
            business_line: "yonyou" | "seeyon" | "shared";
            audience: string;
            problem: string;
            offer: string;
            angle: string;
            claim_ids: string[];
            /** @enum {unknown} */
            priority?: "P0" | "P1" | "P2";
            industry_key?: string | null;
            product_family_key?: string | null;
            domain_keys?: string[];
            insight_id?: string | null;
        };
        TopicUpdate: {
            title?: string;
            /** @enum {unknown} */
            business_line?: "yonyou" | "seeyon" | "shared";
            audience?: string;
            problem?: string;
            offer?: string;
            angle?: string;
            claim_ids?: string[];
            /** @enum {unknown} */
            priority?: "P0" | "P1" | "P2";
            industry_key?: string | null;
            product_family_key?: string | null;
            domain_keys?: string[];
            insight_id?: string | null;
        };
        SourceUpdate: {
            expected_current_version_id: string | null;
            title?: string;
            /** @enum {unknown} */
            visibility?: "internal" | "public";
        };
        SourceDelete: {
            expected_current_version_id: string | null;
        };
        EmptyCommand: Record<string, never>;
        ImportBatchRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            connection_id: string;
            report_type: string;
            /** Format: date */
            window_start: string;
            /** Format: date */
            window_end: string;
            file_hash: string;
            object_key: string;
            schema_version: string;
            mapping: {
                [key: string]: unknown;
            } | unknown[];
            state: string;
            quality: string;
            row_count: number;
            error_count: number;
            source_total: ({
                [key: string]: unknown;
            } | unknown[]) | null;
            source_watermark: string | null;
            complete_confirmed_by: string | null;
        };
        ReportSnapshotRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            kind: string;
            /** Format: date */
            period_start: string;
            /** Format: date */
            period_end: string;
            revision: number;
            metric_version: string;
            source_batch_ids: string[];
            query_hash: string;
            /** Format: date-time */
            data_cutoff: string;
            quality: string;
            metrics_json: {
                [key: string]: unknown;
            } | unknown[];
            body_json: {
                [key: string]: unknown;
            } | unknown[];
            archive_status: string;
            drive_file_id: string | null;
            archive_hash: string | null;
            archived_at: string | null;
        };
        MetricPolicyRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            policy_key: string;
            version_no: number;
            /** @enum {unknown} */
            status: "draft" | "approved" | "revoked";
            dedupe_window_days: number;
            attribution_window_days: number | null;
            cohort_maturation_window_days: number | null;
            /** @enum {unknown} */
            scoring_mode: "qualitative" | "numeric_calibrated";
            scoring_config: {
                [key: string]: unknown;
            } | unknown[];
            calibration_evidence_refs: {
                [key: string]: unknown;
            } | unknown[];
            optimization_enabled: boolean;
            approved_by: string | null;
            approved_at: string | null;
            payload_hash: string;
        };
        ImportPreflightRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** @enum {unknown} */
                state: "validated" | "rejected" | "committed";
                /** @enum {unknown} */
                quality: "complete" | "partial" | "missing" | "stale" | "unsupported" | "quarantined";
                rowCount: number;
                errors: {
                    row: number;
                    code: string;
                    message: string;
                }[];
                duplicate: boolean;
                fileHash: string;
                /** @enum {unknown} */
                mode: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        ImportCommitRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** @constant */
                state: "committed";
                duplicate: boolean;
                /** @enum {unknown} */
                mode: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        ImportBatchRead: {
            data: components["schemas"]["ImportBatchRow"];
            meta: components["schemas"]["Meta"];
        };
        ReportRead: {
            data: components["schemas"]["ReportSnapshotRow"];
            meta: components["schemas"]["Meta"];
        };
        ReportsRead: {
            data: {
                /** @enum {unknown} */
                mode: "mock" | "live";
                reports: components["schemas"]["ReportSnapshotRow"][];
                realAcceptance: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        ReportCreated: {
            data: {
                /** Format: uuid */
                id: string;
                revision: number;
                duplicate: boolean;
                /** @enum {unknown} */
                mode: "mock" | "live";
                /** @enum {unknown} */
                quality: "complete" | "partial" | "missing" | "stale" | "unsupported" | "quarantined";
            };
            meta: components["schemas"]["Meta"];
        };
        ReportGenerate: {
            /** @enum {unknown} */
            kind: "daily" | "weekly";
            /** Format: date */
            period_start: string;
            /** Format: date */
            period_end: string;
            connection_ids?: string[];
        };
        MetricPolicyDraftCreated: {
            data: {
                /** Format: uuid */
                id: string;
                versionNo: number;
                /** @constant */
                status: "draft";
                payloadHash: string;
                /** @constant */
                optimizationEnabled: false;
                proposedOptimizationEnabled: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        MetricPolicyApproved: {
            data: {
                /** Format: uuid */
                id: string;
                /** @constant */
                status: "approved";
                duplicate: boolean;
                optimizationEnabled?: boolean;
                dataGateRequired?: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        MetricPolicyCurrentRead: {
            data: components["schemas"]["MetricPolicyRow"] | {
                /** Format: uuid */
                id: string | null;
                version_no: number | null;
                /** @enum {string} */
                status: "pending" | "draft" | "approved" | "revoked";
                dedupe_window_days: number;
                attribution_window_days: number | null;
                cohort_maturation_window_days: number | null;
                /** @enum {string} */
                scoring_mode: "qualitative" | "numeric_calibrated";
                optimization_enabled: boolean;
                /** Format: uuid */
                approved_by: string | null;
                /** Format: date-time */
                approved_at: string | null;
            };
            meta: components["schemas"]["Meta"];
        };
        AdMetricDay: {
            /** Format: date */
            date: string;
            /** @enum {string} */
            quality: "missing" | "complete" | "partial" | "stale";
            spendMinor: number | null;
            impressions: number | null;
            clicks: number | null;
            platformConversions: number | null;
        };
        AdMetricAccount: {
            /** Format: uuid */
            connectionId: string;
            accountName: string;
            currency: string;
            authoritativeReportType: string;
            /** @enum {string} */
            quality: "missing" | "complete" | "partial" | "stale";
            daily: components["schemas"]["AdMetricDay"][];
            observedSpendMinor: number | null;
            spendMinor: number | null;
            clicks: number | null;
            impressions: number | null;
            ctr: number | null;
            cpcMinor: number | null;
            platformConversions: number | null;
            batchIds: string[];
            /** Format: date-time */
            sourceWatermark: string | null;
            sourceKinds: string[];
            realLeads: null;
            paidCplMinor: null;
            /** @constant */
            optimizationEligible: false;
        };
        AdMetricsRead: {
            data: {
                /** @enum {string} */
                mode: "mock" | "live";
                /** Format: date */
                start: string;
                /** Format: date */
                end: string;
                /** @enum {string} */
                quality: "missing" | "complete" | "partial";
                currency: string | null;
                spendMinor: number | null;
                /** Format: date-time */
                dataCutoff: string;
                accounts: components["schemas"]["AdMetricAccount"][];
                batchIds: string[];
                attribution: {
                    /** @constant */
                    status: "unavailable";
                    paidCplMinor: null;
                    reason: string;
                };
            };
            meta: components["schemas"]["Meta"];
        };
        SourceDocumentRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            provider: string;
            provider_file_id: string | null;
            source_url: string | null;
            title: string;
            visibility: string;
            /** Format: uuid */
            owner_user_id: string;
            deleted_at: string | null;
            connection_id: string | null;
            /** @enum {string} */
            source_kind: "market_public" | "competitor_public" | "mac_drive" | "chatgpt" | "other";
            current_version_id: string | null;
            source_modified_at: string | null;
            conversation_id: string | null;
        };
        SourceDocumentRead: {
            data: components["schemas"]["SourceDocumentRow"];
            meta: components["schemas"]["Meta"];
        };
        SourceDocumentSummary: {
            /** Format: uuid */
            id: string;
            provider: string;
            provider_file_id: string | null;
            source_url: string | null;
            title: string;
            visibility: string;
            deleted_at: string | null;
            connection_id: string | null;
            /** @enum {string} */
            source_kind: "market_public" | "competitor_public" | "mac_drive" | "chatgpt" | "other";
            current_version_id: string | null;
            source_modified_at: string | null;
            conversation_id: string | null;
        };
        SourceDocumentsRead: {
            data: components["schemas"]["SourceDocumentSummary"][];
            meta: components["schemas"]["Meta"];
        };
        SourceVersionsRead: {
            data: components["schemas"]["SourceVersionRead"][];
            meta: components["schemas"]["Meta"];
        };
        SourceSyncBlocked: {
            data: {
                /** Format: uuid */
                run_id: string;
                /** @constant */
                status: "needs_human";
                /** @constant */
                source_result: "failed";
                /** @enum {string} */
                source_kind: "market_public" | "competitor_public" | "mac_drive" | "chatgpt";
                gaps: string[];
            };
            meta: components["schemas"]["Meta"];
        };
        ContentCreated: {
            data: {
                /** Format: uuid */
                id: string;
                version: number;
            };
            meta: components["schemas"]["Meta"];
        };
        ContentReviewed: {
            data: {
                /** Format: uuid */
                id: string;
                review_status: string;
                /** @constant */
                execution_authorized: false;
            };
            meta: components["schemas"]["Meta"];
        };
        ContentGenerationAccepted: {
            data: {
                /** Format: uuid */
                run_id: string;
                /** @constant */
                status: "queued";
                /** @constant */
                missing_capability: "content_generation_gateway";
                /** @constant */
                execution_authorized: false;
            };
            meta: components["schemas"]["Meta"];
        };
        PagePatched: {
            data: {
                /** Format: uuid */
                id: string;
                version: number;
                /** @constant */
                published_content_unchanged: true;
            };
            meta: components["schemas"]["Meta"];
        };
        PageReleaseAccepted: {
            data: {
                /** Format: uuid */
                release_id: string;
                /** Format: uuid */
                page_id: string;
                version: number;
                state: string;
                /** @enum {string} */
                mode: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        PlatformProfileCreated: {
            data: {
                /** Format: uuid */
                id: string;
                version: number;
            };
            meta: components["schemas"]["Meta"];
        };
        PlatformProfileVersionCreated: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                profile_id: string;
                version: number;
                version_no: number;
                /** @constant */
                calibrated: false;
            };
            meta: components["schemas"]["Meta"];
        };
        PlatformProfileCalibrated: {
            data: {
                /** Format: uuid */
                id: string;
                version: number;
                /** @constant */
                calibrated: true;
                /** @constant */
                native_capabilities_verified: false;
            };
            meta: components["schemas"]["Meta"];
        };
        ContentVariantCreated: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                content_version_id: string;
                payload_hash: string;
                /** @constant */
                validation_status: "passed";
                /** @constant */
                execution_authorized: false;
                /** @enum {string} */
                mode: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        PublishJobRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            platform_account_id: string;
            /** Format: uuid */
            content_variant_id: string;
            /** Format: date-time */
            scheduled_at: string;
            /** @enum {string} */
            delivery_state: "scheduled" | "queued" | "executing" | "submitted" | "in_review" | "published_verified" | "retry_wait" | "blocked" | "rejected" | "failed" | "unknown" | "cancelled";
            external_id: string | null;
            published_url: string | null;
            submission_receipt: (Record<string, never> | unknown[]) | null;
            /** @enum {string} */
            verification_status: "unverified" | "verified" | "absent" | "mismatch" | "unknown";
            verification_evidence_ref: (Record<string, never> | unknown[]) | null;
            verified_at: string | null;
            /** Format: uuid */
            action_id: string;
        };
        ApprovalRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            action_type: string;
            target: Record<string, never> | unknown[];
            version_id: string | null;
            payload: Record<string, never> | unknown[];
            payload_hash: string;
            before_snapshot: Record<string, never> | unknown[];
            after_preview: Record<string, never> | unknown[];
            budget_impact: Record<string, never> | unknown[];
            /** Format: uuid */
            requested_by: string;
            decision: string;
            decided_by: string | null;
            decided_at: string | null;
            /** Format: date-time */
            expires_at: string;
            reason: string | null;
            version: number;
        };
        ExecutionActionRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            approval_id: string | null;
            idempotency_key: string;
            request_hash: string;
            /** @enum {string} */
            state: "queued" | "blocked" | "executing" | "submitted" | "waiting_review" | "verification_pending" | "retry_wait" | "succeeded" | "failed" | "unknown" | "externally_completed" | "cancelled";
            before_snapshot: Record<string, never> | unknown[];
            after_snapshot: (Record<string, never> | unknown[]) | null;
            external_id: string | null;
            lease_until: string | null;
            last_error: (Record<string, never> | unknown[]) | null;
            manual_receipt: (Record<string, never> | unknown[]) | null;
            version: number;
            policy_version_id: string | null;
            /** @enum {string} */
            action_type: "content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply";
            target: Record<string, never> | unknown[];
            version_id: string | null;
            payload: Record<string, never> | unknown[];
            payload_hash: string;
            verified_at: string | null;
            verification_evidence_ref: (Record<string, never> | unknown[]) | null;
            budget_snapshot: (Record<string, never> | unknown[]) | null;
            lease_owner: string | null;
            fencing_token: number | string;
        };
        PolicyVersionRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            policy_id: string;
            version_no: number;
            business_scope: Record<string, never> | unknown[];
            account_ids: string[];
            allowed_actions: string[];
            currency: string;
            daily_budget_minor: (number | string) | null;
            total_budget_minor: (number | string) | null;
            max_bid_change_pct: (number | string) | null;
            publish_frequency: Record<string, never> | unknown[];
            publish_windows: Record<string, never> | unknown[];
            stop_conditions: Record<string, never> | unknown[];
            /** Format: date-time */
            valid_from: string;
            valid_until: string | null;
            approved_by: string | null;
            approved_at: string | null;
            payload_hash: string;
            /** Format: uuid */
            created_by: string;
            allowed_ad_operations: ("create" | "update" | "enable" | "pause")[];
            allowed_ad_entity_levels: ("account" | "campaign" | "unit" | "keyword" | "negative_keyword" | "creative")[];
            approved_path_prefixes: string[];
            reception_scope: Record<string, never> | unknown[];
        };
        PolicyVersionCreated: {
            data: components["schemas"]["PolicyVersionRow"];
            meta: components["schemas"]["Meta"];
        };
        ConnectionsRead: {
            data: components["schemas"]["ConnectionRead"][];
            meta: components["schemas"]["Meta"];
        };
        PlatformAccountRead: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            connection_id: string;
            provider: string;
            display_name: string;
            enabled: boolean;
            /** @enum {string} */
            session_status: "not_connected" | "active" | "expired" | "challenge_required" | "revoked" | "unknown";
            session_expires_at: string | null;
            last_session_verified_at: string | null;
            timezone: string;
            version: number;
            session_version: number | string;
            channel_id: string | null;
        };
        PlatformAccountsRead: {
            data: components["schemas"]["PlatformAccountRead"][];
            meta: components["schemas"]["Meta"];
        };
        PlatformSessionVerifyAccepted: {
            data: {
                /** Format: uuid */
                command_id: string;
                state: string;
                /** @constant */
                verified: false;
                /** @constant */
                integration_status: "verification_required";
            };
            meta: components["schemas"]["Meta"];
        };
        LoginSessionRead: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            platform_account_id: string;
            /** Format: date-time */
            expires_at: string;
            /** @enum {string} */
            state: "created" | "active" | "completed" | "expired" | "cancelled" | "failed";
            started_at: string | null;
            completed_at: string | null;
            version: number;
            /** Format: date-time */
            ticket_expires_at: string;
        };
        LoginRedeemed: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                accountId: string;
                /** Format: date-time */
                expiresAt: string;
            };
            meta: components["schemas"]["Meta"];
        };
        ContentItemRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** @enum {string} */
            kind: "mother_draft" | "article" | "landing_page" | "case" | "ad_copy" | "qa" | "image_text" | "video_script" | "subtitle" | "storyboard";
            business_line: string;
            task_id: string | null;
            /** Format: uuid */
            owner_user_id: string;
            title: string;
            deleted_at: string | null;
            topic_id: string | null;
        };
        ContentVersionRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            content_item_id: string;
            version_no: number;
            body_json: Record<string, never> | unknown[];
            claim_ids: string[];
            payload_hash: string;
            review_status: string;
            reviewed_by: string | null;
            reviewed_at: string | null;
            ai_run_id: string | null;
            warnings: Record<string, never> | unknown[];
        };
        PageRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            host: string;
            path: string;
            owner_system: string;
            business_line: string;
            template_key: string | null;
            content_item_id: string | null;
            primary_keyword_id: string | null;
            seo_title: string | null;
            description: string | null;
            canonical_url: string;
            index_policy: string;
            form_schema_id: string | null;
            published_release_id: string | null;
            /** Format: uuid */
            owner_user_id: string;
            version: number;
        };
        ReleaseRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            page_id: string;
            /** Format: uuid */
            content_version_id: string;
            /** Format: uuid */
            action_id: string;
            /** Format: date-time */
            published_at: string;
            previous_release_id: string | null;
            rollback_of_id: string | null;
            seo_snapshot: Record<string, never> | unknown[];
            route_config_version: string;
        };
        PlatformProfileRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            platform_account_id: string;
            name: string;
            current_version_id: string | null;
            version: number;
        };
        PlatformProfileVersionRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            profile_id: string;
            version_no: number;
            audience: string;
            style_samples: Record<string, never> | unknown[];
            allowed_formats: string[];
            rules_json: Record<string, never> | unknown[];
            rules_source_urls: string[];
            /** Format: date-time */
            rules_checked_at: string;
            asset_requirements: Record<string, never> | unknown[];
            calibrated_at: string | null;
            calibrated_by: string | null;
            payload_hash: string;
        };
        ContentVariantRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            mother_content_version_id: string;
            /** Format: uuid */
            content_version_id: string;
            /** Format: uuid */
            platform_account_id: string;
            /** Format: uuid */
            platform_profile_version_id: string;
            format: string;
            revision: number;
            asset_ids: string[];
            /** @enum {string} */
            validation_status: "pending" | "passed" | "blocked" | "failed";
            validation_json: Record<string, never> | unknown[];
            validated_at: string | null;
            validated_payload_hash: string | null;
            ai_generated: boolean;
            ai_label_requirement: Record<string, never> | unknown[];
            ai_label_applied: Record<string, never> | unknown[];
            ai_label_readback: (Record<string, never> | unknown[]) | null;
            ai_label_evidence_ref: (Record<string, never> | unknown[]) | null;
        };
        EvidenceClaimRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            claim_text: string;
            /** Format: uuid */
            source_version_id: string;
            locator: Record<string, never> | unknown[];
            verification_status: string;
            verified_by: string | null;
            verified_at: string | null;
            valid_until: string | null;
            visibility: string;
            public_permission: string;
            permission_evidence_ref: (Record<string, never> | unknown[]) | null;
            version: number;
            /** @enum {string} */
            assertion_type: "fact" | "inference" | "decision";
            decision_status: ("proposed" | "confirmed" | "revoked" | "disputed") | null;
            supersedes_claim_id: string | null;
            decision_evidence_ref: (Record<string, never> | unknown[]) | null;
            source_date: string | null;
            calculation_scope: string | null;
            applicable_scope: (Record<string, never> | unknown[]) | null;
            content_hash: string | null;
            claim_category: string | null;
        };
        ExecutionPolicyRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            name: string;
            /** @enum {string} */
            status: "draft" | "active" | "paused" | "revoked";
            active_version_id: string | null;
            version: number;
            /** Format: uuid */
            created_by: string;
            revoked_at: string | null;
        };
        ActionAttemptRow: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            action_id: string;
            attempt_no: number;
            request_id: string;
            request_digest: string;
            response_digest: string | null;
            result: string;
            /** Format: date-time */
            started_at: string;
            finished_at: string | null;
            /** @enum {string} */
            phase: "submit" | "verify" | "reconcile";
        };
        ContentItemRead: {
            data: components["schemas"]["ContentItemRow"];
            meta: components["schemas"]["Meta"];
        };
        PageRead: {
            data: components["schemas"]["PageRow"];
            meta: components["schemas"]["Meta"];
        };
        PlatformProfileRead: {
            data: components["schemas"]["PlatformProfileRow"];
            meta: components["schemas"]["Meta"];
        };
        ContentVariantRead: {
            data: components["schemas"]["ContentVariantRow"];
            meta: components["schemas"]["Meta"];
        };
        ContentVersionList: {
            data: components["schemas"]["ContentVersionRow"][];
            meta: components["schemas"]["Meta"];
        };
        PageList: {
            data: components["schemas"]["PageRow"][];
            meta: components["schemas"]["Meta"];
        };
        ReleaseList: {
            data: components["schemas"]["ReleaseRow"][];
            meta: components["schemas"]["Meta"];
        };
        PlatformProfileList: {
            data: components["schemas"]["PlatformProfileRow"][];
            meta: components["schemas"]["Meta"];
        };
        PlatformProfileVersionList: {
            data: components["schemas"]["PlatformProfileVersionRow"][];
            meta: components["schemas"]["Meta"];
        };
        ContentVariantList: {
            data: components["schemas"]["ContentVariantRow"][];
            meta: components["schemas"]["Meta"];
        };
        EvidenceClaimList: {
            data: components["schemas"]["EvidenceClaimRow"][];
            meta: components["schemas"]["Meta"];
        };
        ApprovalList: {
            data: components["schemas"]["ApprovalRow"][];
            meta: components["schemas"]["Meta"];
        };
        ContentItemSummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** @enum {string} */
            kind: "mother_draft" | "article" | "landing_page" | "case" | "ad_copy" | "qa" | "image_text" | "video_script" | "subtitle" | "storyboard";
            business_line: string;
            task_id: string | null;
            /** Format: uuid */
            owner_user_id: string;
            title: string;
            deleted_at: string | null;
            topic_id: string | null;
            version: number;
            latest_version_id: string | null;
            review_status: string | null;
        };
        ContentItemsRead: {
            data: components["schemas"]["ContentItemSummary"][];
            meta: components["schemas"]["Meta"];
        };
        ContentCreate: {
            title: string;
            kind: string;
            /** @enum {string} */
            business_line: "yonyou" | "seeyon" | "shared";
            /** Format: uuid */
            topic_id?: string;
            /** Format: uuid */
            task_id?: string;
        };
        PageUpdate: {
            seo_title?: string;
            description?: string;
            /** @enum {string} */
            index_policy?: "index" | "noindex";
        };
        PagePublish: {
            /** Format: uuid */
            action_id: string;
            /** Format: uuid */
            content_version_id: string;
        };
        PageRollback: {
            /** Format: uuid */
            action_id: string;
            /** Format: uuid */
            release_id: string;
        };
        PlatformProfileCreate: {
            /** Format: uuid */
            platform_account_id: string;
            name: string;
        };
        PagePreviewRead: {
            data: {
                page: components["schemas"]["PageRow"];
                content: components["schemas"]["ContentVersionRow"];
                modules: Record<string, never>[];
                /** @constant */
                preview: true;
                /** @constant */
                robots: "noindex, nofollow";
                /** @enum {string} */
                data_mode: "mock" | "live";
            };
            meta: components["schemas"]["Meta"];
        };
        PublishJobRowFull: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            /** Format: uuid */
            execution_action_id: string;
            /** Format: uuid */
            platform_account_id: string;
            /** Format: uuid */
            content_variant_id: string;
            /** Format: date-time */
            scheduled_at: string;
            schedule_slot_key: string;
            /** @enum {string} */
            delivery_state: "scheduled" | "queued" | "executing" | "submitted" | "in_review" | "published_verified" | "retry_wait" | "blocked" | "rejected" | "failed" | "unknown" | "cancelled";
            external_id: string | null;
            published_url: string | null;
            submission_receipt: (Record<string, never> | unknown[]) | null;
            /** @enum {string} */
            verification_status: "unverified" | "verified" | "absent" | "mismatch" | "unknown";
            verification_evidence_ref: (Record<string, never> | unknown[]) | null;
            verified_at: string | null;
            next_attempt_at: string | null;
        };
        EvidenceClaimRead: {
            data: components["schemas"]["EvidenceClaimRow"];
            meta: components["schemas"]["Meta"];
        };
        ExecutionActionsRead: {
            data: components["schemas"]["ExecutionActionRow"][];
            meta: components["schemas"]["Meta"];
        };
        ActionRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                org_id: string;
                /** Format: date-time */
                created_at: string;
                /** Format: date-time */
                updated_at: string;
                approval_id: string | null;
                idempotency_key: string;
                request_hash: string;
                /** @enum {string} */
                state: "queued" | "blocked" | "executing" | "submitted" | "waiting_review" | "verification_pending" | "retry_wait" | "succeeded" | "failed" | "unknown" | "externally_completed" | "cancelled";
                before_snapshot: Record<string, never> | unknown[];
                after_snapshot: (Record<string, never> | unknown[]) | null;
                external_id: string | null;
                lease_until: string | null;
                last_error: (Record<string, never> | unknown[]) | null;
                manual_receipt: (Record<string, never> | unknown[]) | null;
                version: number;
                policy_version_id: string | null;
                /** @enum {string} */
                action_type: "content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply";
                target: Record<string, never> | unknown[];
                version_id: string | null;
                payload: Record<string, never> | unknown[];
                payload_hash: string;
                verified_at: string | null;
                verification_evidence_ref: (Record<string, never> | unknown[]) | null;
                budget_snapshot: (Record<string, never> | unknown[]) | null;
                lease_owner: string | null;
                fencing_token: number | string;
                attempts: components["schemas"]["ActionAttemptRow"][];
            };
            meta: components["schemas"]["Meta"];
        };
        ExecutionPolicySummary: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            org_id: string;
            /** Format: date-time */
            created_at: string;
            /** Format: date-time */
            updated_at: string;
            name: string;
            /** @enum {string} */
            status: "draft" | "active" | "paused" | "revoked";
            active_version_id: string | null;
            version: number;
            /** Format: uuid */
            created_by: string;
            revoked_at: string | null;
            payload_hash: string | null;
            allowed_actions: string[] | null;
        };
        ExecutionPoliciesRead: {
            data: components["schemas"]["ExecutionPolicySummary"][];
            meta: components["schemas"]["Meta"];
        };
        ExecutionPolicyRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                org_id: string;
                /** Format: date-time */
                created_at: string;
                /** Format: date-time */
                updated_at: string;
                name: string;
                /** @enum {string} */
                status: "draft" | "active" | "paused" | "revoked";
                active_version_id: string | null;
                version: number;
                /** Format: uuid */
                created_by: string;
                revoked_at: string | null;
                versions: components["schemas"]["PolicyVersionRow"][];
            };
            meta: components["schemas"]["Meta"];
        };
        ExecutionPolicyCreated: {
            data: components["schemas"]["ExecutionPolicyRow"];
            meta: components["schemas"]["Meta"];
        };
        ReceptionReplyResult: {
            /** Format: uuid */
            action_id: string;
            /** @enum {string} */
            state: "queued" | "blocked" | "executing" | "submitted" | "waiting_review" | "verification_pending" | "retry_wait" | "succeeded" | "failed" | "unknown" | "externally_completed" | "cancelled";
            /** @enum {string} */
            delivery_status: "delivered_verified" | "unknown" | "submitted";
            /** Format: date-time */
            delivered_at?: string | null;
            synthetic?: boolean;
            /** @constant */
            replayed?: true;
        };
        ReceptionReplyAccepted: {
            data: components["schemas"]["ReceptionReplyResult"];
            meta: components["schemas"]["Meta"];
        };
        ReceptionEventAccepted: {
            data: {
                event_id: string;
                /** Format: uuid */
                conversation_id: string;
                version: number;
                /** @enum {string} */
                state: "bot_active" | "waiting_customer" | "contact_captured" | "handoff_requested" | "human_active" | "closed" | "blocked";
                /** @constant */
                status: "accepted";
                message_duplicate?: boolean;
            };
            meta: components["schemas"]["Meta"];
            duplicate: boolean;
            reply?: components["schemas"]["ReceptionReplyResult"] | components["schemas"]["ReceptionHandoffAccepted"] | null;
            gap?: string | null;
            processing_ms?: number;
            sla_verified?: boolean;
        };
        WorkspaceThemeInput: {
            title: string;
            /** @enum {unknown} */
            businessLine: "用友" | "致远" | "集成服务";
            /** @enum {unknown} */
            status: "草稿" | "进行中" | "待审核" | "已暂停";
            audience: string;
            goal: string;
            channels: ("官网" | "微信公众号" | "知乎" | "百度")[];
            owner: string;
            /** Format: uuid */
            ownerId?: string;
            tasks: {
                id: string;
                label: string;
                done: boolean;
            }[];
        };
        WorkspaceThemeRead: {
            data: {
                title: string;
                /** @enum {unknown} */
                businessLine: "用友" | "致远" | "集成服务";
                /** @enum {unknown} */
                status: "草稿" | "进行中" | "待审核" | "已暂停";
                audience: string;
                goal: string;
                channels: ("官网" | "微信公众号" | "知乎" | "百度")[];
                owner: string;
                /** Format: uuid */
                ownerId?: string;
                tasks: {
                    id: string;
                    label: string;
                    done: boolean;
                }[];
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                updatedAt: string;
                version: number;
            };
            meta: components["schemas"]["Meta"];
        };
        WorkspaceThemesRead: {
            data: {
                title: string;
                /** @enum {unknown} */
                businessLine: "用友" | "致远" | "集成服务";
                /** @enum {unknown} */
                status: "草稿" | "进行中" | "待审核" | "已暂停";
                audience: string;
                goal: string;
                channels: ("官网" | "微信公众号" | "知乎" | "百度")[];
                owner: string;
                /** Format: uuid */
                ownerId?: string;
                tasks: {
                    id: string;
                    label: string;
                    done: boolean;
                }[];
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                updatedAt: string;
                version: number;
            }[];
            meta: components["schemas"]["Meta"];
        };
        WorkspaceThemeBatch: {
            updates: {
                /** Format: uuid */
                id: string;
                version: number;
                theme: components["schemas"]["WorkspaceThemeInput"];
            }[];
        };
        WorkspaceMembersRead: {
            data: {
                /** Format: uuid */
                id: string;
                name: string;
                roles: string[];
            }[];
            meta: components["schemas"]["Meta"];
        };
        WorkspaceOverviewRead: {
            data: {
                tasks: {
                    /** Format: uuid */
                    id: string;
                    /** Format: uuid */
                    org_id: string;
                    /** Format: date-time */
                    created_at: string;
                    /** Format: date-time */
                    updated_at: string;
                    plan_cycle_id: string | null;
                    type: string;
                    title: string;
                    brief: Record<string, never> | unknown[];
                    business_line: string;
                    /** Format: uuid */
                    owner_user_id: string;
                    /** Format: date-time */
                    due_at: string;
                    priority: string;
                    status: string;
                    version: number;
                    owner_name: string;
                }[];
                connections: {
                    /** Format: uuid */
                    id: string;
                    provider: string;
                    display_name: string;
                    /** @enum {string} */
                    health: "unknown" | "healthy" | "partial" | "stale" | "rate_limited" | "failed" | "disabled";
                    last_success_at: string | null;
                    source_kind: ("market_public" | "competitor_public" | "mac_drive" | "chatgpt" | "other") | null;
                    /** @enum {string} */
                    access_status: "not_configured" | "verifying" | "connected" | "auth_required" | "unsupported" | "disabled";
                    last_error_code: string | null;
                }[];
                runs: {
                    /** Format: uuid */
                    id: string;
                    /** Format: date-time */
                    created_at: string;
                    /** @enum {string} */
                    kind: "source_watch" | "insight_topics" | "weekly_plan" | "platform_assets" | "publish_content" | "baidu_execute" | "metrics_collect" | "daily_report" | "seo_review" | "geo_review" | "import" | "archive" | "reception_reply" | "privacy_request";
                    status: string;
                    started_at: string | null;
                    finished_at: string | null;
                    error: (Record<string, never> | unknown[]) | null;
                }[];
                exceptions: {
                    /** Format: uuid */
                    id: string;
                    /** Format: date-time */
                    created_at: string;
                    /** @enum {string} */
                    state: "queued" | "blocked" | "executing" | "submitted" | "waiting_review" | "verification_pending" | "retry_wait" | "succeeded" | "failed" | "unknown" | "externally_completed" | "cancelled";
                    last_error: (Record<string, never> | unknown[]) | null;
                    /** @enum {string} */
                    action_type: "content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply";
                    target: Record<string, never> | unknown[];
                }[];
                /** @enum {unknown} */
                mode: "mock" | "live";
                /** @constant */
                externalWritesEnabled: false;
            };
            meta: components["schemas"]["Meta"];
        };
        OperatingScheduleInput: {
            enabled: boolean;
            /** @constant */
            timezone: "Asia/Shanghai";
            workflows: ("source_watch" | "insight_topics" | "weekly_plan" | "metrics_collect" | "daily_report" | "seo_review" | "geo_review" | "archive")[];
            business_lines: ("yonyou" | "seeyon" | "shared")[];
            goal_ids: string[];
            /** Format: uuid */
            policy_version_id?: string;
        };
        OperatingSchedule: {
            enabled: boolean;
            /** @constant */
            timezone: "Asia/Shanghai";
            workflows: ("source_watch" | "insight_topics" | "weekly_plan" | "metrics_collect" | "daily_report" | "seo_review" | "geo_review" | "archive")[];
            business_lines: ("yonyou" | "seeyon" | "shared")[];
            goal_ids: string[];
            /** Format: uuid */
            policy_version_id?: string;
            revision: number;
            /** Format: uuid */
            requested_by: string;
        };
        OperatingScheduleUpdated: {
            data: {
                /** @constant */
                key: "operating_schedule";
                value: components["schemas"]["OperatingSchedule"];
                schema_version: number;
            };
            meta: components["schemas"]["Meta"];
        };
        PrivacyConfigurationInput: {
            enabled: boolean;
            notice_version?: string;
            notice_text?: string;
            consultation_purpose?: string;
            lawful_basis?: string;
            retention_days?: number;
            allowed_contact_channels?: ("phone" | "wechat" | "email")[];
            pii_access_roles?: ("owner" | "marketer" | "sales")[];
            /** Format: uuid */
            responsible_user_id?: string;
            deletion_policy?: string;
            export_policy?: string;
            /** @enum {unknown} */
            cross_border_assessment?: "not_applicable" | "approved";
        } & unknown;
        PrivacyConfiguration: {
            enabled: boolean;
            notice_version?: string;
            notice_text?: string;
            consultation_purpose?: string;
            lawful_basis?: string;
            retention_days?: number;
            allowed_contact_channels?: ("phone" | "wechat" | "email")[];
            pii_access_roles?: ("owner" | "marketer" | "sales")[];
            /** Format: uuid */
            responsible_user_id?: string;
            deletion_policy?: string;
            export_policy?: string;
            /** @enum {unknown} */
            cross_border_assessment?: "not_applicable" | "approved";
            /** Format: uuid */
            approved_by: string;
            /** Format: date-time */
            approved_at: string;
        } & unknown;
        PrivacyConfigurationUpdated: {
            data: {
                /** @constant */
                key: "privacy_configuration";
                value: components["schemas"]["PrivacyConfiguration"];
                schema_version: number;
            };
            meta: components["schemas"]["Meta"];
        };
        SettingsRead: {
            data: {
                /** @enum {unknown} */
                key: "privacy_configuration" | "operating_schedule" | "site_policy" | "notification_channels" | "analytics_configuration";
                value: Record<string, never>;
                schema_version: number;
                /** Format: date-time */
                updated_at: string;
            }[];
            meta: components["schemas"]["Meta"];
        };
        NotificationsRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                created_at: string;
                /** Format: uuid */
                report_id: string;
                channel: string;
                status: string;
                sent_at: string | null;
                kind: string;
                /** Format: date */
                period_start: string;
                /** Format: date */
                period_end: string;
                revision: number;
                quality: string;
                read: boolean;
                /** @enum {unknown} */
                mode: "mock" | "live";
                /** @description 外部投递因全局或组织停写而暂停；不影响当前站内通知记录读取。 */
                external_delivery_paused?: boolean;
            }[];
            meta: components["schemas"]["Meta"] & unknown;
        };
        NotificationMarkedRead: {
            data: {
                /** Format: uuid */
                id: string;
                /** @constant */
                read: true;
            };
            meta: components["schemas"]["Meta"] & unknown;
        };
        ReportUpload: {
            /** @constant */
            content_type: "text/csv";
            csv: string;
        };
        ReportUploaded: {
            data: {
                object_key: string;
                file_hash: string;
                /** @constant */
                content_type: "text/csv";
            };
            meta: components["schemas"]["Meta"];
        };
        ReceptionHandoffAccepted: {
            data: {
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                request_id?: string;
                /** @enum {unknown} */
                status: "assigned" | "completed";
                version?: number;
                verified?: boolean;
                /** @constant */
                delivery_status?: "unknown";
                synthetic?: boolean;
            };
            meta: components["schemas"]["Meta"];
        };
        AnalyticsConfigurationInput: {
            enabled: boolean;
            notice_version?: string;
            purpose?: string;
            /** @constant */
            lawful_basis?: "consent";
            retention_days?: number;
            allowed_event_types?: ("page_view" | "cta_click" | "form_start" | "form_submit")[];
            allow_attribution?: boolean;
            allow_identifiers?: boolean;
        } & unknown;
        AnalyticsConfiguration: {
            enabled: boolean;
            notice_version?: string;
            purpose?: string;
            /** @constant */
            lawful_basis?: "consent";
            retention_days?: number;
            allowed_event_types?: ("page_view" | "cta_click" | "form_start" | "form_submit")[];
            allow_attribution?: boolean;
            allow_identifiers?: boolean;
            /** Format: uuid */
            approved_by: string;
            /** Format: date-time */
            approved_at: string;
        } & unknown;
        AnalyticsConfigurationUpdated: {
            data: {
                /** @constant */
                key: "analytics_configuration";
                value: components["schemas"]["AnalyticsConfiguration"];
                schema_version: number;
            };
            meta: components["schemas"]["Meta"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    post_imports: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportCreate"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportPreflightRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_imports_id_commit: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportCommit"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportCommitRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_imports_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportBatchRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_plans_generate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanGenerate"];
            };
        };
        responses: {
            /** @description 成功 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Async"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_content_generate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentGenerate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentGenerationAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_content_id_versions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentVersionList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_content_id_versions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "If-Match": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentVersionCreate"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VersionCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_content_versions_id_review: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewContent"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentReviewed"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_approvals: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_approvals: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalCreate"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_approvals_id_decisions: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalDecision"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApprovalCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_actions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionActionsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_actions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActionCreate"];
            };
        };
        responses: {
            /** @description 成功 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_actions_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_actions_id_reconcile: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Async"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_actions_id_manual_receipt: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ManualReceipt"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_pages: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_pages: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PageCreate"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_pages_id_preview: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PagePreviewRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_public_leads: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadSubmit"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeadReceipt"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_public_events: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventBatch"];
            };
        };
        responses: {
            /** @description 成功 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch_leads_id: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadUpdate"];
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resource"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_geo_observations: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GeoObservation"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ObservationCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get__sources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceDocumentsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_sources: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SourceCreate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceDocumentRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get__claims: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceClaimList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_claims: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClaimCreate"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClaimCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_claims_id_verify: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClaimVerify"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceClaimRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_runs_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resource"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_metrics: {
        parameters: {
            query?: {
                start_date?: string;
                end_date?: string;
                business_line?: "yonyou" | "seeyon" | "shared";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdMetricsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_reports: {
        parameters: {
            query?: {
                start_date?: string;
                end_date?: string;
                business_line?: "yonyou" | "seeyon" | "shared";
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post__reports: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportGenerate"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_reports_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_connections_id_health: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionHealth"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_connections_id_sync: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SourceSync"];
            };
        };
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Async"];
                };
            };
            /** @description 来源适配器尚未接通，持久化needs_human且不推进水位 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceSyncBlocked"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_insights_generate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InsightGenerate"];
            };
        };
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Async"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_topics_id_activate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TopicActivate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicReadItem"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "get_platform-profiles_id_versions": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformProfileVersionList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_platform_profiles_id_versions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlatformProfileVersionCreate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformProfileVersionCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_platform_accounts_id_session_verify: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformSessionVerifyAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_platform_accounts_id_session: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformSessionState"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_publish_jobs: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishJobList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_publish_jobs: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishJobCreate"];
            };
        };
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_execution_policies: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionPoliciesRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_execution_policies: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExecutionPolicyCreate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionPolicyCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_execution_policies_id_versions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PolicyDefinition"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PolicyVersionCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_execution_policies_id_activate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExecutionPolicyActivate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionPolicyCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_execution_policies_id_revoke: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExecutionPolicyRevoke"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionPolicyCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_insights: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InsightList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_topics: {
        parameters: {
            query?: {
                /** @description 本版不支持游标，传入将返回422。 */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post__topics: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TopicCreate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicReadItem"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_platform_accounts: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformAccountsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_publish_jobs_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化/异步受理，外部完成需核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishJobResource"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_platform_accounts_id_login_sessions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginSessionCreate"];
            };
        };
        responses: {
            /** @description 交互已创建；ticket_expires_at=创建后60秒，expires_at为交互最长时限，实际登录/账号核验待完成 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginSessionCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_login_sessions_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 当前交互和账号验证状态 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginSessionState"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_login_sessions_id_redeem: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginSessionRedeem"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginRedeemed"];
                };
            };
            /** @description 用户/票据不匹配、过期或已经使用 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_business_master: {
        parameters: {
            query?: {
                category?: "all" | "product_family" | "business_domain" | "industry" | "service" | "business_rule";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BusinessMasterRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_distribution_manifest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChannelAcceptanceRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_contact_captures: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContactCaptureCreate"];
            };
        };
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContactCaptureAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_contacts_id_privacy_requests: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContactPrivacyUpdate"];
            };
        };
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resource"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_metric_policies_current: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricPolicyCurrentRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_metric_policies_versions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetricPolicyVersionCreate"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricPolicyDraftCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_metric_policies_id_approve: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetricPolicyApprove"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetricPolicyApproved"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_reception_events: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceptionEventIngest"];
            };
        };
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceptionEventAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_reception_conversations_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceptionConversationRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_reception_conversations_id_handoff: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceptionHandoff"];
            };
        };
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceptionHandoffAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_reception_conversations_id_reply: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReceptionReplyGenerate"];
            };
        };
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceptionReplyAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_leads_id_stage_transitions: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadTransitionCreate"];
            };
        };
        responses: {
            /** @description 已持久化；外部动作完成需真实回读核验 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resource"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listConnectionRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    listSourceVersionRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceVersionsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get__topics_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicReadItem"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch__topics_id: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TopicUpdate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TopicReadItem"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get__sources_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceDocumentRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    delete__sources_id: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SourceDelete"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceDocumentRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch__sources_id: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SourceUpdate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SourceDocumentRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "post__business-master_initialize": {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmptyCommand"];
            };
        };
        responses: {
            /** @description 组织内记录或操作结果 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resource"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post__imports_preflight: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportCreate"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportPreflightRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post__reports_generate: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportGenerate"];
            };
        };
        responses: {
            /** @description 同步持久化实际结果；外部发布/通知仍需独立回读 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_content_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentItemRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_pages_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch_pages_id: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PageUpdate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PagePatched"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "get_platform-profiles_id": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformProfileRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "get_content-variants_id": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentVariantRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_pages_id_releases: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReleaseList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "get_platform-profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformProfileList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "post_platform-profiles": {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlatformProfileCreate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformProfileCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "get_content-variants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentVariantList"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "post_content-variants": {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentVariantCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_content: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentItemsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_content: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContentCreate"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContentCreated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_pages_id_publish: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PagePublish"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageReleaseAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_pages_id_rollback: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PageRollback"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageReleaseAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "post_platform-profiles_id_calibrate": {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmptyCommand"];
            };
        };
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlatformProfileCalibrated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    "get_execution-policies_id": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已持久化的实际响应；外部效果仍以读回核验为准 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExecutionPolicyRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_workspace_themes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceThemesRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_workspace_themes: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceThemeInput"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceThemeRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch_workspace_themes_id: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceThemeInput"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceThemeRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_workspace_themes_batch: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceThemeBatch"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceThemesRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_workspace_members: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceMembersRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_workspace_overview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkspaceOverviewRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    put_settings_operating_schedule: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperatingScheduleInput"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperatingScheduleUpdated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    put_settings_privacy_configuration: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PrivacyConfigurationInput"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrivacyConfigurationUpdated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_settings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_notifications: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationsRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_notifications_id_read: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmptyCommand"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationMarkedRead"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_uploads: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportUpload"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportUploaded"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_public_leads_public_site: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadSubmit"];
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LeadReceipt"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_public_events_public_site: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EventBatch"];
            };
        };
        responses: {
            /** @description 成功 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventAccepted"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    put_settings_analytics_configuration: {
        parameters: {
            query?: never;
            header: {
                "Idempotency-Key": string;
                "X-CSRF-Token": string;
                "If-Match": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AnalyticsConfigurationInput"];
            };
        };
        responses: {
            /** @description 实际已持久化响应 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalyticsConfigurationUpdated"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
