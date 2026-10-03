/* Generated from the engineering contract. Run npm run generate -w @boran/contracts. */

/**
 * 模型仅生成受约束提议和基于输入的报告解释。数字由SQL提供；source_versions、已有实体ID、账号/平台档案/规则及执行状态必须来自输入允许集合并由服务端逐一核验。新主张、洞察、选题和素材版本使用本次proposal_key，再由服务端分配UUID。结构合法不等于事实核实、公开许可、授权、实际媒体完整或发布成功。source_watch/publish_content/baidu_execute/metrics_collect 为确定性执行步骤，不由模型直接调用平台、SQL或改变规则。
 */
export type AiOutput =
  | {
      workflow: "weekly_plan";
      schema_version: 2;
      output: {
        /**
         * @maxItems 10
         */
        objectives: string[];
        /**
         * @maxItems 30
         */
        tasks: {
          title: string;
          business_line: "yonyou" | "seeyon" | "shared";
          audience: string;
          question: string;
          /**
           * @maxItems 20
           */
          keywords: string[];
          /**
           * 显示标签；实际执行目标使用targets中的账号与档案版本。
           */
          channel: string;
          deliverable: "content" | "page" | "ad_experiment" | "evidence" | "seo_review";
          metric_key: string;
          /**
           * @maxItems 30
           */
          evidence_ids: string[];
          assumption?: string;
          topic_id: Uuid;
          /**
           * @minItems 1
           * @maxItems 20
           */
          targets: Target[];
          policy_version_id: Uuid | null;
          proposed_scheduled_at: string | null;
          auto_schedule_candidate: boolean;
          /**
           * @minItems 0
           * @maxItems 50
           */
          claim_keys: ProposalKey[];
          /**
           * @minItems 0
           * @maxItems 30
           */
          gaps: Gap[];
        }[];
        /**
         * @maxItems 20
         */
        assumptions: string[];
        /**
         * @maxItems 20
         */
        evidence_gaps: string[];
        data_cutoff: string;
      };
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
    }
  | {
      workflow: "content_draft";
      schema_version: 2;
      output: {
        title: string;
        /**
         * @minItems 1
         * @maxItems 60
         */
        body_blocks: {
          type: "paragraph" | "bullet" | "heading";
          text: string;
        }[];
        /**
         * @maxItems 100
         */
        claim_refs: {
          block_index: number;
          claim_id: string;
        }[];
        cta: {
          label: string;
          href: string;
          action: "navigate" | "scroll_to_form" | "contact";
        };
        /**
         * @maxItems 30
         */
        warnings: string[];
        topic_id: Uuid;
        /**
         * @minItems 0
         * @maxItems 100
         */
        source_claim_keys: ProposalKey[];
        /**
         * @minItems 0
         * @maxItems 30
         */
        gaps: Gap[];
      };
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
    }
  | {
      workflow: "seo_review";
      schema_version: 2;
      output: {
        /**
         * @maxItems 200
         */
        issues: {
          url: string;
          severity: "critical" | "high" | "medium" | "low";
          check_key: string;
          evidence: string;
          suggested_fix: string;
        }[];
      };
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
    }
  | {
      workflow: "daily_report";
      schema_version: 2;
      output: {
        /**
         * @maxItems 30
         */
        facts: {
          metric_key: string;
          period_key: string;
          text: string;
          /**
           * @maxItems 30
           */
          source_batch_ids: string[];
        }[];
        /**
         * @maxItems 15
         */
        hypotheses: {
          text: string;
          verification: string;
        }[];
        /**
         * 下一步优化提议；不能冒充executed_actions中的已执行结果，执行仍须确定性授权和核验。
         *
         * @maxItems 15
         */
        actions: {
          title: string;
          rationale: string;
          priority: "P0" | "P1" | "P2";
          /**
           * @maxItems 30
           */
          evidence_ids: string[];
          requires_data: boolean;
        }[];
        /**
         * @maxItems 30
         */
        data_gaps: string[];
        data_cutoff: string;
        data_quality: "complete" | "partial" | "missing" | "stale" | "unsupported";
        /**
         * @minItems 0
         * @maxItems 100
         */
        executed_actions: ExecutedAction[];
        /**
         * @minItems 0
         * @maxItems 50
         */
        topic_feedback: {
          topic_id: Uuid;
          feedback: string;
          /**
           * @minItems 0
           * @maxItems 20
           */
          metric_keys: string[];
          /**
           * @minItems 0
           * @maxItems 30
           */
          source_batch_ids: Uuid[];
          next_step: string;
        }[];
        /**
         * @minItems 0
         * @maxItems 50
         */
        human_tasks: {
          reason: string;
          impact: string;
          assignee_user_id: Uuid;
          next_step: string;
        }[];
      };
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
    }
  | {
      workflow: "geo_review";
      schema_version: 2;
      output: {
        /**
         * @maxItems 200
         */
        mentions: {
          observation_id: string;
          brand_mentioned: boolean;
          matched_alias?: string;
        }[];
        /**
         * @maxItems 200
         */
        citations: {
          observation_id: string;
          url: string;
          official_domain_match: boolean;
        }[];
        /**
         * @maxItems 100
         */
        factual_checks: {
          statement: string;
          status: "supported" | "contradicted" | "unknown";
          /**
           * @maxItems 30
           */
          claim_ids: string[];
        }[];
        confidence: "high" | "medium" | "low";
      };
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
    }
  | {
      workflow: "insight_topics";
      schema_version: 2;
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
      /**
       * 四源版本化证据到推广洞察及选题的AI提议；自动排期由确定性服务完成。
       */
      output: {
        data_cutoff: string;
        /**
         * @minItems 0
         * @maxItems 50
         */
        insights: Insight[];
        /**
         * @minItems 0
         * @maxItems 50
         */
        topics: Topic[];
        /**
         * @minItems 0
         * @maxItems 50
         */
        source_gaps: Gap[];
      };
    }
  | {
      workflow: "platform_assets";
      schema_version: 2;
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
      /**
       * 按首批账号对应档案生产素材文案；实际媒体生成、检查、排期、发布和回读由确定性服务完成。
       */
      output: {
        topic_id: Uuid;
        mother_content_version_id: Uuid;
        /**
         * @minItems 1
         * @maxItems 20
         */
        variants: PlatformVariant[];
        /**
         * @minItems 0
         * @maxItems 50
         */
        gaps: Gap[];
      };
    }
  | {
      workflow: "reception_reply";
      schema_version: 2;
      /**
       * @minItems 0
       * @maxItems 200
       */
      source_versions: SourceVersionRef[];
      /**
       * @minItems 0
       * @maxItems 200
       */
      claims: Claim[];
      /**
       * @minItems 0
       * @maxItems 30
       */
      policy_refs: PolicyRef[];
      /**
       * 爱番番接待提议，实际收发和SOP状态机由确定性服务负责。原PII留在采集服务，模型仅可见脱敏上下文。
       */
      output: {
        conversation_id: Uuid;
        conversation_version: number;
        reply_text: string;
        question_count: number;
        reply_class:
          | "useful_answer"
          | "one_question"
          | "contact_value_explanation"
          | "identity_disclosure"
          | "silent_followup"
          | "handoff_acknowledgement"
          | "contact_captured_acknowledgement";
        handoff_requested: boolean;
        stop_contact_request: boolean;
        /**
         * @maxItems 30
         */
        claim_keys: ProposalKey[];
        /**
         * @maxItems 20
         */
        gaps: Gap[];
      };
    };
