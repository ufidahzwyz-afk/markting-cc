import {requireActiveRole, activeRoles} from './authz';
import type {SqlExecutor} from '@boran/db';
import type {SourceReadResult} from '@boran/connectors/sources';
import {DomainError, requireRole, uuid, stableHash, assertVersion, nowIso, audit, emitOutbox, type ServiceContext} from './core';
type Row = Record<string, unknown>;
export interface BusinessMasterItem {id: string; category: string; businessKey: string; name: string; aliases: string[]; status: string; versionNo: number; sourceVersionId: string;sourceLocator:unknown;payload:unknown}
const BUSINESS_PROJECTION = [
  {
    "category": "product_family",
    "businessKey": "yonyou_cloud_family",
    "name": "YonSuite BIP YonBIP",
    "aliases": [
      "YonSuite BIP YonBIP",
      "YonSuite",
      "用友YonSuite",
      "用友云ERP",
      "BIP",
      "用友BIP",
      "YonBIP",
      "用友YonBIP"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/0",
      "revision": "1.2"
    },
    "familyMembers": [
      "YonSuite",
      "BIP",
      "YonBIP"
    ],
    "aliasesByMember": {
      "YonSuite": [
        "YonSuite",
        "用友YonSuite",
        "用友云ERP"
      ],
      "BIP": [
        "BIP",
        "用友BIP"
      ],
      "YonBIP": [
        "YonBIP",
        "用友YonBIP"
      ]
    },
    "pendingAliases": []
  },
  {
    "category": "product_family",
    "businessKey": "u8_family",
    "name": "U8 U8C",
    "aliases": [
      "U8 U8C",
      "U8",
      "用友U8",
      "U8C",
      "用友U8C"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/1",
      "revision": "1.2"
    },
    "familyMembers": [
      "U8",
      "U8C"
    ],
    "aliasesByMember": {
      "U8": [
        "U8",
        "用友U8"
      ],
      "U8C": [
        "U8C",
        "用友U8C"
      ]
    },
    "pendingAliases": [
      "U8 Cloud"
    ]
  },
  {
    "category": "product_family",
    "businessKey": "u9_family",
    "name": "U9 U9C U9Cloud",
    "aliases": [
      "U9 U9C U9Cloud",
      "U9",
      "U9C",
      "U9Cloud",
      "U9 Cloud",
      "用友U9",
      "用友U9C"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/2",
      "revision": "1.2"
    },
    "familyMembers": [
      "U9产品线"
    ],
    "aliasesByMember": {
      "U9产品线": [
        "U9",
        "U9C",
        "U9Cloud",
        "U9 Cloud",
        "用友U9",
        "用友U9C"
      ]
    },
    "pendingAliases": []
  },
  {
    "category": "product_family",
    "businessKey": "nc_family",
    "name": "NC NCC NC Cloud",
    "aliases": [
      "NC NCC NC Cloud",
      "NC",
      "用友NC",
      "NCC",
      "用友NCC",
      "NC Cloud",
      "用友NC Cloud"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/3",
      "revision": "1.2"
    },
    "familyMembers": [
      "NC",
      "NCC",
      "NC Cloud"
    ],
    "aliasesByMember": {
      "NC": [
        "NC",
        "用友NC"
      ],
      "NCC": [
        "NCC",
        "用友NCC"
      ],
      "NC Cloud": [
        "NC Cloud",
        "用友NC Cloud"
      ]
    },
    "pendingAliases": []
  },
  {
    "category": "product_family",
    "businessKey": "chanjet_family",
    "name": "畅捷通存量升级获客路线",
    "aliases": [
      "畅捷通存量升级获客路线",
      "T+",
      "畅捷通T+",
      "用友T+",
      "T3",
      "用友T3",
      "畅捷通T3"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/4",
      "revision": "1.2"
    },
    "familyMembers": [
      "T+",
      "T3"
    ],
    "aliasesByMember": {
      "T+": [
        "T+",
        "畅捷通T+",
        "用友T+"
      ],
      "T3": [
        "T3",
        "用友T3",
        "畅捷通T3"
      ]
    },
    "pendingAliases": []
  },
  {
    "category": "product_family",
    "businessKey": "hr_saas",
    "name": "用友HR SaaS 人力云",
    "aliases": [
      "用友HR SaaS 人力云",
      "用友HR SaaS",
      "用友人力云",
      "用友HCM"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/5",
      "revision": "1.2"
    },
    "familyMembers": [
      "用友HR SaaS"
    ],
    "aliasesByMember": {
      "用友HR SaaS": [
        "用友HR SaaS",
        "用友人力云",
        "用友HCM"
      ]
    },
    "pendingAliases": []
  },
  {
    "category": "product_family",
    "businessKey": "yonwork",
    "name": "用友YonWork企业AI工作台",
    "aliases": [
      "用友YonWork企业AI工作台",
      "YonWork",
      "用友YonWork",
      "用友企业AI工作台"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/product_families/6",
      "revision": "1.2"
    },
    "familyMembers": [
      "YonWork"
    ],
    "aliasesByMember": {
      "YonWork": [
        "YonWork",
        "用友YonWork",
        "用友企业AI工作台"
      ]
    },
    "pendingAliases": []
  },
  {
    "category": "business_domain",
    "businessKey": "erp_operations",
    "name": "基础ERP与经营管理",
    "aliases": [
      "基础ERP与经营管理"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/0",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "intelligent_finance",
    "name": "智能财务",
    "aliases": [
      "智能财务"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/1",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "bank_connectivity",
    "name": "银企联与银企直联",
    "aliases": [
      "银企联与银企直联"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/2",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "consolidation",
    "name": "合并报表",
    "aliases": [
      "合并报表"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/3",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "budgeting",
    "name": "全面预算",
    "aliases": [
      "全面预算"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/4",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "management_accounting",
    "name": "管理会计",
    "aliases": [
      "管理会计"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/5",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "bi_analytics",
    "name": "BI与经营数据分析",
    "aliases": [
      "BI与经营数据分析"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/6",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "expense_travel",
    "name": "费用管理与商旅费控",
    "aliases": [
      "费用管理与商旅费控"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/7",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "tax_invoice_management",
    "name": "税务与发票管理",
    "aliases": [
      "税务与发票管理"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/8",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "electronic_invoice",
    "name": "电子发票",
    "aliases": [
      "电子发票"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/9",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "clm",
    "name": "合同管理与CLM",
    "aliases": [
      "合同管理与CLM"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/10",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "crm_l2c",
    "name": "CRM营销云与L2C",
    "aliases": [
      "CRM营销云与L2C"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/11",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "srm_s2p",
    "name": "SRM采购云与S2P",
    "aliases": [
      "SRM采购云与S2P"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/12",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "revenue_cloud",
    "name": "收入云",
    "aliases": [
      "收入云"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/13",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "plm",
    "name": "PLM研发云",
    "aliases": [
      "PLM研发云"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/14",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "barcode_management",
    "name": "条码管理",
    "aliases": [
      "条码管理"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/15",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "connector_products",
    "name": "连接器产品",
    "aliases": [
      "连接器产品"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/16",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "accounting_archives",
    "name": "电子会计档案",
    "aliases": [
      "电子会计档案"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/17",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "eam_assets",
    "name": "EAM与固定资产",
    "aliases": [
      "EAM与固定资产"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/18",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "project_p2c",
    "name": "项目管理与P2C",
    "aliases": [
      "项目管理与P2C"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/19",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "hr_saas",
    "name": "HR SaaS与人力云",
    "aliases": [
      "HR SaaS与人力云"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/20",
      "revision": "1.2"
    }
  },
  {
    "category": "business_domain",
    "businessKey": "enterprise_ai",
    "name": "YonWork与企业AI",
    "aliases": [
      "YonWork与企业AI"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/business_domains/21",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "selection_comparison",
    "name": "选型与比价",
    "aliases": [
      "选型与比价"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/0",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "solution_assessment",
    "name": "方案评估",
    "aliases": [
      "方案评估"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/1",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "license_implementation_quote",
    "name": "许可与实施报价",
    "aliases": [
      "许可与实施报价"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/2",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "implementation",
    "name": "实施交付",
    "aliases": [
      "实施交付"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/3",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "upgrade_migration",
    "name": "升级迁移",
    "aliases": [
      "升级迁移"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/4",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "data_migration_cloud",
    "name": "数据迁移与上云",
    "aliases": [
      "数据迁移与上云"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/5",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "system_integration",
    "name": "系统集成与接口",
    "aliases": [
      "系统集成与接口"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/6",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "managed_service",
    "name": "运维与持续服务",
    "aliases": [
      "运维与持续服务"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/7",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "custom_reports_development",
    "name": "专项开发与报表",
    "aliases": [
      "专项开发与报表"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/8",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "electronic_invoice_integration",
    "name": "电子发票实施与集成",
    "aliases": [
      "电子发票实施与集成"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/9",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "barcode_integration",
    "name": "条码管理实施与集成",
    "aliases": [
      "条码管理实施与集成"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/10",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "standard_connectors",
    "name": "连接器产品与标准适配层",
    "aliases": [
      "连接器产品与标准适配层"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/11",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "seeyon_collaboration_integration",
    "name": "致远OA与协同集成",
    "aliases": [
      "致远OA与协同集成"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/12",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "ai_applications",
    "name": "AI应用",
    "aliases": [
      "AI应用"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/13",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "agents",
    "name": "Agent",
    "aliases": [
      "Agent"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/14",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "mcp",
    "name": "MCP",
    "aliases": [
      "MCP"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/15",
      "revision": "1.2"
    }
  },
  {
    "category": "service",
    "businessKey": "low_code",
    "name": "低代码场景",
    "aliases": [
      "低代码场景"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/service_capabilities/16",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "pharma_medical_devices",
    "name": "医药及医疗器械",
    "aliases": [
      "医药及医疗器械"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/0",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "high_tech",
    "name": "高科技",
    "aliases": [
      "高科技"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/1",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "semiconductor",
    "name": "半导体",
    "aliases": [
      "半导体"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/2",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "consumer_goods",
    "name": "消费品",
    "aliases": [
      "消费品"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/3",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "sales_distribution",
    "name": "销售与分销",
    "aliases": [
      "销售与分销"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/4",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "project_manufacturing",
    "name": "项目制造",
    "aliases": [
      "项目制造",
      "个性化定制生产",
      "按单生产"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/5",
      "revision": "1.2"
    }
  },
  {
    "category": "industry",
    "businessKey": "professional_services",
    "name": "专业服务",
    "aliases": [
      "专业服务"
    ],
    "status": "confirmed",
    "sourceLocator": {
      "reference": "engineering-handoff:business_seed",
      "pointer": "/core_industries/6",
      "revision": "1.2"
    }
  }
] as const;
function masterView(row: Row): BusinessMasterItem {return {id: String(row['id']), category: String(row['category']), businessKey: String(row['business_key']), name: String(row['name']), aliases: row['aliases'] as string[], status: String(row['status']), versionNo: Number(row['version_no']), sourceVersionId: String(row['source_version_id']),sourceLocator:row['source_locator'],payload:row['payload_json']};}
async function masterRows(ctx: ServiceContext, tx: SqlExecutor): Promise<Row[]> {
  const mapping = (await tx.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2',[ctx.orgId,'business_master_current'])).rows[0]?.['value'] as Record<string,string> | undefined;
  if (!mapping) return [];
  return (await tx.query('SELECT * FROM business_master_versions WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY category,business_key',[ctx.orgId,Object.values(mapping)])).rows;
}
export async function getBusinessMaster(ctx: ServiceContext): Promise<BusinessMasterItem[]> {await activeRoles(ctx);return (await masterRows(ctx,ctx.db)).map(masterView);}
export async function initializeBusinessMaster(ctx: ServiceContext): Promise<{inserted:number; preserved:number; items:BusinessMasterItem[]}> {
  requireRole(ctx,'owner','admin');
  return ctx.db.transaction(async tx => {
    await requireActiveRole(ctx,tx,'owner','admin');
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const existing = (await tx.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2 FOR UPDATE',[ctx.orgId,'business_master_current'])).rows[0]?.['value'] as Record<string,string> | undefined;
    const mapping = {...existing}; let inserted=0; let preserved=0;
    if(BUSINESS_PROJECTION.every(entry=>mapping[`${entry.category}:${entry.businessKey}`]))return {inserted:0,preserved:BUSINESS_PROJECTION.length,items:(await masterRows(ctx,tx)).map(masterView)};
    const docId = uuid(); const sourceId = uuid(); const projectionHash=stableHash(BUSINESS_PROJECTION);
    await tx.query("INSERT INTO source_documents (id,org_id,provider,provider_file_id,title,visibility,owner_user_id,source_kind) VALUES ($1,$2,'upload',$3,$4,'internal',$5,'other')",[docId,ctx.orgId,`business-master-projection:${sourceId}`,'工程主数据投影（来源引用，非外部采集）',ctx.actorId]);
    await tx.query("INSERT INTO source_versions (id,org_id,document_id,revision,content_hash,object_key,mime_type,extraction_status,retrieved_at,visibility,coverage_json) VALUES ($1,$2,$3,'1.2',$4,$5,'application/json','ready',$6,'internal',$7)",[sourceId,ctx.orgId,docId,projectionHash,'engineering://business-master/public-projection-v1',nowIso(ctx),JSON.stringify({status:'complete',scope:'公开业务主数据投影；不包含原始PRD或会话；不代表外部来源已连接',start_locator:null,end_locator:null})]);
    await tx.query('UPDATE source_documents SET current_version_id=$1 WHERE org_id=$2 AND id=$3',[sourceId,ctx.orgId,docId]);
    for (const entry of BUSINESS_PROJECTION) {
      const key=`${entry.category}:${entry.businessKey}`;
      if (mapping[key]) {preserved++;continue;}
      const prior=(await tx.query('SELECT id FROM business_master_versions WHERE org_id=$1 AND category=$2 AND business_key=$3 ORDER BY version_no DESC LIMIT 1',[ctx.orgId,entry.category,entry.businessKey])).rows[0];
      if (prior) {mapping[key]=String(prior['id']);preserved++;continue;}
      const id=uuid();
      await tx.query('INSERT INTO business_master_versions (id,org_id,category,business_key,version_no,name,aliases,status,payload_json,source_version_id,source_locator,payload_hash) VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11)',[id,ctx.orgId,entry.category,entry.businessKey,entry.name,[...entry.aliases],entry.status,JSON.stringify({kind:'public_master_projection',name:entry.name,...('familyMembers' in entry?{family_members:entry.familyMembers,search_aliases_by_member:entry.aliasesByMember,pending_aliases:entry.pendingAliases}:{})}),sourceId,JSON.stringify(entry.sourceLocator),stableHash(entry)]);
      mapping[key]=id;inserted++;
    }
    await tx.query('INSERT INTO settings (id,org_id,key,value,schema_version,updated_by) VALUES ($1,$2,$3,$4,1,$5) ON CONFLICT (org_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()',[uuid(),ctx.orgId,'business_master_current',JSON.stringify(mapping),ctx.actorId]);
    await audit(ctx,tx,'business_master.initialize','organization',ctx.orgId,{inserted,preserved});
    return {inserted,preserved,items:(await masterRows(ctx,tx)).map(masterView)};
  });
}
export function resolveIndustryAlias(value: string): {industryKey:string|null; rawKeyword:string} {
  const normalized=value.normalize('NFKC').trim(); const match=BUSINESS_PROJECTION.find(entry=>entry.category==='industry' && (entry.aliases as readonly string[]).includes(normalized));
  return {industryKey:match?.businessKey ?? null,rawKeyword:value};
}
export interface TopicInput {title:string; businessLine:'yonyou'|'seeyon'|'shared'; audience:string; problem:string; offer:string; angle:string; claimIds:string[]; priority?:'P0'|'P1'|'P2'; industryKey?:string|null; productFamilyKey?:string|null; domainKeys?:string[]; insightId?:string|null}
export interface TopicView {id:string;insightId:string|null; title:string; businessLine:string; audience:string; problem:string; offer:string; angle:string; state:string; priority:'P0'|'P1'|'P2'; priorityScore:null; version:number; scheduledAt:string|null; claimIds:string[]; industryKey:string|null; productFamilyKey:string|null; domainKeys:string[]; policyVersionId:string|null; planCycleId:string|null}
function topicView(row:Row):TopicView {return {id:String(row['id']),insightId:row['insight_id'] as string|null,title:String(row['title']),businessLine:String(row['business_line']),audience:String(row['audience']),problem:String(row['problem']),offer:String(row['offer']),angle:String(row['angle']),state:String(row['state']),priority:(['P0','P1','P2'] as const)[Number(row['priority'])] ?? 'P2',priorityScore:null,version:Number(row['version']),scheduledAt:row['scheduled_at'] ? new Date(String(row['scheduled_at'])).toISOString():null,claimIds:row['claim_ids'] as string[],industryKey:row['industry_key'] as string|null,productFamilyKey:row['product_family_key'] as string|null,domainKeys:row['domain_keys'] as string[],policyVersionId:row['policy_version_id'] as string|null,planCycleId:row['plan_cycle_id'] as string|null};}
async function findTopic(ctx:ServiceContext,tx:SqlExecutor,id:string,lock=false):Promise<Row> {const row=(await tx.query(`SELECT * FROM topics WHERE org_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[ctx.orgId,id])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404,'主题不存在');return row;}
export async function getTopic(ctx:ServiceContext,id:string):Promise<TopicView>{await activeRoles(ctx);return topicView(await findTopic(ctx,ctx.db,id));}
export async function listTopics(ctx:ServiceContext,filters:{state?:string;limit?:number}={}):Promise<TopicView[]> {
  await activeRoles(ctx);const limit=filters.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>500)throw new DomainError('INVALID_LIMIT',422,'查询数量必须为1至500');
  return (await ctx.db.query("SELECT t.*,(SELECT max(COALESCE(v.source_modified_at,v.retrieved_at)) FROM evidence_claims c JOIN source_versions v ON v.org_id=c.org_id AND v.id=c.source_version_id WHERE c.org_id=t.org_id AND c.id=ANY(t.claim_ids)) AS source_time FROM topics t WHERE t.org_id=$1 AND ($2::text IS NULL OR t.state=$2) ORDER BY CASE WHEN t.state='blocked' THEN 1 ELSE 0 END,t.priority,source_time DESC NULLS LAST,t.id ASC LIMIT $3",[ctx.orgId,filters.state??null,limit])).rows.map(topicView);
}
function validateTopicText(input:TopicInput):void {for(const key of ['title','audience','problem','offer','angle'] as const)if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>(key==='title'?300:4000))throw new DomainError('INVALID_TOPIC',422,`${key} 必须为非空有界文本`);if(!['yonyou','seeyon','shared'].includes(input.businessLine)||!Array.isArray(input.claimIds)||new Set(input.claimIds).size!==input.claimIds.length||input.priority&&!['P0','P1','P2'].includes(input.priority))throw new DomainError('INVALID_TOPIC',422,'主题引用或优先级无效');}
async function topicGate(ctx:ServiceContext,tx:SqlExecutor,input:TopicInput):Promise<{state:'ready'|'blocked';claims:Row[]}> {
  const masters=await masterRows(ctx,tx);
  for(const [category,key] of [['industry',input.industryKey],['product_family',input.productFamilyKey],...(input.domainKeys??[]).map(key=>['business_domain',key])]) if(key&&!masters.some(master=>master['category']===category&&master['business_key']===key&&master['status']==='confirmed'))throw new DomainError('BUSINESS_SCOPE_INVALID',422,'业务分类不在当前已确认主数据中');
  if(input.insightId&&!((await tx.query('SELECT id FROM insights WHERE org_id=$1 AND id=$2',[ctx.orgId,input.insightId])).rows[0]))throw new DomainError('INVALID_REFERENCE',422,'洞察必须来自同组织');
  const claims=(await tx.query("SELECT c.*,d.deleted_at,EXISTS(SELECT 1 FROM evidence_claims successor WHERE successor.org_id=c.org_id AND successor.supersedes_claim_id=c.id AND (successor.decision_status IN ('confirmed','revoked') OR successor.verification_status='verified')) AS superseded FROM evidence_claims c JOIN source_versions v ON v.org_id=c.org_id AND v.id=c.source_version_id JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE c.org_id=$1 AND c.id=ANY($2::uuid[])",[ctx.orgId,input.claimIds])).rows;
  if(claims.length!==input.claimIds.length)throw new DomainError('INVALID_REFERENCE',422,'证据必须来自同组织');
  const usable=claims.length>0&&claims.every(claim=>claim['verification_status']==='verified'&&claim['public_permission']==='allowed'&&!claim['deleted_at']&&!claim['superseded']&&(claim['assertion_type']!=='decision'||claim['decision_status']==='confirmed')&&claim['decision_status']!=='revoked'&&claim['decision_status']!=='disputed'&&(claim['valid_until']===null||Date.parse(String(claim['valid_until']))>Date.parse(nowIso(ctx))));
  return {state:usable?'ready':'blocked',claims};
}
export async function createTopic(ctx:ServiceContext,input:TopicInput):Promise<TopicView> {
  requireRole(ctx,'owner','marketer');validateTopicText(input);
  return ctx.db.transaction(async tx=>{await requireActiveRole(ctx,tx,'owner','marketer');const gate=await topicGate(ctx,tx,input);const key=stableHash({title:input.title.normalize('NFKC').trim(),problem:input.problem.normalize('NFKC').trim(),businessLine:input.businessLine,claims:gate.claims.map(c=>({id:c['id'],sourceVersionId:c['source_version_id']})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))});
    const result=await tx.query('INSERT INTO topics (id,org_id,business_line,title,audience,problem,offer,angle,claim_ids,priority,state,dedupe_key,industry_key,product_family_key,domain_keys,insight_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(org_id,dedupe_key) DO NOTHING RETURNING *',[uuid(),ctx.orgId,input.businessLine,input.title,input.audience,input.problem,input.offer,input.angle,input.claimIds,Number((input.priority??'P2')[1]),gate.state,key,input.industryKey??null,input.productFamilyKey??null,input.domainKeys??[],input.insightId??null]);
    const row=result.rows[0]??(await tx.query('SELECT * FROM topics WHERE org_id=$1 AND dedupe_key=$2',[ctx.orgId,key])).rows[0]!;if(result.rows.length)await audit(ctx,tx,'topic.created','topic',String(row['id']),{state:gate.state});return topicView(row);
  });
}
export async function updateTopic(ctx:ServiceContext,id:string,input:Partial<TopicInput>&{expectedVersion:number}):Promise<TopicView> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{await requireActiveRole(ctx,tx,'owner','marketer');const row=await findTopic(ctx,tx,id,true);assertVersion(Number(row['version']),input.expectedVersion);if(['active','completed'].includes(String(row['state'])))throw new DomainError('TOPIC_IMMUTABLE',409,'已执行主题不可直接改写');const old=topicView(row);const merged:TopicInput={title:old.title,businessLine:old.businessLine as TopicInput['businessLine'],audience:old.audience,problem:old.problem,offer:old.offer,angle:old.angle,claimIds:old.claimIds,priority:old.priority,industryKey:old.industryKey,productFamilyKey:old.productFamilyKey,domainKeys:old.domainKeys,...input};validateTopicText(merged);const gate=await topicGate(ctx,tx,merged);const updated=(await tx.query('UPDATE topics SET title=$3,business_line=$4,audience=$5,problem=$6,offer=$7,angle=$8,claim_ids=$9,priority=$10,state=$11,industry_key=$12,product_family_key=$13,domain_keys=$14,scheduled_at=NULL,policy_version_id=NULL,plan_cycle_id=NULL,version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *',[ctx.orgId,id,merged.title,merged.businessLine,merged.audience,merged.problem,merged.offer,merged.angle,merged.claimIds,Number((merged.priority??'P2')[1]),gate.state,merged.industryKey??null,merged.productFamilyKey??null,merged.domainKeys??[]])).rows[0]!;await audit(ctx,tx,'topic.updated','topic',id,{version:updated['version']});return topicView(updated);});
}
export interface TopicActivationInput {expectedVersion:number;planCycleId:string;policyVersionId:string;scheduledAt:string;platformAccountIds:string[]}
function finiteDate(value:unknown):number {const parsed=Date.parse(String(value));if(!Number.isFinite(parsed))throw new DomainError('INVALID_DATE',422,'日期必须为有效时间戳');return parsed;}
function shanghaiParts(value:number):{date:string;weekday:number;minutes:number} {const date=new Date(value+8*3600000);return {date:date.toISOString().slice(0,10),weekday:date.getUTCDay()||7,minutes:date.getUTCHours()*60+date.getUTCMinutes()};}
function inPublishWindow(value:number,accountId:string,windows:unknown):boolean {
  if(!Array.isArray(windows))return false;const parts=shanghaiParts(value);
  return windows.some(raw=>{const window=raw as Row;if(window['timezone']!=='Asia/Shanghai'||!Array.isArray(window['account_ids'])||!(window['account_ids'] as unknown[]).includes(accountId)||!Array.isArray(window['weekdays'])||!(window['weekdays'] as unknown[]).includes(parts.weekday))return false;
    const start=String(window['start']??''),end=String(window['end']??'');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end))return false;const minutes=(text:string)=>Number(text.slice(0,2))*60+Number(text.slice(3));return minutes(start)<minutes(end)&&parts.minutes>=minutes(start)&&parts.minutes<minutes(end);
  });
}
export async function activateTopic(ctx:ServiceContext,id:string,input:TopicActivationInput):Promise<TopicView> {
  requireRole(ctx,'owner','marketer');
  return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','marketer');await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);const topic=await findTopic(ctx,tx,id,true);assertVersion(Number(topic['version']),input.expectedVersion);
    const view=topicView(topic);const gate=await topicGate(ctx,tx,{...view,businessLine:view.businessLine as TopicInput['businessLine']});if(gate.state==='blocked')throw new DomainError('TOPIC_BLOCKED',409,'主题缺少有效可公开证据');
    const scheduled=finiteDate(input.scheduledAt),now=finiteDate(nowIso(ctx));if(scheduled<=now)throw new DomainError('WINDOW_EXPIRED',409,'过去排期不得集中补发');
    const policy=(await tx.query('SELECT v.*,p.status AS policy_status,p.active_version_id FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id WHERE v.org_id=$1 AND v.id=$2 FOR UPDATE OF p,v',[ctx.orgId,input.policyVersionId])).rows[0];
    if(!policy||policy['policy_status']!=='active'||policy['active_version_id']!==policy['id']||!policy['approved_by']||!policy['approved_at']||finiteDate(policy['valid_from'])>now||policy['valid_until']&&(finiteDate(policy['valid_until'])<=now||finiteDate(policy['valid_until'])<=scheduled))throw new DomainError('POLICY_INACTIVE',409,'当前规则无效、已替换或过期');
    const owner=(await tx.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND 'owner'=ANY(m.roles)",[ctx.orgId,policy['approved_by']])).rows[0];if(!owner)throw new DomainError('POLICY_INACTIVE',409,'规则批准人的组织权限已失效');
    if(!((policy['allowed_actions'] as string[]).includes('external.publish')))throw new DomainError('OUT_OF_SCOPE',409,'规则没有明确发布授权');
    const scope=policy['business_scope'] as Row;
    if(!Array.isArray(scope['business_lines'])||!(scope['business_lines'] as string[]).includes(view.businessLine))throw new DomainError('OUT_OF_SCOPE',409,'业务线未获授权');
    for(const [key,list] of [[view.industryKey,scope['industry_keys']],[view.productFamilyKey,scope['product_family_keys']]] as const)if(key&&(!Array.isArray(list)||!list.includes(key)))throw new DomainError('OUT_OF_SCOPE',409,'业务分类未获授权');
    if(view.domainKeys.some(key=>!Array.isArray(scope['domain_keys'])||!(scope['domain_keys'] as string[]).includes(key)))throw new DomainError('OUT_OF_SCOPE',409,'业务领域未获授权');
    const plan=(await tx.query("SELECT id FROM plan_cycles WHERE org_id=$1 AND id=$2 AND status='active'",[ctx.orgId,input.planCycleId])).rows[0];if(!plan)throw new DomainError('PLAN_INACTIVE',409,'自动排期必须引用同组织有效计划');
    if(!input.platformAccountIds.length||new Set(input.platformAccountIds).size!==input.platformAccountIds.length||input.platformAccountIds.some(account=>!(policy['account_ids'] as string[]).includes(account)))throw new DomainError('OUT_OF_SCOPE',409,'账号必须为非空授权白名单子集');
    const scheduling=(await tx.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2 FOR UPDATE',[ctx.orgId,'topic_schedule_targets'])).rows[0]?.['value'] as Record<string,{accountIds:string[];scheduledAt:string}>|undefined;const assignments={...scheduling};
    const priorTopics=(await tx.query("SELECT id,scheduled_at FROM topics WHERE org_id=$1 AND state IN ('scheduled','active') AND id<>$2",[ctx.orgId,id])).rows;
    for(const accountId of [...input.platformAccountIds].sort()){
      const account=(await tx.query('SELECT a.*,c.access_status,c.health,c.capabilities_verified_at,c.capabilities,c.read_mode FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND a.id=$2 FOR UPDATE OF a',[ctx.orgId,accountId])).rows[0];
      if(!account||(ctx.mode==='live'&&account['read_mode']==='mock')||!account['enabled']||account['session_status']!=='active'||!account['last_session_verified_at']||account['session_expires_at']&&finiteDate(account['session_expires_at'])<=scheduled||account['access_status']!=='connected'||account['health']!=='healthy'||!account['capabilities_verified_at'])throw new DomainError('CONNECTION_UNVERIFIED',409,'发布账号尚未实测验证或会话已失效');
      const caps=account['capabilities'] as Row;if(caps['external.publish']!==true&&caps['publish']!==true)throw new DomainError('CAPABILITY_UNVERIFIED',409,'发布写能力尚未实测验证');
      if(!inPublishWindow(scheduled,accountId,policy['publish_windows']))throw new DomainError('OUTSIDE_WINDOW',409,'排期不在明确批准的上海时间窗口');
      const frequencies=policy['publish_frequency'] as Row;const frequency=(frequencies[accountId]??frequencies) as Row;
      for(const field of ['daily_max','weekly_max','min_interval_minutes'])if(typeof frequency[field]!=='number'||!Number.isSafeInteger(frequency[field])||Number(frequency[field])<0)throw new DomainError('FREQUENCY_REQUIRED',409,'每账号日周上限及最小间隔必须明确');
      const prior=priorTopics.filter(row=>assignments[String(row['id'])]?.accountIds.includes(accountId)).map(row=>finiteDate(row['scheduled_at']));
      const pending=(await tx.query("SELECT scheduled_at FROM publish_jobs WHERE org_id=$1 AND platform_account_id=$2 AND delivery_state NOT IN ('failed','cancelled','rejected')",[ctx.orgId,accountId])).rows.map(row=>finiteDate(row['scheduled_at']));
      const times=[...prior,...pending];const day=shanghaiParts(scheduled).date;
      const weekStart=Date.parse(`${day}T00:00:00+08:00`)-(shanghaiParts(scheduled).weekday-1)*86400000;
      if(times.filter(time=>shanghaiParts(time).date===day).length>=Number(frequency['daily_max'])||times.filter(time=>time>=weekStart&&time<weekStart+7*86400000).length>=Number(frequency['weekly_max'])||times.some(time=>Math.abs(scheduled-time)<Number(frequency['min_interval_minutes'])*60000))throw new DomainError('FREQUENCY_EXCEEDED',409,'排期超过账号日周频次或最小间隔');
    }
    assignments[id]={accountIds:input.platformAccountIds,scheduledAt:new Date(scheduled).toISOString()};
    await tx.query('INSERT INTO settings (id,org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()',[uuid(),ctx.orgId,'topic_schedule_targets',JSON.stringify(assignments),ctx.actorId]);
    const updated=(await tx.query("UPDATE topics SET state='scheduled',scheduled_at=$3,policy_version_id=$4,plan_cycle_id=$5,version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *",[ctx.orgId,id,new Date(scheduled).toISOString(),input.policyVersionId,input.planCycleId])).rows[0]!;
    await audit(ctx,tx,'topic.scheduled','topic',id,{scheduledAt:input.scheduledAt,accountCount:input.platformAccountIds.length});await emitOutbox(ctx,tx,'topic.scheduled',id,{topicId:id,version:updated['version']});return topicView(updated);
  });
}
export interface QualitativePriorityInput {hardGatesPass:boolean;commercialIntent:boolean;deliverable:boolean;healthyLanding:boolean;educational:boolean}
export function evaluateQualitativePriority(input:QualitativePriorityInput):{priority:'P0'|'P1'|'P2';priorityScore:null;state:'ready'|'blocked';reason:string} {
  if(!input.hardGatesPass)return {priority:'P2',priorityScore:null,state:'blocked',reason:'关键证据、公开许可或范围门槛未通过'};
  if(input.commercialIntent&&input.deliverable&&input.healthyLanding)return {priority:'P0',priorityScore:null,state:'ready',reason:'已过门槛的商业决策意图、可交付能力与健康承接页'};
  return {priority:input.educational?'P1':'P2',priorityScore:null,state:'ready',reason:input.educational?'已过门槛的一般业务教育':'探索主题，保留定性优先级'};
}
export function stableSortPriorities<T extends {id:string;priority:'P0'|'P1'|'P2';state:string;sourceTime:string}>(items:readonly T[]):T[] {
  return [...items].sort((a,b)=>Number(a.state==='blocked')-Number(b.state==='blocked')||Number(a.priority[1])-Number(b.priority[1])||finiteDate(b.sourceTime)-finiteDate(a.sourceTime)||a.id.localeCompare(b.id));
}
export async function createInsight(ctx:ServiceContext,input:{summary:string;businessLine:TopicInput['businessLine'];customerProblem:string;opportunity:string;inferenceText?:string|null;claimIds:string[];dataCutoff:string;commercialIntent:boolean;deliverable:boolean;healthyLanding:boolean;educational:boolean}):Promise<Row> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','marketer');const gate=await topicGate(ctx,tx,{title:input.summary,businessLine:input.businessLine,audience:'业务客户',problem:input.customerProblem,offer:input.opportunity,angle:input.inferenceText??input.opportunity,claimIds:input.claimIds});const score=evaluateQualitativePriority({...input,hardGatesPass:gate.state==='ready'});finiteDate(input.dataCutoff);
    const key=stableHash({problem:input.customerProblem.normalize('NFKC').trim(),businessLine:input.businessLine,dataCutoff:input.dataCutoff,sourceVersions:gate.claims.map(c=>c['source_version_id']).sort()});
    const result=await tx.query('INSERT INTO insights (id,org_id,summary,business_line,customer_problem,opportunity,inference_text,priority_score,priority_reason,data_cutoff,state,dedupe_key,score_breakdown,priority_label,scoring_mode) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13,\'qualitative\') ON CONFLICT(org_id,dedupe_key) DO NOTHING RETURNING *',[uuid(),ctx.orgId,input.summary,input.businessLine,input.customerProblem,input.opportunity,input.inferenceText??null,score.reason,input.dataCutoff,score.state,key,JSON.stringify({commercialIntent:input.commercialIntent,deliverable:input.deliverable,healthyLanding:input.healthyLanding,educational:input.educational}),score.priority]);
    const row=result.rows[0]??(await tx.query('SELECT * FROM insights WHERE org_id=$1 AND dedupe_key=$2',[ctx.orgId,key])).rows[0]!;
    if(result.rows.length)for(const claimId of input.claimIds)await tx.query("INSERT INTO insight_evidence (id,org_id,insight_id,claim_id,relation) VALUES($1,$2,$3,$4,'supports')",[uuid(),ctx.orgId,row['id'],claimId]);return row;
  });
}
export async function ingestSourceRead(ctx:ServiceContext,input:{connectionId:string;expectedCursorHash:string;result:SourceReadResult}):Promise<{status:SourceReadResult['status'];sourceVersionIds:string[];cursorAdvanced:boolean}> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','marketer');const connection=(await tx.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,input.connectionId])).rows[0];if(!connection)throw new DomainError('NOT_FOUND',404,'来源连接不存在');if(stableHash(connection['cursor']??null)!==input.expectedCursorHash)throw new DomainError('CURSOR_CONFLICT',409,'来源水位已被并发推进');
    const result=input.result;if(!['changed','no_change','partial','failed'].includes(result.status))throw new DomainError('INVALID_READ_RESULT',422,'来源读取状态无效');const time=nowIso(ctx);if(result.status==='failed'){
      await tx.query("UPDATE connections SET health='failed',last_attempt_at=$3,last_error_code=$4,updated_at=now() WHERE org_id=$1 AND id=$2",[ctx.orgId,input.connectionId,time,result.errorCode]);await emitOutbox(ctx,tx,'source.failed',input.connectionId,{connectionId:input.connectionId,errorCode:result.errorCode,gaps:result.gaps});return {status:result.status,sourceVersionIds:[],cursorAdvanced:false};
    }
    if((ctx.mode==='live'&&result.mode!=='live')||(connection['read_mode']==='mock')!==(result.mode==='mock'))throw new DomainError('SOURCE_MODE_MISMATCH',409,'真实来源不能使用模拟结果');
    if(result.mode==='live'&&(connection['access_status']!=='connected'||!connection['capabilities_verified_at']))throw new DomainError('SOURCE_UNVERIFIED',409,'真实来源须先通过独立读取验收');
    if(result.status==='no_change'&&result.snapshots.length)throw new DomainError('INVALID_READ_RESULT',422,'无变化结果不得携带新增版本');if(result.status!=='no_change'&&!result.snapshots.length)throw new DomainError('INVALID_READ_RESULT',422,'变化结果必须含实际快照');
    const ids:string[]=[];
    for(const snapshot of result.snapshots){
      if(!snapshot.providerFileId||!snapshot.revision||!/^[a-f0-9]{64}$/.test(snapshot.contentHash)||!snapshot.objectKey||!snapshot.coverage.scope)throw new DomainError('INVALID_SOURCE_SNAPSHOT',422,'来源快照缺少稳定身份、hash或覆盖');finiteDate(snapshot.retrievedAt);
      if(connection['source_kind']==='chatgpt'&&(!snapshot.conversationId||snapshot.coverage.conversation_id!==snapshot.conversationId||!snapshot.coverage.message_ids?.length||!snapshot.coverage.branch))throw new DomainError('CHATGPT_COVERAGE_REQUIRED',422,'指定会话必须有消息定位与分支覆盖');
      const scope=connection['scope_json'] as Row;const kind=String(connection['source_kind']);const allowed=scope[kind==='chatgpt'?'conversation_ids':kind==='mac_drive'?'file_ids':'urls'];const identity=kind==='chatgpt'?snapshot.conversationId:kind==='mac_drive'?snapshot.providerFileId:snapshot.sourceUrl??snapshot.providerFileId;
      const projectAllowed=kind==='chatgpt' && snapshot.projectId && snapshot.coverage.project_id===snapshot.projectId && Array.isArray(scope['project_ids']) && (scope['project_ids'] as string[]).includes(snapshot.projectId);
      if(result.mode==='live'&&!projectAllowed&&(!Array.isArray(allowed)||!allowed.includes(identity)))throw new DomainError('SOURCE_SCOPE_MISMATCH',409,'读取快照超出明确授权范围');
      const document=(await tx.query("INSERT INTO source_documents (id,org_id,provider,provider_file_id,source_url,title,visibility,owner_user_id,connection_id,source_kind,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(org_id,connection_id,provider_file_id) DO UPDATE SET title=EXCLUDED.title RETURNING *",[uuid(),ctx.orgId,kind==='mac_drive'?'drive':'url',snapshot.providerFileId,snapshot.sourceUrl??null,snapshot.title,snapshot.visibility==='public'?'public':'internal',ctx.actorId,input.connectionId,kind,snapshot.conversationId??null])).rows[0]!;
      const existing=(await tx.query('SELECT * FROM source_versions WHERE org_id=$1 AND document_id=$2 AND revision=$3',[ctx.orgId,document['id'],snapshot.revision])).rows[0];let id:string;
      if(existing){if(existing['content_hash']!==snapshot.contentHash||stableHash(existing['coverage_json'])!==stableHash(snapshot.coverage)||existing['object_key']!==snapshot.objectKey||existing['mime_type']!==snapshot.mimeType||existing['visibility']!==snapshot.visibility||((existing['source_modified_at']===null)!==(snapshot.sourceModifiedAt===null))||(existing['source_modified_at']!==null&&finiteDate(existing['source_modified_at'])!==finiteDate(snapshot.sourceModifiedAt)))throw new DomainError('SOURCE_REVISION_CONFLICT',409,'同一来源版本不得覆盖正文或覆盖信息');id=String(existing['id']);}
      else {id=uuid();await tx.query("INSERT INTO source_versions (id,org_id,document_id,revision,content_hash,object_key,mime_type,extraction_status,retrieved_at,source_modified_at,visibility,coverage_json) VALUES($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9,$10,$11)",[id,ctx.orgId,document['id'],snapshot.revision,snapshot.contentHash,snapshot.objectKey,snapshot.mimeType,snapshot.retrievedAt,snapshot.sourceModifiedAt,snapshot.visibility,JSON.stringify(snapshot.coverage)]);}
      await tx.query('UPDATE source_documents SET current_version_id=$3,source_modified_at=$4,updated_at=now() WHERE org_id=$1 AND id=$2',[ctx.orgId,document['id'],id,snapshot.sourceModifiedAt]);ids.push(id);
    }
    const partial=result.status==='partial'||result.gaps.length>0||result.snapshots.some(snapshot=>snapshot.coverage.status!=='complete'||snapshot.coverage.gaps?.length);const status=partial?'partial':result.status;
    await tx.query('UPDATE connections SET cursor=CASE WHEN $6 THEN $3::jsonb ELSE cursor END,health=$4,last_attempt_at=$5,last_success_at=$5,last_error_code=NULL,updated_at=now() WHERE org_id=$1 AND id=$2',[ctx.orgId,input.connectionId,JSON.stringify(result.nextCursor),partial?'partial':'healthy',time,!partial]);
    await audit(ctx,tx,'source.read','connection',input.connectionId,{status,versionCount:ids.length,mode:result.mode});if(result.status!=='no_change')await emitOutbox(ctx,tx,'source.changed',input.connectionId,{sourceVersionIds:ids,gaps:result.gaps,mode:result.mode});return {status,sourceVersionIds:ids,cursorAdvanced:!partial};
  });
}
export interface EvidenceClaimInput {claimText:string;sourceVersionId:string;locator:Record<string,unknown>;assertionType?:'fact'|'inference'|'decision';decisionStatus?:'proposed'|'confirmed'|'revoked'|'disputed'|null;decisionEvidenceRef?:{sourceVersionId:string;locator:Record<string,unknown>;actor:'user'}|null;supersedesClaimId?:string|null;validUntil?:string|null;inferenceRationale?:string|null}
async function validateDecisionExpression(ctx:ServiceContext,tx:SqlExecutor,input:EvidenceClaimInput):Promise<void> {
  if(input.assertionType!=='decision') {if(input.decisionStatus||input.decisionEvidenceRef)throw new DomainError('INVALID_ASSERTION',422,'事实和推断不得带确认决定状态');return;}
  if(!input.decisionStatus)throw new DomainError('DECISION_STATUS_REQUIRED',422,'决策必须明确proposed/confirmed/revoked/disputed');
  if(!['confirmed','revoked'].includes(input.decisionStatus))return;
  const ref=input.decisionEvidenceRef;if(!ref||ref.actor!=='user')throw new DomainError('USER_EXPRESSION_REQUIRED',422,'确认或撤销须定位真实用户表达');
  const source=(await tx.query('SELECT coverage_json FROM source_versions WHERE org_id=$1 AND id=$2',[ctx.orgId,ref.sourceVersionId])).rows[0];const expressions=(source?.['coverage_json'] as Row|undefined)?.['user_expressions'];
  if(!Array.isArray(expressions)||!expressions.some(raw=>{const expression=raw as Row;return expression['actor']==='user'&&expression['claim_text']===input.claimText&&expression['decision_status']===input.decisionStatus&&stableHash(expression['locator'])===stableHash(ref.locator);} ))throw new DomainError('USER_EXPRESSION_REQUIRED',422,'来源覆盖内未找到匹配的用户确认或撤销原文');
}
export async function createEvidenceClaim(ctx:ServiceContext,input:EvidenceClaimInput):Promise<Row> {
  requireRole(ctx,'owner','marketer');if(!input.claimText.trim()||input.claimText.length>4000||!input.locator||!Object.keys(input.locator).length)throw new DomainError('INVALID_CLAIM',422,'主张须有文本和定位');
  if(input.assertionType==='inference'&&!input.inferenceRationale?.trim())throw new DomainError('INFERENCE_RATIONALE_REQUIRED',422,'推断必须与事实分开并说明依据');
  return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','marketer');const source=(await tx.query('SELECT id,coverage_json FROM source_versions WHERE org_id=$1 AND id=$2',[ctx.orgId,input.sourceVersionId])).rows[0];if(!source)throw new DomainError('INVALID_REFERENCE',422,'来源版本必须同组织');await validateDecisionExpression(ctx,tx,input);
    if(input.supersedesClaimId){const previous=(await tx.query('SELECT id FROM evidence_claims WHERE org_id=$1 AND id=$2',[ctx.orgId,input.supersedesClaimId])).rows[0];if(!previous)throw new DomainError('INVALID_REFERENCE',422,'被替代证据必须同组织');}
    if(input.validUntil&&finiteDate(input.validUntil)<=finiteDate(nowIso(ctx)))throw new DomainError('EXPIRED_CLAIM',422,'证据有效期已经过期');
    const row=(await tx.query("INSERT INTO evidence_claims (id,org_id,claim_text,source_version_id,locator,verification_status,valid_until,visibility,public_permission,assertion_type,decision_status,decision_evidence_ref,supersedes_claim_id,content_hash,applicable_scope) VALUES($1,$2,$3,$4,$5,'unverified',$6,'internal','unknown',$7,$8,$9,$10,$11,$12) RETURNING *",[uuid(),ctx.orgId,input.claimText,input.sourceVersionId,JSON.stringify(input.locator),input.validUntil??null,input.assertionType??'fact',input.decisionStatus??null,input.decisionEvidenceRef?JSON.stringify({source_version_id:input.decisionEvidenceRef.sourceVersionId,locator:input.decisionEvidenceRef.locator,actor:'user'}):null,input.supersedesClaimId??null,stableHash({text:input.claimText,sourceVersionId:input.sourceVersionId,locator:input.locator}),JSON.stringify({inference_rationale:input.inferenceRationale??null})])).rows[0]!;
    if(['confirmed','revoked'].includes(input.decisionStatus??'')&&input.supersedesClaimId){await tx.query("UPDATE evidence_claims SET verification_status='expired',version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2",[ctx.orgId,input.supersedesClaimId]);await invalidateDependentTopics(ctx,tx,input.supersedesClaimId);}await audit(ctx,tx,'claim.created','claim',String(row['id']),{assertionType:input.assertionType??'fact',decisionStatus:input.decisionStatus??null});return row;
  });
}
async function invalidateDependentTopics(ctx:ServiceContext,tx:SqlExecutor,claimId:string):Promise<void> {
  const blocked=(await tx.query("UPDATE topics SET state='blocked',scheduled_at=NULL,version=version+1,updated_at=now() WHERE org_id=$1 AND $2::uuid=ANY(claim_ids) AND state NOT IN ('completed','discarded') RETURNING id",[ctx.orgId,claimId])).rows;
  const topicIds=blocked.map(topic=>String(topic['id']));if(topicIds.length)await tx.query("UPDATE execution_actions SET state='blocked',last_error=$3,version=version+1 WHERE org_id=$1 AND state IN ('queued','retry_wait') AND ((target->>'topic_id')=ANY($2::text[]) OR version_id IN (SELECT v.id FROM content_versions v JOIN content_items i ON i.org_id=v.org_id AND i.id=v.content_item_id WHERE i.org_id=$1 AND i.topic_id::text=ANY($2::text[])))",[ctx.orgId,topicIds,JSON.stringify({code:'EVIDENCE_INVALIDATED',claim_id:claimId})]);
  for(const topic of blocked)await emitOutbox(ctx,tx,'topic.blocked',String(topic['id']),{claimId,reason:'evidence_invalidated'});
}
export async function verifyEvidenceClaim(ctx:ServiceContext,id:string,input:{expectedVersion:number;verificationStatus:'verified'|'disputed'|'expired';publicPermission:'allowed'|'anonymous_only'|'denied'|'unknown';permissionEvidenceRef?:Record<string,unknown>}):Promise<Row> {
  requireRole(ctx,'owner','reviewer');return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','reviewer');const claim=(await tx.query('SELECT * FROM evidence_claims WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,id])).rows[0];if(!claim)throw new DomainError('NOT_FOUND',404,'证据不存在');assertVersion(Number(claim['version']),input.expectedVersion);
    if(input.verificationStatus==='verified'&&(await tx.query("SELECT id FROM evidence_claims WHERE org_id=$1 AND supersedes_claim_id=$2 AND (decision_status IN ('confirmed','revoked') OR verification_status='verified') LIMIT 1",[ctx.orgId,id])).rows.length)throw new DomainError('CLAIM_SUPERSEDED',409,'旧主张已被生效结论替代或撤销，须使用新来源主张');
    if(input.verificationStatus==='verified'&&claim['valid_until']&&finiteDate(claim['valid_until'])<=finiteDate(nowIso(ctx)))throw new DomainError('EXPIRED_CLAIM',409,'已过期证据不能核实为有效');
    if(input.publicPermission==='allowed'&&(!input.permissionEvidenceRef||!Object.keys(input.permissionEvidenceRef).length))throw new DomainError('PUBLIC_PERMISSION_REQUIRED',422,'公开许可须有独立依据，内部读取不等于公开许可');
    if(ctx.mode==='live'&&input.publicPermission==='allowed'){const proof=input.permissionEvidenceRef!;if(typeof proof['source_version_id']!=='string'||!proof['locator']||typeof proof['locator']!=='object'||!(await tx.query('SELECT id FROM source_versions WHERE org_id=$1 AND id=$2',[ctx.orgId,proof['source_version_id']])).rows.length)throw new DomainError('PUBLIC_PERMISSION_REQUIRED',422,'真实公开许可必须引用同组织可定位证据');}
    const updated=(await tx.query('UPDATE evidence_claims SET verification_status=$3,public_permission=$4,permission_evidence_ref=$5,verified_by=$6,verified_at=$7,version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *',[ctx.orgId,id,input.verificationStatus,input.publicPermission,input.permissionEvidenceRef?JSON.stringify(input.permissionEvidenceRef):null,ctx.actorId,nowIso(ctx)])).rows[0]!;
    if(input.verificationStatus==='verified'&&claim['supersedes_claim_id'])await invalidateDependentTopics(ctx,tx,String(claim['supersedes_claim_id']));
    if(input.verificationStatus!=='verified'||input.publicPermission!=='allowed')await invalidateDependentTopics(ctx,tx,id);await audit(ctx,tx,'claim.verified','claim',id,{verificationStatus:input.verificationStatus,publicPermission:input.publicPermission});return updated;
  });
}
export async function listInsights(ctx:ServiceContext):Promise<Row[]> {await activeRoles(ctx);return (await ctx.db.query("SELECT i.*,ARRAY(SELECT e.claim_id FROM insight_evidence e WHERE e.org_id=i.org_id AND e.insight_id=i.id ORDER BY e.claim_id) AS claim_ids FROM insights i WHERE i.org_id=$1 ORDER BY CASE WHEN i.state='blocked' THEN 1 ELSE 0 END,i.priority_label,i.data_cutoff DESC,i.id ASC LIMIT 200",[ctx.orgId])).rows;}
export interface SourceInput {provider:'upload'|'drive'|'url';providerFileId?:string;sourceUrl?:string;title:string;visibility:'internal'|'public';connectionId?:string;sourceKind?:'market_public'|'competitor_public'|'mac_drive'|'chatgpt'|'other';conversationId?:string}
export async function createSource(ctx:ServiceContext,input:SourceInput):Promise<Row> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','marketer');if(!input.title.trim()||input.title.length>500)throw new DomainError('INVALID_SOURCE',422,'来源标题无效');
    if(input.connectionId){const connection=(await tx.query('SELECT source_kind,scope_json FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,input.connectionId])).rows[0];if(!connection||connection['source_kind']!==(input.sourceKind??'other')||!input.providerFileId)throw new DomainError('INVALID_REFERENCE',422,'持续来源须绑定同组织连接、稳定文件身份和一致类型');const scope=connection['scope_json'] as Row;if(input.sourceKind==='chatgpt'&&(!input.conversationId||!Array.isArray(scope['conversation_ids'])||!(scope['conversation_ids'] as string[]).includes(input.conversationId)))throw new DomainError('SOURCE_SCOPE_MISMATCH',409,'ChatGPT只登记明确授权的指定会话');}
    if(input.sourceKind==='chatgpt'&&(!input.connectionId||!input.conversationId))throw new DomainError('SOURCE_SCOPE_REQUIRED',422,'ChatGPT来源需要独立连接与指定会话');
    if(input.sourceUrl){let url:URL;try{url=new URL(input.sourceUrl);}catch{throw new DomainError('INVALID_SOURCE_URL',422,'来源URL无效');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new DomainError('INVALID_SOURCE_URL',422,'来源URL不得含凭据或非网页协议');}
    const row=(await tx.query('INSERT INTO source_documents(id,org_id,provider,provider_file_id,source_url,title,visibility,owner_user_id,connection_id,source_kind,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[uuid(),ctx.orgId,input.provider,input.providerFileId??null,input.sourceUrl??null,input.title,input.visibility,ctx.actorId,input.connectionId??null,input.sourceKind??'other',input.conversationId??null])).rows[0]!;await audit(ctx,tx,'source.registered','source_document',String(row['id']),{sourceKind:input.sourceKind??'other'});return row;
  });
}
export async function listSources(ctx:ServiceContext):Promise<Row[]> {await activeRoles(ctx);return (await ctx.db.query('SELECT id,provider,provider_file_id,source_url,title,visibility,connection_id,source_kind,current_version_id,source_modified_at,conversation_id,deleted_at FROM source_documents WHERE org_id=$1 ORDER BY created_at DESC,id LIMIT 200',[ctx.orgId])).rows;}
export async function getSource(ctx:ServiceContext,id:string):Promise<Row> {await activeRoles(ctx);const row=(await ctx.db.query('SELECT * FROM source_documents WHERE org_id=$1 AND id=$2',[ctx.orgId,id])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404,'来源不存在');return row;}
export async function listSourceVersions(ctx:ServiceContext,id:string):Promise<Row[]> {await getSource(ctx,id);return (await ctx.db.query('SELECT id,document_id,revision,content_hash,mime_type,extraction_status,retrieved_at,source_modified_at,visibility,coverage_json FROM source_versions WHERE org_id=$1 AND document_id=$2 ORDER BY retrieved_at DESC,id',[ctx.orgId,id])).rows;}
export async function updateSource(ctx:ServiceContext,id:string,input:{expectedCurrentVersionId:string|null;title?:string;visibility?:'internal'|'public';deleted?:boolean}):Promise<Row> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{await requireActiveRole(ctx,tx,'owner','marketer');const source=(await tx.query('SELECT * FROM source_documents WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,id])).rows[0];if(!source)throw new DomainError('NOT_FOUND',404,'来源不存在');if(source['current_version_id']!==input.expectedCurrentVersionId)throw new DomainError('VERSION_CONFLICT',409,'来源当前版本已变化');const title=input.title??String(source['title']);if(!title.trim()||title.length>500)throw new DomainError('INVALID_SOURCE',422,'来源标题无效');const row=(await tx.query('UPDATE source_documents SET title=$3,visibility=$4,deleted_at=$5,updated_at=now() WHERE org_id=$1 AND id=$2 RETURNING *',[ctx.orgId,id,title,input.visibility??source['visibility'],input.deleted?nowIso(ctx):source['deleted_at']])).rows[0]!;if(input.deleted){const claims=(await tx.query('SELECT c.id FROM evidence_claims c JOIN source_versions v ON v.org_id=c.org_id AND v.id=c.source_version_id WHERE c.org_id=$1 AND v.document_id=$2',[ctx.orgId,id])).rows;for(const claim of claims)await invalidateDependentTopics(ctx,tx,String(claim['id']));}await audit(ctx,tx,input.deleted?'source.deleted':'source.updated','source_document',id);return row;});
}
export async function listClaims(ctx:ServiceContext):Promise<Row[]> {await activeRoles(ctx);return (await ctx.db.query('SELECT * FROM evidence_claims WHERE org_id=$1 ORDER BY created_at DESC,id LIMIT 200',[ctx.orgId])).rows;}
export async function autoScheduleTopics(ctx:ServiceContext,input:{planCycleId:string;policyVersionId:string;topicIds?:string[];slotCandidates?:string[];platformAccountIds?:string[]}):Promise<{scheduled:TopicView[];blocked:{topicId:string;code:string}[]}> {
  await activeRoles(ctx);const policy=(await ctx.db.query('SELECT account_ids,publish_windows FROM policy_versions WHERE org_id=$1 AND id=$2',[ctx.orgId,input.policyVersionId])).rows[0];if(!policy)throw new DomainError('NOT_FOUND',404,'规则版本不存在');
  const accountIds=input.platformAccountIds??(policy['account_ids'] as string[]).slice(0,1);const slots=input.slotCandidates??[];
  if(!slots.length) {
    const windows=policy['publish_windows'] as Row[];const now=finiteDate(nowIso(ctx));const tomorrowDay=shanghaiParts(now).date;
    for(let offset=0;offset<14;offset++){const midnight=Date.parse(`${tomorrowDay}T00:00:00+08:00`)+offset*86400000;for(const window of windows){if(window['timezone']!=='Asia/Shanghai'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(window['start'])))continue;const start=String(window['start']);const candidate=midnight+Number(start.slice(0,2))*3600000+Number(start.slice(3))*60000;if(candidate>now&&accountIds.every(id=>inPublishWindow(candidate,id,windows)))slots.push(new Date(candidate).toISOString());}}
  }
  const topics=(await listTopics(ctx)).filter(topic=>input.topicIds?.includes(topic.id)??topic.state==='ready');const scheduled:TopicView[]=[];const blocked:{topicId:string;code:string}[]=[];
  for(const topic of topics){let failure='NO_APPROVED_SLOT';let result:TopicView|undefined;for(const slot of [...slots].sort()){try{result=await activateTopic(ctx,topic.id,{expectedVersion:topic.version,planCycleId:input.planCycleId,policyVersionId:input.policyVersionId,scheduledAt:slot,platformAccountIds:accountIds});break;}catch(error){if(!(error instanceof DomainError))throw error;failure=error.code;if(!['FREQUENCY_EXCEEDED','OUTSIDE_WINDOW','WINDOW_EXPIRED'].includes(error.code))break;}}if(result)scheduled.push(result);else blocked.push({topicId:topic.id,code:failure});}
  return {scheduled,blocked};
}

const CHANNEL_PROJECTION = [
  {
    "channelId": "wechat_mp",
    "displayName": "微信公众号",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article",
      "image_text"
    ]
  },
  {
    "channelId": "wechat_channels",
    "displayName": "微信视频号",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "video"
    ]
  },
  {
    "channelId": "toutiao",
    "displayName": "今日头条",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article",
      "image_text",
      "video"
    ]
  },
  {
    "channelId": "zhihu",
    "displayName": "知乎",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article",
      "answer"
    ]
  },
  {
    "channelId": "baijiahao",
    "displayName": "百家号",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article",
      "image_text",
      "video"
    ]
  },
  {
    "channelId": "haokan",
    "displayName": "好看视频",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "video"
    ]
  },
  {
    "channelId": "baidu_wenku",
    "displayName": "百度文库",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "document"
    ]
  },
  {
    "channelId": "baidu_zhidao",
    "displayName": "百度知道",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "answer"
    ]
  },
  {
    "channelId": "baidu_jingyan",
    "displayName": "百度经验",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "step_article"
    ]
  },
  {
    "channelId": "baidu_tieba",
    "displayName": "百度贴吧",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "post"
    ]
  },
  {
    "channelId": "baidu_marketing",
    "displayName": "百度营销",
    "role": "paid_marketing",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "read_campaign_reports",
      "read_keyword_reports",
      "read_search_term_reports",
      "create_campaign",
      "update_campaign",
      "create_unit",
      "update_unit",
      "create_keyword",
      "update_keyword",
      "write_unit_negative_keyword",
      "write_account_negative_keyword_if_explicit_policy",
      "create_creative",
      "update_creative",
      "update_landing_url",
      "update_geo",
      "update_schedule",
      "update_bid",
      "enable_entity",
      "pause_entity",
      "readback_effective_fields",
      "restore_before_snapshot",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "paid_search_creative"
    ]
  },
  {
    "channelId": "xiaohongshu",
    "displayName": "小红书",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "image_text",
      "video"
    ]
  },
  {
    "channelId": "douyin",
    "displayName": "抖音",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "video"
    ]
  },
  {
    "channelId": "sohu",
    "displayName": "搜狐",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article"
    ]
  },
  {
    "channelId": "cnblogs",
    "displayName": "博客园",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article"
    ]
  },
  {
    "channelId": "csdn",
    "displayName": "CSDN",
    "role": "content",
    "requiredCapabilities": [
      "verify_account",
      "maintain_session",
      "generate_platform_variant",
      "validate_actual_materials",
      "submit_publish",
      "observe_review_result",
      "readback_actual_result",
      "collect_actual_metrics",
      "reconcile_unknown_result",
      "stop_and_cleanup",
      "verify_advertising_label_rule",
      "verify_ai_label_requirements",
      "apply_required_labels",
      "readback_required_labels"
    ],
    "formatCandidates": [
      "article"
    ]
  }
] as const;
export async function getDistributionManifest(ctx:ServiceContext):Promise<Row[]> {
 await activeRoles(ctx);const accounts=(await ctx.db.query('SELECT a.id,a.channel_id,a.enabled,a.session_status,a.session_expires_at,a.last_session_verified_at,c.access_status,c.health,c.capabilities,c.capabilities_verified_at,c.read_mode FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1',[ctx.orgId])).rows;const now=Date.parse(nowIso(ctx));
 const fresh=(value:unknown)=>{const at=Date.parse(String(value));return Number.isFinite(at)&&at<=now+60_000&&at>=now-7*86400_000;};
 return CHANNEL_PROJECTION.map(channel=>{const related=accounts.filter(account=>account['channel_id']===channel.channelId);const verified=related.some(account=>{const capabilities=account['capabilities'] as Row;return account['enabled']&&account['session_status']==='active'&&fresh(account['last_session_verified_at'])&&(account['session_expires_at']===null||Date.parse(String(account['session_expires_at']))>now)&&account['access_status']==='connected'&&account['health']==='healthy'&&fresh(account['capabilities_verified_at'])&&account['read_mode']!=='mock'&&channel.requiredCapabilities.every(capability=>capabilities[capability]===true);});return {...channel,requiredInV1:true,implementationStatus:verified?'verified':'pending',enabled:verified,accounts:related.map(account=>({id:account['id'],accessStatus:account['access_status'],sessionStatus:account['session_status']})),credentialConfigured:related.some(account=>account['access_status']==='connected'&&account['capabilities_verified_at']&&account['read_mode']!=='mock')};});
}

export function resolveProductAlias(value:string):{productFamilyKey:string|null;productMember:string|null;status:'confirmed'|'pending'|'unknown';rawKeyword:string} {
 const normalized=value.normalize('NFKC').trim().toLowerCase();
 for(const entry of BUSINESS_PROJECTION){if(entry.category!=='product_family')continue;const family=entry as Extract<typeof BUSINESS_PROJECTION[number],{category:'product_family'}>;if((family.pendingAliases as readonly string[]).some(alias=>alias.toLowerCase()===normalized))return {productFamilyKey:family.businessKey,productMember:null,status:'pending',rawKeyword:value};for(const [member,aliases] of Object.entries(family.aliasesByMember))if((aliases as readonly string[]).some(alias=>alias.toLowerCase()===normalized))return {productFamilyKey:family.businessKey,productMember:member,status:'confirmed',rawKeyword:value};}
 return {productFamilyKey:null,productMember:null,status:'unknown',rawKeyword:value};
}
