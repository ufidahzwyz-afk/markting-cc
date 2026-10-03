/* Generated from the engineering contract. Run npm run generate -w @boran/contracts. */

/**
 * 文本不允许原始HTML；CTA href必须为站内相对路径或允许的https域名。媒体访问和claim权限需业务校验。service/industry默认hero/problem/solution/scope/proof/faq/lead_form；case与article可裁减但保留CTA。每页最多一个lead_form，至少一个hero。
 *
 * @minItems 1
 * @maxItems 30
 */
export type PageModules = (
  | {
      type: "hero";
      schema_version: 1;
      data: {
        headline: string;
        description: string;
        cta: {
          label: string;
          href: string;
          action: "navigate" | "scroll_to_form" | "contact";
        };
        media?: {
          asset_id: string;
          alt: string;
        };
      };
    }
  | {
      type: "problem";
      schema_version: 1;
      data: {
        heading: string;
        /**
         * @minItems 1
         * @maxItems 8
         */
        items: string[];
      };
    }
  | {
      type: "solution";
      schema_version: 1;
      data: {
        heading: string;
        /**
         * @minItems 1
         * @maxItems 40
         */
        body: {
          type: "paragraph" | "bullet" | "heading";
          text: string;
        }[];
        /**
         * @maxItems 30
         */
        claim_ids: string[];
      };
    }
  | {
      type: "scope";
      schema_version: 1;
      data: {
        heading: string;
        /**
         * @maxItems 20
         */
        included: string[];
        /**
         * @maxItems 20
         */
        dependencies: string[];
      };
    }
  | {
      type: "process";
      schema_version: 1;
      data: {
        heading: string;
        /**
         * @minItems 1
         * @maxItems 10
         */
        steps: {
          title: string;
          description: string;
        }[];
      };
    }
  | {
      type: "proof";
      schema_version: 1;
      data: {
        heading: string;
        /**
         * @minItems 1
         * @maxItems 20
         */
        claims: {
          claim_id: string;
          display_text: string;
        }[];
      };
    }
  | {
      type: "case";
      schema_version: 1;
      data: {
        heading: string;
        customer_display: string;
        problem: string;
        boran_scope: string;
        result: string;
        project_status: "planned" | "implementing" | "live" | "accepted";
        /**
         * @minItems 1
         * @maxItems 20
         */
        claim_ids: string[];
      };
    }
  | {
      type: "faq";
      schema_version: 1;
      data: {
        heading: string;
        /**
         * @minItems 1
         * @maxItems 12
         */
        items: {
          question: string;
          answer: string;
          /**
           * @maxItems 10
           */
          claim_ids: string[];
        }[];
      };
    }
  | {
      type: "cta";
      schema_version: 1;
      data: {
        heading: string;
        description?: string;
        button: {
          label: string;
          href: string;
          action: "navigate" | "scroll_to_form" | "contact";
        };
      };
    }
  | {
      type: "lead_form";
      schema_version: 1;
      data: {
        heading: string;
        form_schema_id: "lead_form_v1";
        privacy_notice_version: string;
        submit_label: string;
      };
    }
)[];