export type Uuid = string;
/**
 * 仅本次输出内的稳定引用键；服务端分配持久 UUID，不由模型伪造。
 */
export type ProposalKey = string;
/**
 * 已有claim_id仅从输入允许集合选择；新主张claim_id=null。输出是待校验提议，不能自行标为verified或公开许可allowed。
 */
export type Claim = {
  [k: string]: unknown;
} & {
  claim_key: ProposalKey;
  claim_id: Uuid | null;
  claim_text: string;
  source_version_id: Uuid;
  locator: Locator;
  assertion_type: "fact" | "inference" | "decision";
  decision_status: ("proposed" | "confirmed" | "revoked" | "disputed") | null;
  decision_evidence_ref: DecisionEvidenceRef | null;
  supersedes_claim_id: Uuid | null;
  inference_rationale: string | null;
};
/**
 * 只能复制输入中执行器已持久化的状态与核验证据；人工externally_completed不计自动化验收成功。
 */
export type ExecutedAction = (
  | {
      policy_version_id?: Uuid;
      approval_id?: null;
    }
  | {
      policy_version_id?: null;
      approval_id?: Uuid;
    }
) & {
  [k: string]: unknown;
} & {
  execution_action_id: Uuid;
  action_type: string;
  platform_account_id: Uuid | null;
  state:
    | "queued"
    | "blocked"
    | "executing"
    | "submitted"
    | "waiting_review"
    | "verification_pending"
    | "retry_wait"
    | "succeeded"
    | "failed"
    | "unknown"
    | "externally_completed"
    | "cancelled";
  external_id: string | null;
  published_url: string | null;
  verified_at: string | null;
  /**
   * @minItems 0
   * @maxItems 30
   */
  evidence_refs: string[];
  policy_version_id: Uuid | null;
  approval_id: Uuid | null;
  result_summary: string;
  operation: ("create" | "update" | "enable" | "pause") | null;
  entity_level: ("account" | "campaign" | "unit" | "keyword" | "negative_keyword" | "creative") | null;
};

/**
 * 目标账号、风格样稿与平台规则版本均来自输入；format须在该档案allowed_formats中。
 */
export interface Target {
  platform_account_id: Uuid;
  platform_profile_version_id: Uuid;
  format: string;
}
export interface Gap {
  kind:
    | "source"
    | "coverage"
    | "fact"
    | "public_permission"
    | "platform_rule"
    | "style"
    | "asset"
    | "account"
    | "policy"
    | "metrics"
    | "other";
  description: string;
  reference_key: string | null;
  next_step: string;
}
/**
 * 复制输入中不可变 source_versions 及来源范围；覆盖完整只表示指定采集范围，不表示全网、全部Mac或全部聊天。
 */
export interface SourceVersionRef {
  source_version_id: Uuid;
  document_id: Uuid;
  source_kind: "market_public" | "competitor_public" | "mac_drive" | "chatgpt" | "other";
  revision: string;
  retrieved_at: string;
  coverage: {
    status: "complete" | "partial" | "unknown";
    scope: string;
    start_locator: string | null;
    end_locator: string | null;
    /**
     * @minItems 0
     * @maxItems 20
     */
    gaps: string[];
  };
}
/**
 * 必须能回到输入快照的页面、段落、消息或单元格；不得编造消息ID。
 */
export interface Locator {
  kind: "web" | "document" | "message" | "sheet" | "other";
  value: string;
}
/**
 * 用户确认或撤销表达，不以助手的总结作为用户批准。
 */
export interface DecisionEvidenceRef {
  source_version_id: Uuid;
  locator: Locator;
  actor: "user";
}
/**
 * 只引用输入提供的负责人已批准规则版本；模型不得生成、扩张或激活规则。执行前仍由服务端确定性重新匹配。
 */
export interface PolicyRef {
  policy_version_id: Uuid;
  policy_id: Uuid;
  payload_hash: string;
}
/**
 * 模型提出定性优先级依据和可定位证据。服务端核验事实/许可/范围并选择P0/P1/P2；未校准数值不驱动排期或付费调优，但符合持续执行规则的定性选题可自动推进。
 */
export interface Insight {
  proposal_key: ProposalKey;
  insight_id: Uuid | null;
  summary: string;
  business_line: "yonyou" | "seeyon" | "shared";
  customer_problem: string;
  opportunity: string;
  inference_text: string | null;
  /**
   * 固定null。初始qualitative不计算虚假精度；仅服务端在numeric_calibrated批准后可产生展示分值，模型不能输出数值或执行授权。
   */
  priority_score: null;
  priority_reason: string;
  data_cutoff: string;
  /**
   * @minItems 1
   * @maxItems 50
   */
  evidence: {
    claim_key: ProposalKey;
    relation: "supports" | "contradicts" | "context";
  }[];
  candidate_state: "candidate" | "ready" | "blocked";
  /**
   * @minItems 0
   * @maxItems 30
   */
  gaps: Gap[];
  next_step: string;
}
/**
 * 规则内选题由服务端自动进入plan_cycle及排期；模型仅提出账号/时间，不能替代频次、窗口、预算和规则匹配。
 */
export interface Topic {
  proposal_key: ProposalKey;
  topic_id: Uuid | null;
  insight_key: ProposalKey;
  business_line: "yonyou" | "seeyon" | "shared";
  title: string;
  audience: string;
  problem: string;
  offer: string;
  angle: string;
  /**
   * @minItems 0
   * @maxItems 30
   */
  keywords: string[];
  /**
   * @minItems 1
   * @maxItems 50
   */
  claim_keys: ProposalKey[];
  /**
   * @minItems 1
   * @maxItems 20
   */
  targets: Target[];
  /**
   * 0/1/2候选标签P0/P1/P2；服务端核验定性理由与证据后排序。数值校准是可选后续配置，不预设75/50阈值。
   */
  priority: 0 | 1 | 2;
  priority_reason: string;
  policy_version_id: Uuid | null;
  proposed_scheduled_at: string | null;
  auto_schedule_candidate: boolean;
  /**
   * @minItems 0
   * @maxItems 30
   */
  gaps: Gap[];
  /**
   * @minItems 1
   * @maxItems 20
   */
  metric_keys: string[];
  industry_key: string | null;
  product_family_key: string | null;
  /**
   * @maxItems 22
   */
  domain_keys: string[];
}
/**
 * 独立的平台版本，须使用该账号档案受众、已校准风格和规则。asset_ids只能引用输入已有实际媒体；模型不得宣布检查passed或真实发布成功。
 */
export interface PlatformVariant {
  proposal_key: ProposalKey;
  platform_account_id: Uuid;
  platform_profile_version_id: Uuid;
  format: string;
  title: string;
  /**
   * @minItems 1
   * @maxItems 60
   */
  body_blocks: Block[];
  /**
   * @minItems 0
   * @maxItems 100
   */
  claim_refs: ClaimRef[];
  cta: Cta;
  material_copy: MaterialCopy;
  /**
   * @minItems 0
   * @maxItems 30
   */
  asset_ids: Uuid[];
  /**
   * @minItems 0
   * @maxItems 30
   */
  asset_requests: AssetRequest[];
  proposed_scheduled_at: string | null;
  policy_version_id: Uuid | null;
  style_rationale: string;
  /**
   * @minItems 1
   * @maxItems 10
   */
  validation_checks: (
    "facts" | "public_permission" | "platform_rules" | "audience_style" | "format" | "assets" | "schedule_policy"
  )[];
  /**
   * @minItems 0
   * @maxItems 30
   */
  gaps: Gap[];
  /**
   * @minItems 0
   * @maxItems 30
   */
  warnings: string[];
}
export interface Block {
  type: "paragraph" | "bullet" | "heading";
  text: string;
}
export interface ClaimRef {
  block_index: number;
  claim_key: ProposalKey;
}
export interface Cta {
  label: string;
  href: string;
  action: "navigate" | "scroll_to_form" | "contact";
}
/**
 * 按平台形式生成对应文案；视频口播、分镜和字幕不等于视频成品，未需要的字段明确为空。
 */
export interface MaterialCopy {
  cover_text: string | null;
  /**
   * @minItems 0
   * @maxItems 20
   */
  image_texts: string[];
  /**
   * @minItems 0
   * @maxItems 20
   */
  faq: {
    question: string;
    answer: string;
  }[];
  spoken_script: string | null;
  /**
   * @minItems 0
   * @maxItems 60
   */
  storyboard: {
    shot: number;
    visual: string;
    spoken_text: string;
    duration_seconds: number;
  }[];
  /**
   * @minItems 0
   * @maxItems 200
   */
  subtitles: {
    start_ms: number;
    end_ms: number;
    text: string;
  }[];
}
/**
 * 媒体生成任务需求，不是已生成媒体。实际媒体由素材服务产出、hash与公开许可核验后关联media_assets。
 */
export interface AssetRequest {
  request_key: ProposalKey;
  kind: "image" | "cover" | "video" | "audio" | "script" | "storyboard" | "subtitle" | "text" | "other";
  purpose: string;
  brief: string;
  required: boolean;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}
