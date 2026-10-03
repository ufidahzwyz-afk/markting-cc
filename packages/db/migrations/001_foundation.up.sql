-- PostgreSQL baseline generated from approved schema definitions. No business source content.
CREATE TABLE organizations (
  id uuid NOT NULL,
  name varchar(200) NOT NULL,
  timezone varchar(64) NOT NULL,
  base_currency char(3) NOT NULL,
  write_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
-- statement-breakpoint
CREATE TABLE users (
  id uuid NOT NULL,
  identity_subject varchar(255) NOT NULL,
  email varchar(320) NOT NULL,
  display_name varchar(100) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (identity_subject)
);
-- statement-breakpoint
CREATE TABLE memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  roles text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CHECK (cardinality(roles) > 0 AND roles <@ ARRAY['owner','marketer','reviewer','sales','admin','viewer']::text[]),
  PRIMARY KEY (id),
  UNIQUE (org_id,user_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider varchar(60) NOT NULL,
  account_external_id varchar(200) NOT NULL,
  display_name varchar(200) NOT NULL,
  timezone varchar(64) NOT NULL,
  currency char(3) NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}',
  secret_ref text,
  health varchar(40) NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown','healthy','partial','stale','rate_limited','failed','disabled')),
  enabled_for_reporting boolean NOT NULL DEFAULT false,
  authoritative_report_type varchar(80),
  last_success_at timestamptz,
  capabilities_verified_at timestamptz,
  source_kind varchar(30) CHECK (source_kind IN ('market_public','competitor_public','mac_drive','chatgpt','other')),
  scope_json jsonb NOT NULL DEFAULT '{}',
  read_mode varchar(40) NOT NULL DEFAULT 'native_api' CHECK (read_mode IN ('native_api','authorized_browser','drive_sync','manual_import','mock')),
  access_status varchar(40) NOT NULL DEFAULT 'not_configured' CHECK (access_status IN ('not_configured','verifying','connected','auth_required','unsupported','disabled')),
  cursor jsonb,
  last_attempt_at timestamptz,
  last_error_code varchar(100),
  browser_fencing_token bigint NOT NULL DEFAULT 0 CHECK (browser_fencing_token >= 0),
  CHECK (access_status <> 'connected' OR capabilities_verified_at IS NOT NULL),
  PRIMARY KEY (id),
  UNIQUE (org_id,provider,account_external_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE business_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  business_line varchar(20) NOT NULL,
  name varchar(200) NOT NULL,
  metric_key varchar(80) NOT NULL,
  target_value numeric(20,4),
  period_start date NOT NULL,
  period_end date NOT NULL,
  owner_user_id uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE keywords (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  raw_text text NOT NULL,
  normalized_text text NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('keyword','search_term','question')),
  business_line varchar(20) NOT NULL,
  intent varchar(20) NOT NULL,
  cluster_key varchar(100),
  source_ref jsonb NOT NULL,
  page_id uuid,
  status varchar(20) NOT NULL CHECK (status IN ('new','active','rejected','archived')),
  search_volume bigint CHECK (search_volume >= 0),
  cpc_minor bigint CHECK (cpc_minor >= 0),
  PRIMARY KEY (id),
  UNIQUE (org_id,kind,business_line,normalized_text),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE plan_cycles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  week_start date NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  goal_ids uuid[] NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('draft','active','closed')),
  assumptions jsonb NOT NULL,
  source_snapshot jsonb NOT NULL,
  generated_by_run_id uuid,
  PRIMARY KEY (id),
  UNIQUE (org_id,week_start,revision),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  plan_cycle_id uuid,
  type varchar(30) NOT NULL,
  title varchar(200) NOT NULL,
  brief jsonb NOT NULL,
  business_line varchar(20) NOT NULL,
  owner_user_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  priority varchar(5) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('todo','doing','blocked','done','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE experiments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  task_id uuid,
  hypothesis text NOT NULL,
  variable text NOT NULL,
  comparison_ref jsonb NOT NULL,
  metric_key varchar(80) NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  stop_conditions jsonb NOT NULL,
  result varchar(20) CHECK (result IN ('supported','rejected','inconclusive')),
  evidence jsonb NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE source_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider varchar(30) NOT NULL,
  provider_file_id text,
  source_url text,
  title text NOT NULL,
  visibility varchar(20) NOT NULL,
  owner_user_id uuid NOT NULL,
  deleted_at timestamptz,
  connection_id uuid,
  source_kind varchar(30) NOT NULL DEFAULT 'other' CHECK (source_kind IN ('market_public','competitor_public','mac_drive','chatgpt','other')),
  current_version_id uuid,
  source_modified_at timestamptz,
  conversation_id text,
  PRIMARY KEY (id),
  UNIQUE (org_id,connection_id,provider_file_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE source_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  document_id uuid NOT NULL,
  revision text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL,
  mime_type varchar(200) NOT NULL,
  extraction_status varchar(20) NOT NULL CHECK (extraction_status IN ('queued','ready','needs_ocr','failed')),
  text_object_key text,
  retrieved_at timestamptz NOT NULL,
  source_modified_at timestamptz,
  visibility varchar(40) NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','public','restricted')),
  coverage_json jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (id),
  UNIQUE (org_id,document_id,revision),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE evidence_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claim_text text NOT NULL,
  source_version_id uuid NOT NULL,
  locator jsonb NOT NULL,
  verification_status varchar(20) NOT NULL CHECK (verification_status IN ('unverified','verified','disputed','expired')),
  verified_by uuid,
  verified_at timestamptz,
  valid_until timestamptz,
  visibility varchar(20) NOT NULL,
  public_permission varchar(20) NOT NULL,
  permission_evidence_ref jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  assertion_type varchar(40) NOT NULL DEFAULT 'fact' CHECK (assertion_type IN ('fact','inference','decision')),
  decision_status varchar(40) CHECK (decision_status IN ('proposed','confirmed','revoked','disputed')),
  supersedes_claim_id uuid,
  decision_evidence_ref jsonb,
  source_date date,
  calculation_scope text,
  applicable_scope jsonb,
  content_hash char(64) CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  claim_category varchar(60),
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE content_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind varchar(30) NOT NULL CHECK (kind IN ('mother_draft','article','landing_page','case','ad_copy','qa','image_text','video_script','subtitle','storyboard')),
  business_line varchar(20) NOT NULL,
  task_id uuid,
  owner_user_id uuid NOT NULL,
  title text NOT NULL,
  deleted_at timestamptz,
  topic_id uuid,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE content_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  content_item_id uuid NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  body_json jsonb NOT NULL,
  claim_ids uuid[] NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  review_status varchar(30) NOT NULL CHECK (review_status IN ('draft','in_review','approved','changes_requested')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  ai_run_id uuid,
  warnings jsonb NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,content_item_id,version_no),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE pages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  host varchar(255) NOT NULL,
  path text NOT NULL,
  owner_system varchar(20) NOT NULL,
  business_line varchar(20) NOT NULL,
  template_key varchar(60),
  content_item_id uuid,
  primary_keyword_id uuid,
  seo_title text,
  description text,
  canonical_url text NOT NULL,
  index_policy varchar(20) NOT NULL,
  form_schema_id varchar(50),
  published_release_id uuid,
  owner_user_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,host,path),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE releases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  page_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  action_id uuid NOT NULL,
  published_at timestamptz NOT NULL,
  previous_release_id uuid,
  rollback_of_id uuid,
  seo_snapshot jsonb NOT NULL,
  route_config_version text NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  action_type varchar(30) NOT NULL,
  target jsonb NOT NULL,
  version_id uuid,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  before_snapshot jsonb NOT NULL,
  after_preview jsonb NOT NULL,
  budget_impact jsonb NOT NULL,
  requested_by uuid NOT NULL,
  decision varchar(20) NOT NULL CHECK (decision IN ('pending','approved','rejected','invalidated','revoked','consumed')),
  decided_by uuid,
  decided_at timestamptz,
  expires_at timestamptz NOT NULL,
  reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE execution_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approval_id uuid,
  idempotency_key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state varchar(40) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','blocked','executing','submitted','waiting_review','verification_pending','retry_wait','succeeded','failed','unknown','externally_completed','cancelled')),
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb,
  external_id text,
  lease_until timestamptz,
  last_error jsonb,
  manual_receipt jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  policy_version_id uuid,
  action_type varchar(40) NOT NULL CHECK (action_type IN ('content.publish','content.unpublish','ads.update','ads.pause','external.publish','reception.reply')),
  target jsonb NOT NULL,
  version_id uuid,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  verification_evidence_ref jsonb,
  budget_snapshot jsonb,
  lease_owner varchar(200),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  CHECK ((policy_version_id IS NOT NULL)::int + (approval_id IS NOT NULL)::int = 1),
  CHECK (state <> 'succeeded' OR (verified_at IS NOT NULL AND verification_evidence_ref IS NOT NULL)),
  PRIMARY KEY (id),
  UNIQUE (org_id,approval_id),
  UNIQUE (org_id,idempotency_key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE action_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  action_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no >= 1),
  request_id text NOT NULL,
  request_digest char(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  response_digest char(64) CHECK (response_digest ~ '^[0-9a-f]{64}$'),
  result varchar(20) NOT NULL CHECK (result IN ('success','failure','unknown')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  phase varchar(40) NOT NULL DEFAULT 'submit' CHECK (phase IN ('submit','verify','reconcile')),
  PRIMARY KEY (id),
  UNIQUE (org_id,action_id,attempt_no),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE ingestion_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  connection_id uuid NOT NULL,
  report_type varchar(80) NOT NULL,
  window_start date NOT NULL,
  window_end date NOT NULL,
  file_hash char(64) NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  object_key text NOT NULL,
  schema_version varchar(20) NOT NULL,
  mapping jsonb NOT NULL,
  state varchar(20) NOT NULL CHECK (state IN ('uploaded','validated','committed','rejected')),
  quality varchar(20) NOT NULL CHECK (quality IN ('complete','partial','stale','missing','quarantined')),
  row_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  source_total jsonb,
  source_watermark timestamptz,
  complete_confirmed_by uuid,
  PRIMARY KEY (id),
  UNIQUE (org_id,connection_id,report_type,window_start,window_end,file_hash),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE ad_daily_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  connection_id uuid NOT NULL,
  business_date date NOT NULL,
  report_type varchar(80) NOT NULL,
  entity_level varchar(20) NOT NULL,
  entity_external_id text NOT NULL,
  parent_external_id text,
  dimensions_json jsonb NOT NULL,
  dimension_hash char(64) NOT NULL CHECK (dimension_hash ~ '^[0-9a-f]{64}$'),
  currency char(3) NOT NULL,
  conversion_definition varchar(80) NOT NULL,
  impressions bigint NOT NULL CHECK (impressions >= 0),
  clicks bigint NOT NULL CHECK (clicks >= 0),
  spend_minor bigint NOT NULL CHECK (spend_minor >= 0),
  platform_conversions numeric(20,4),
  ingestion_batch_id uuid NOT NULL,
  source_updated_at timestamptz NOT NULL,
  is_final boolean NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,connection_id,business_date,report_type,entity_level,entity_external_id,dimension_hash,currency,conversion_definition),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE web_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NOT NULL,
  event_type varchar(30) NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  anonymous_id uuid,
  session_id uuid,
  page_id uuid NOT NULL,
  release_id uuid,
  attribution jsonb NOT NULL,
  properties jsonb NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,event_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  company varchar(200),
  contact_ciphertext text,
  contact_hmac char(64) CHECK (contact_hmac ~ '^[0-9a-f]{64}$'),
  business_line varchar(20) NOT NULL,
  need text NOT NULL,
  owner_user_id uuid,
  status varchar(20) NOT NULL CHECK (status IN ('new','assigned','contacted','qualified','invalid')),
  invalid_reason varchar(30),
  first_touch jsonb NOT NULL,
  last_non_direct_touch jsonb NOT NULL,
  acquired_at timestamptz NOT NULL,
  qualified_at timestamptz,
  merged_into_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  topic_id uuid,
  contact_id uuid NOT NULL,
  commercial_intent varchar(60) NOT NULL,
  intent_evidence_ref jsonb NOT NULL,
  last_touch jsonb NOT NULL DEFAULT '{}',
  metric_policy_version_id uuid,
  funnel_stage varchar(30) NOT NULL DEFAULT 'REAL_LEAD' CHECK (funnel_stage IN ('REAL_LEAD','CONTACTED','QUALIFIED','OPPORTUNITY','DEMO','PROPOSAL','QUOTED','WON','LOST','NURTURE','REACTIVATED')),
  feedback_json jsonb NOT NULL DEFAULT '{}',
  test_record boolean NOT NULL DEFAULT false,
  dedupe_window_start timestamptz NOT NULL,
  quality_level varchar(30) NOT NULL DEFAULT 'real_lead' CHECK (quality_level IN ('real_lead','qualified_lead')),
  qualified_by uuid,
  qualification_evidence_ref jsonb,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE lead_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submission_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  lead_id uuid,
  page_id uuid,
  release_id uuid,
  channel varchar(30) NOT NULL,
  privacy_notice_version varchar(40) NOT NULL,
  consent boolean NOT NULL,
  attribution jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  publish_job_id uuid,
  contact_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  test_record boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  UNIQUE (org_id,submission_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE lead_status_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL,
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  actor_id uuid NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL,
  from_funnel_stage varchar(30),
  to_funnel_stage varchar(30),
  evidence_ref jsonb,
  next_step text,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  stage varchar(20) NOT NULL,
  amount_minor bigint CHECK (amount_minor >= 0),
  currency char(3),
  closed_at timestamptz,
  close_reason text,
  source_ref jsonb,
  problem text,
  product_or_scope text,
  sales_accepted_at timestamptz,
  next_step text,
  quote_external_id varchar(200),
  quote_date date,
  quote_scope text,
  contract_or_order_ref jsonb,
  won_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE geo_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  question_key varchar(80) NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  question_text text NOT NULL,
  business_line varchar(20) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id),
  UNIQUE (org_id,question_key,version),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE geo_observations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  question_id uuid NOT NULL,
  batch_key varchar(100) NOT NULL,
  repetition_no integer NOT NULL,
  platform varchar(80) NOT NULL,
  product_mode varchar(80) NOT NULL,
  model_version varchar(120),
  region varchar(80) NOT NULL,
  observed_at timestamptz NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('valid','timeout','refused','invalid')),
  answer_text text,
  evidence_object_key text,
  citations jsonb NOT NULL,
  brand_mentioned boolean,
  website_cited boolean,
  reviewed_by uuid,
  reviewed_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (org_id,question_id,batch_key,platform,product_mode,repetition_no),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE workflow_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind varchar(50) NOT NULL CHECK (kind IN ('source_watch','insight_topics','weekly_plan','platform_assets','publish_content','baidu_execute','metrics_collect','daily_report','seo_review','geo_review','import','archive','reception_reply','privacy_request')),
  period_key varchar(60) NOT NULL,
  schedule_version integer NOT NULL DEFAULT 1 CHECK (schedule_version >= 1),
  status varchar(30) NOT NULL CHECK (status IN ('queued','running','waiting_external','needs_human','succeeded','partial','failed','cancelled')),
  input_ref jsonb NOT NULL,
  output_ref jsonb,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error jsonb,
  PRIMARY KEY (id),
  UNIQUE (org_id,kind,period_key,schedule_version),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE workflow_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  run_id uuid NOT NULL,
  step_key varchar(80) NOT NULL,
  state varchar(30) NOT NULL CHECK (state IN ('queued','running','waiting_external','needs_human','succeeded','partial','failed','cancelled','unknown')),
  attempts integer NOT NULL DEFAULT 0,
  input_ref jsonb NOT NULL,
  output_ref jsonb,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  error jsonb,
  source_result varchar(40) CHECK (source_result IN ('changed','no_change','partial','failed')),
  lease_owner varchar(200),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  ordinal integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  execution_mode varchar(30) NOT NULL DEFAULT 'read_only' CHECK (execution_mode IN ('mock','read_only','external_write')),
  external_write boolean NOT NULL DEFAULT false,
  CHECK (external_write = (execution_mode = 'external_write')),
  PRIMARY KEY (id),
  UNIQUE (org_id,run_id,step_key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE outbox_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid NOT NULL,
  event_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,event_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE ai_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  workflow_run_id uuid,
  provider varchar(80) NOT NULL,
  model varchar(120) NOT NULL,
  prompt_version varchar(60) NOT NULL,
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  source_ids uuid[] NOT NULL,
  output_hash char(64) CHECK (output_hash ~ '^[0-9a-f]{64}$'),
  output_ref jsonb,
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  cost_micro bigint CHECK (cost_micro >= 0),
  currency char(3),
  quality_result jsonb NOT NULL,
  latency_ms integer,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE report_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind varchar(20) NOT NULL CHECK (kind IN ('daily','weekly')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  metric_version varchar(40) NOT NULL,
  source_batch_ids uuid[] NOT NULL,
  query_hash char(64) NOT NULL CHECK (query_hash ~ '^[0-9a-f]{64}$'),
  data_cutoff timestamptz NOT NULL,
  quality varchar(20) NOT NULL CHECK (quality IN ('complete','partial','stale','missing')),
  metrics_json jsonb NOT NULL,
  body_json jsonb NOT NULL,
  archive_status varchar(20) NOT NULL CHECK (archive_status IN ('pending','succeeded','failed')),
  drive_file_id text,
  archive_hash char(64) CHECK (archive_hash ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (org_id,kind,period_start,period_end,revision),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  report_id uuid NOT NULL,
  channel varchar(40) NOT NULL,
  recipient_ref text NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('pending','sending','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  provider_message_id text,
  PRIMARY KEY (id),
  UNIQUE (org_id,report_id,channel,recipient_ref),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  actor_type varchar(20) NOT NULL CHECK (actor_type IN ('user','service')),
  actor_id text NOT NULL,
  action varchar(100) NOT NULL,
  target_type varchar(80) NOT NULL,
  target_id text NOT NULL,
  before_hash char(64) CHECK (before_hash ~ '^[0-9a-f]{64}$'),
  after_hash char(64) CHECK (after_hash ~ '^[0-9a-f]{64}$'),
  request_id varchar(100) NOT NULL,
  details jsonb NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE cost_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  provider varchar(80) NOT NULL,
  resource varchar(100) NOT NULL,
  currency char(3) NOT NULL,
  amount_micro bigint NOT NULL CHECK (amount_micro >= 0),
  usage jsonb NOT NULL,
  cost_type varchar(20) NOT NULL,
  external_ref text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  key varchar(100) NOT NULL,
  value jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  updated_by uuid NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE idempotency_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scope varchar(100) NOT NULL,
  key varchar(128) NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status_code integer,
  response_json jsonb,
  resource_id uuid,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,scope,key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE execution_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name varchar(200) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','revoked')),
  active_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE policy_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  policy_id uuid NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  business_scope jsonb NOT NULL,
  account_ids uuid[] NOT NULL,
  allowed_actions text[] NOT NULL,
  currency char(3) NOT NULL DEFAULT 'CNY',
  daily_budget_minor bigint CHECK (daily_budget_minor >= 0),
  total_budget_minor bigint CHECK (total_budget_minor >= 0),
  max_bid_change_pct numeric(7,4),
  publish_frequency jsonb NOT NULL DEFAULT '{}',
  publish_windows jsonb NOT NULL DEFAULT '[]',
  stop_conditions jsonb NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  allowed_ad_operations text[] NOT NULL DEFAULT '{}' CHECK (allowed_ad_operations <@ ARRAY['create','update','enable','pause']::text[]),
  allowed_ad_entity_levels text[] NOT NULL DEFAULT '{}' CHECK (allowed_ad_entity_levels <@ ARRAY['account','campaign','unit','keyword','negative_keyword','creative']::text[]),
  approved_path_prefixes text[] NOT NULL DEFAULT '{}',
  reception_scope jsonb NOT NULL DEFAULT '{}',
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (max_bid_change_pct IS NULL OR max_bid_change_pct BETWEEN 0 AND 100),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  PRIMARY KEY (id),
  UNIQUE (org_id,policy_id,version_no),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE insights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL,
  business_line varchar(40) NOT NULL CHECK (business_line IN ('yonyou','seeyon','shared')),
  customer_problem text NOT NULL,
  opportunity text NOT NULL,
  inference_text text,
  priority_score numeric(5,2),
  priority_reason text NOT NULL,
  data_cutoff timestamptz NOT NULL,
  state varchar(40) NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','ready','blocked','superseded','discarded')),
  ai_run_id uuid,
  metric_snapshot_refs jsonb NOT NULL DEFAULT '[]',
  dedupe_key char(64) NOT NULL CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  score_breakdown jsonb NOT NULL DEFAULT '{}',
  priority_label varchar(10) NOT NULL DEFAULT 'P2' CHECK (priority_label IN ('P0','P1','P2')),
  scoring_mode varchar(30) NOT NULL DEFAULT 'qualitative' CHECK (scoring_mode IN ('qualitative','numeric_calibrated')),
  metric_policy_version_id uuid,
  PRIMARY KEY (id),
  UNIQUE (org_id,dedupe_key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE insight_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  insight_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  relation varchar(40) NOT NULL DEFAULT 'supports' CHECK (relation IN ('supports','contradicts','context')),
  PRIMARY KEY (id),
  UNIQUE (org_id,insight_id,claim_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE topics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  insight_id uuid,
  business_line varchar(40) NOT NULL CHECK (business_line IN ('yonyou','seeyon','shared')),
  title varchar(300) NOT NULL,
  audience text NOT NULL,
  problem text NOT NULL,
  offer text NOT NULL,
  angle text NOT NULL,
  keyword_ids uuid[] NOT NULL DEFAULT '{}',
  claim_ids uuid[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 2 CHECK (priority IN (0,1,2)),
  plan_cycle_id uuid,
  policy_version_id uuid,
  state varchar(40) NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate','ready','scheduled','active','completed','blocked','discarded')),
  scheduled_at timestamptz,
  dedupe_key char(64) NOT NULL CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  industry_key varchar(100),
  product_family_key varchar(100),
  domain_keys text[] NOT NULL DEFAULT '{}',
  decision_stage varchar(60),
  region_name varchar(100),
  PRIMARY KEY (id),
  UNIQUE (org_id,dedupe_key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE platform_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  connection_id uuid NOT NULL,
  provider varchar(60) NOT NULL,
  account_external_id varchar(200) NOT NULL,
  display_name varchar(200) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  session_status varchar(40) NOT NULL DEFAULT 'not_connected' CHECK (session_status IN ('not_connected','active','expired','challenge_required','revoked','unknown')),
  session_secret_ref text,
  session_expires_at timestamptz,
  last_session_verified_at timestamptz,
  timezone varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  adapter_version varchar(80),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  profile_ref text,
  session_version bigint NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  browser_fencing_token bigint NOT NULL DEFAULT 0 CHECK (browser_fencing_token >= 0),
  channel_id varchar(60),
  PRIMARY KEY (id),
  UNIQUE (org_id,provider,account_external_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE platform_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  platform_account_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  current_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,platform_account_id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE platform_profile_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  profile_id uuid NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  audience text NOT NULL,
  style_samples jsonb NOT NULL DEFAULT '[]',
  allowed_formats text[] NOT NULL,
  rules_json jsonb NOT NULL,
  rules_source_urls text[] NOT NULL,
  rules_checked_at timestamptz NOT NULL,
  asset_requirements jsonb NOT NULL DEFAULT '{}',
  calibrated_at timestamptz,
  calibrated_by uuid,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (id),
  UNIQUE (org_id,profile_id,version_no),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE media_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  kind varchar(40) NOT NULL CHECK (kind IN ('image','cover','video','audio','script','storyboard','subtitle','text','other')),
  mime_type varchar(200) NOT NULL,
  object_key text,
  content_hash char(64) CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_version_id uuid,
  content_version_id uuid,
  public_permission varchar(40) NOT NULL DEFAULT 'unknown' CHECK (public_permission IN ('allowed','anonymous_only','denied','unknown')),
  state varchar(40) NOT NULL DEFAULT 'needed' CHECK (state IN ('needed','generating','ready','failed','revoked')),
  metadata_json jsonb NOT NULL DEFAULT '{}',
  brand_authorization_id uuid,
  license_evidence_ref jsonb,
  cropping_snapshot_ref jsonb,
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE content_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  mother_content_version_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  platform_account_id uuid NOT NULL,
  platform_profile_version_id uuid NOT NULL,
  format varchar(40) NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  asset_ids uuid[] NOT NULL DEFAULT '{}',
  validation_status varchar(40) NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','passed','blocked','failed')),
  validation_json jsonb NOT NULL DEFAULT '{}',
  validated_at timestamptz,
  validated_payload_hash char(64) CHECK (validated_payload_hash ~ '^[0-9a-f]{64}$'),
  ai_generated boolean NOT NULL DEFAULT false,
  ai_label_requirement jsonb NOT NULL DEFAULT '{}',
  ai_label_applied jsonb NOT NULL DEFAULT '{}',
  ai_label_readback jsonb,
  ai_label_evidence_ref jsonb,
  PRIMARY KEY (id),
  UNIQUE (org_id,mother_content_version_id,platform_account_id,format,revision),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE publish_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  execution_action_id uuid NOT NULL,
  platform_account_id uuid NOT NULL,
  content_variant_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  schedule_slot_key varchar(128) NOT NULL,
  delivery_state varchar(40) NOT NULL DEFAULT 'scheduled' CHECK (delivery_state IN ('scheduled','queued','executing','submitted','in_review','published_verified','retry_wait','blocked','rejected','failed','unknown','cancelled')),
  external_id text,
  published_url text,
  submission_receipt jsonb,
  verification_status varchar(40) NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','absent','mismatch','unknown')),
  verification_evidence_ref jsonb,
  verified_at timestamptz,
  next_attempt_at timestamptz,
  CHECK (delivery_state <> 'published_verified' OR (verified_at IS NOT NULL AND verification_status = 'verified' AND verification_evidence_ref IS NOT NULL)),
  PRIMARY KEY (id),
  UNIQUE (org_id,execution_action_id),
  UNIQUE (org_id,platform_account_id,content_variant_id,schedule_slot_key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE browser_commands (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  platform_account_id uuid,
  connection_id uuid,
  execution_action_id uuid,
  workflow_run_id uuid,
  login_session_id uuid,
  command_type varchar(30) NOT NULL CHECK (command_type IN ('login','session_verify','source_fetch','publish','ad_read','ad_write','reconcile','reception_read','reception_write')),
  idempotency_key varchar(128) NOT NULL,
  state varchar(30) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','blocked','succeeded','failed','unknown','cancelled')),
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  session_version bigint CHECK (session_version >= 0),
  input_ref jsonb NOT NULL,
  result_ref jsonb,
  lease_owner varchar(200),
  lease_until timestamptz,
  heartbeat_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error jsonb,
  PRIMARY KEY (id),
  UNIQUE (org_id,idempotency_key),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE login_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  platform_account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  ticket_hash char(64) NOT NULL CHECK (ticket_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  state varchar(30) NOT NULL DEFAULT 'created' CHECK (state IN ('created','active','completed','expired','cancelled','failed')),
  browser_command_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  consumed_at timestamptz,
  expected_session_version bigint NOT NULL CHECK (expected_session_version >= 0),
  result_ref jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  ticket_expires_at timestamptz NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (org_id,ticket_hash),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE business_master_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  category varchar(40) NOT NULL CHECK (category IN ('product_family','business_domain','industry','service','business_rule')),
  business_key varchar(100) NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  name varchar(200) NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  status varchar(30) NOT NULL CHECK (status IN ('confirmed','recommended','pending','revoked')),
  payload_json jsonb NOT NULL,
  source_version_id uuid NOT NULL,
  source_locator jsonb NOT NULL,
  supersedes_id uuid,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,category,business_key,version_no)
);
-- statement-breakpoint
CREATE TABLE brand_authorizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  brand_key varchar(60) NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  business_status varchar(30) NOT NULL CHECK (business_status IN ('confirmed','pending','revoked')),
  authorization_status varchar(30) NOT NULL CHECK (authorization_status IN ('active','unverified','expired','revoked','restricted')),
  source_version_id uuid NOT NULL,
  source_locator jsonb NOT NULL,
  proof_ref jsonb,
  allowed_channels text[] NOT NULL,
  allowed_assets_json jsonb NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  observed_at timestamptz,
  confirmed_by uuid,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,brand_key,version_no)
);
-- statement-breakpoint
CREATE TABLE lead_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  contact_type varchar(30) NOT NULL CHECK (contact_type IN ('phone','wechat','email','inbound_call')),
  normalized_contact_hmac char(64) NOT NULL CHECK (normalized_contact_hmac ~ '^[0-9a-f]{64}$'),
  contact_ciphertext text NOT NULL,
  company varchar(200),
  normalized_company_hash char(64) CHECK (normalized_company_hash ~ '^[0-9a-f]{64}$'),
  reachable_status varchar(30) NOT NULL CHECK (reachable_status IN ('unknown','verified','unreachable')),
  reachable_evidence_ref jsonb,
  consent_status varchar(30) NOT NULL CHECK (consent_status IN ('pending','granted','withdrawn','denied')),
  consent_at timestamptz,
  privacy_notice_version varchar(80) NOT NULL,
  allowed_contact_channels text[] NOT NULL,
  retention_until timestamptz NOT NULL,
  lawful_basis varchar(80) NOT NULL,
  consultation_processing_permission varchar(30) NOT NULL CHECK (consultation_processing_permission IN ('pending','permitted','denied','withdrawn')),
  marketing_consent_status varchar(30) NOT NULL CHECK (marketing_consent_status IN ('pending','granted','denied','withdrawn')),
  marketing_consent_at timestamptz,
  deletion_status varchar(30) NOT NULL CHECK (deletion_status IN ('active','requested','deleted','restricted')),
  withdrawal_status varchar(30) NOT NULL CHECK (withdrawal_status IN ('none','requested','completed')),
  export_status varchar(30) NOT NULL CHECK (export_status IN ('none','requested','completed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id)
);
-- statement-breakpoint
CREATE TABLE contact_captures (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid NOT NULL,
  lead_id uuid,
  event_key varchar(200) NOT NULL,
  source_channel varchar(60) NOT NULL,
  conversation_id uuid,
  submission_id uuid,
  captured_at timestamptz NOT NULL,
  commercial_intent_status varchar(30) NOT NULL CHECK (commercial_intent_status IN ('unknown','confirmed','no_commercial_intent')),
  intent_type varchar(60),
  intent_evidence_ref jsonb,
  dedupe_window_start timestamptz NOT NULL,
  counted_real_lead boolean NOT NULL DEFAULT false,
  test_record boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,source_channel,event_key)
);
-- statement-breakpoint
CREATE TABLE reception_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  connection_id uuid NOT NULL,
  external_conversation_id varchar(200) NOT NULL,
  contact_id uuid,
  lead_id uuid,
  anonymous_id varchar(200),
  started_at timestamptz NOT NULL,
  last_visitor_message_at timestamptz,
  first_response_at timestamptz,
  silent_followup_count integer NOT NULL DEFAULT 0,
  contact_captured_at timestamptz,
  handoff_status varchar(30) NOT NULL DEFAULT 'none' CHECK (handoff_status IN ('none','requested','assigned','completed','failed')),
  handoff_owner_user_id uuid,
  state varchar(30) NOT NULL CHECK (state IN ('bot_active','waiting_customer','contact_captured','handoff_requested','human_active','closed','blocked')),
  policy_version_id uuid,
  test_record boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,connection_id,external_conversation_id)
);
-- statement-breakpoint
CREATE TABLE reception_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid NOT NULL,
  external_message_id varchar(200) NOT NULL,
  role varchar(30) NOT NULL CHECK (role IN ('visitor','assistant','human','system')),
  sanitized_text text NOT NULL,
  encrypted_content_ref text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  ai_run_id uuid,
  execution_action_id uuid,
  delivery_status varchar(30) NOT NULL CHECK (delivery_status IN ('received','proposed','submitted','delivered_verified','unknown','failed')),
  evidence_ref jsonb,
  question_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,conversation_id,external_message_id)
);
-- statement-breakpoint
CREATE TABLE attribution_touches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  event_key varchar(200) NOT NULL,
  contact_id uuid,
  lead_id uuid,
  capture_id uuid,
  conversation_id uuid,
  channel varchar(60) NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  connection_id uuid,
  campaign_external_id varchar(200),
  unit_external_id varchar(200),
  keyword_external_id varchar(200),
  query_ciphertext text,
  sanitized_query text,
  content_item_id uuid,
  page_id uuid,
  publish_job_id uuid,
  click_id_hash char(64) CHECK (click_id_hash ~ '^[0-9a-f]{64}$'),
  evidence_ref jsonb NOT NULL,
  verification_status varchar(30) NOT NULL CHECK (verification_status IN ('verified','unknown','conflicting')),
  metric_policy_version_id uuid,
  is_paid_attributed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,channel,event_key)
);
-- statement-breakpoint
CREATE TABLE metric_policy_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  policy_key varchar(60) NOT NULL,
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  status varchar(30) NOT NULL CHECK (status IN ('draft','approved','revoked')),
  dedupe_window_days integer NOT NULL DEFAULT 30,
  attribution_window_days integer,
  cohort_maturation_window_days integer,
  scoring_mode varchar(30) NOT NULL DEFAULT 'qualitative' CHECK (scoring_mode IN ('qualitative','numeric_calibrated')),
  scoring_config jsonb NOT NULL DEFAULT '{}',
  calibration_evidence_refs jsonb NOT NULL DEFAULT '[]',
  optimization_enabled boolean NOT NULL DEFAULT false,
  approved_by uuid,
  approved_at timestamptz,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,policy_key,version_no)
);
-- statement-breakpoint
CREATE TABLE advertising_archives (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  content_version_id uuid NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  channel_id varchar(60) NOT NULL,
  platform_account_id uuid,
  execution_action_id uuid NOT NULL,
  claim_ids uuid[] NOT NULL DEFAULT '{}',
  brand_authorization_ids uuid[] NOT NULL DEFAULT '{}',
  review_result_ref jsonb NOT NULL,
  submitted_at timestamptz,
  platform_receipt_ref jsonb,
  published_url text,
  snapshot_refs jsonb NOT NULL DEFAULT '[]',
  ai_generated boolean NOT NULL DEFAULT false,
  ai_label_requirement jsonb NOT NULL,
  ai_label_applied jsonb NOT NULL,
  ai_label_readback jsonb,
  ai_label_evidence_ref jsonb,
  ended_at timestamptz,
  retain_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (id),
  UNIQUE (org_id,id),
  UNIQUE (org_id,execution_action_id,content_version_id)
);
-- statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE memberships ADD CONSTRAINT memberships_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id);
-- statement-breakpoint
ALTER TABLE connections ADD CONSTRAINT connections_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE business_goals ADD CONSTRAINT business_goals_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE business_goals ADD CONSTRAINT business_goals_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE keywords ADD CONSTRAINT keywords_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE keywords ADD CONSTRAINT keywords_page_id_fk FOREIGN KEY (org_id,page_id) REFERENCES pages(org_id,id);
-- statement-breakpoint
CREATE INDEX keywords_idx_0 ON keywords (org_id,cluster_key,intent);
-- statement-breakpoint
ALTER TABLE plan_cycles ADD CONSTRAINT plan_cycles_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE plan_cycles ADD CONSTRAINT plan_cycles_generated_by_run_id_fk FOREIGN KEY (org_id,generated_by_run_id) REFERENCES workflow_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_plan_cycle_id_fk FOREIGN KEY (org_id,plan_cycle_id) REFERENCES plan_cycles(org_id,id);
-- statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
CREATE INDEX tasks_idx_0 ON tasks (org_id,status,due_at);
-- statement-breakpoint
ALTER TABLE experiments ADD CONSTRAINT experiments_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE experiments ADD CONSTRAINT experiments_task_id_fk FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id);
-- statement-breakpoint
ALTER TABLE source_documents ADD CONSTRAINT source_documents_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE source_documents ADD CONSTRAINT source_documents_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE source_documents ADD CONSTRAINT source_documents_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
ALTER TABLE source_documents ADD CONSTRAINT source_documents_current_version_id_fk FOREIGN KEY (org_id,current_version_id) REFERENCES source_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE source_versions ADD CONSTRAINT source_versions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE source_versions ADD CONSTRAINT source_versions_document_id_fk FOREIGN KEY (org_id,document_id) REFERENCES source_documents(org_id,id);
-- statement-breakpoint
CREATE INDEX source_versions_idx_0 ON source_versions (org_id,document_id,retrieved_at);
-- statement-breakpoint
CREATE INDEX source_versions_idx_1 ON source_versions (org_id,content_hash);
-- statement-breakpoint
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_source_version_id_fk FOREIGN KEY (org_id,source_version_id) REFERENCES source_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_verified_by_fk FOREIGN KEY (org_id,verified_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_supersedes_claim_id_fk FOREIGN KEY (org_id,supersedes_claim_id) REFERENCES evidence_claims(org_id,id);
-- statement-breakpoint
ALTER TABLE content_items ADD CONSTRAINT content_items_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE content_items ADD CONSTRAINT content_items_task_id_fk FOREIGN KEY (org_id,task_id) REFERENCES tasks(org_id,id);
-- statement-breakpoint
ALTER TABLE content_items ADD CONSTRAINT content_items_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE content_items ADD CONSTRAINT content_items_topic_id_fk FOREIGN KEY (org_id,topic_id) REFERENCES topics(org_id,id);
-- statement-breakpoint
CREATE INDEX content_items_idx_0 ON content_items (org_id,updated_at);
-- statement-breakpoint
ALTER TABLE content_versions ADD CONSTRAINT content_versions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE content_versions ADD CONSTRAINT content_versions_content_item_id_fk FOREIGN KEY (org_id,content_item_id) REFERENCES content_items(org_id,id);
-- statement-breakpoint
ALTER TABLE content_versions ADD CONSTRAINT content_versions_reviewed_by_fk FOREIGN KEY (org_id,reviewed_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE content_versions ADD CONSTRAINT content_versions_ai_run_id_fk FOREIGN KEY (org_id,ai_run_id) REFERENCES ai_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE pages ADD CONSTRAINT pages_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE pages ADD CONSTRAINT pages_content_item_id_fk FOREIGN KEY (org_id,content_item_id) REFERENCES content_items(org_id,id);
-- statement-breakpoint
ALTER TABLE pages ADD CONSTRAINT pages_primary_keyword_id_fk FOREIGN KEY (org_id,primary_keyword_id) REFERENCES keywords(org_id,id);
-- statement-breakpoint
ALTER TABLE pages ADD CONSTRAINT pages_published_release_id_fk FOREIGN KEY (org_id,published_release_id) REFERENCES releases(org_id,id);
-- statement-breakpoint
ALTER TABLE pages ADD CONSTRAINT pages_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE releases ADD CONSTRAINT releases_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE releases ADD CONSTRAINT releases_page_id_fk FOREIGN KEY (org_id,page_id) REFERENCES pages(org_id,id);
-- statement-breakpoint
ALTER TABLE releases ADD CONSTRAINT releases_content_version_id_fk FOREIGN KEY (org_id,content_version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE releases ADD CONSTRAINT releases_action_id_fk FOREIGN KEY (org_id,action_id) REFERENCES execution_actions(org_id,id);
-- statement-breakpoint
ALTER TABLE releases ADD CONSTRAINT releases_previous_release_id_fk FOREIGN KEY (org_id,previous_release_id) REFERENCES releases(org_id,id);
-- statement-breakpoint
ALTER TABLE releases ADD CONSTRAINT releases_rollback_of_id_fk FOREIGN KEY (org_id,rollback_of_id) REFERENCES releases(org_id,id);
-- statement-breakpoint
ALTER TABLE approvals ADD CONSTRAINT approvals_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE approvals ADD CONSTRAINT approvals_requested_by_fk FOREIGN KEY (org_id,requested_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE approvals ADD CONSTRAINT approvals_decided_by_fk FOREIGN KEY (org_id,decided_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE execution_actions ADD CONSTRAINT execution_actions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE execution_actions ADD CONSTRAINT execution_actions_approval_id_fk FOREIGN KEY (org_id,approval_id) REFERENCES approvals(org_id,id);
-- statement-breakpoint
ALTER TABLE execution_actions ADD CONSTRAINT execution_actions_policy_version_id_fk FOREIGN KEY (org_id,policy_version_id) REFERENCES policy_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE execution_actions ADD CONSTRAINT execution_actions_version_id_fk FOREIGN KEY (org_id,version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
CREATE INDEX execution_actions_idx_0 ON execution_actions (org_id,state,lease_until);
-- statement-breakpoint
CREATE INDEX execution_actions_idx_1 ON execution_actions (org_id,policy_version_id);
-- statement-breakpoint
ALTER TABLE action_attempts ADD CONSTRAINT action_attempts_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE action_attempts ADD CONSTRAINT action_attempts_action_id_fk FOREIGN KEY (org_id,action_id) REFERENCES execution_actions(org_id,id);
-- statement-breakpoint
ALTER TABLE ingestion_batches ADD CONSTRAINT ingestion_batches_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE ingestion_batches ADD CONSTRAINT ingestion_batches_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
ALTER TABLE ingestion_batches ADD CONSTRAINT ingestion_batches_complete_confirmed_by_fk FOREIGN KEY (org_id,complete_confirmed_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE ad_daily_facts ADD CONSTRAINT ad_daily_facts_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE ad_daily_facts ADD CONSTRAINT ad_daily_facts_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
ALTER TABLE ad_daily_facts ADD CONSTRAINT ad_daily_facts_ingestion_batch_id_fk FOREIGN KEY (org_id,ingestion_batch_id) REFERENCES ingestion_batches(org_id,id);
-- statement-breakpoint
CREATE INDEX ad_daily_facts_idx_0 ON ad_daily_facts (org_id,business_date,connection_id);
-- statement-breakpoint
ALTER TABLE web_events ADD CONSTRAINT web_events_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE web_events ADD CONSTRAINT web_events_page_id_fk FOREIGN KEY (org_id,page_id) REFERENCES pages(org_id,id);
-- statement-breakpoint
ALTER TABLE web_events ADD CONSTRAINT web_events_release_id_fk FOREIGN KEY (org_id,release_id) REFERENCES releases(org_id,id);
-- statement-breakpoint
CREATE INDEX web_events_idx_0 ON web_events (org_id,received_at,event_type);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_merged_into_id_fk FOREIGN KEY (org_id,merged_into_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_topic_id_fk FOREIGN KEY (org_id,topic_id) REFERENCES topics(org_id,id);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_contact_id_fk FOREIGN KEY (org_id,contact_id) REFERENCES lead_contacts(org_id,id);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_metric_policy_version_id_fk FOREIGN KEY (org_id,metric_policy_version_id) REFERENCES metric_policy_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE leads ADD CONSTRAINT leads_qualified_by_fk FOREIGN KEY (org_id,qualified_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
CREATE INDEX leads_idx_0 ON leads (org_id,owner_user_id,status,created_at);
-- statement-breakpoint
CREATE INDEX leads_idx_1 ON leads (org_id,contact_hmac);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_lead_id_fk FOREIGN KEY (org_id,lead_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_page_id_fk FOREIGN KEY (org_id,page_id) REFERENCES pages(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_release_id_fk FOREIGN KEY (org_id,release_id) REFERENCES releases(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_publish_job_id_fk FOREIGN KEY (org_id,publish_job_id) REFERENCES publish_jobs(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_contact_id_fk FOREIGN KEY (org_id,contact_id) REFERENCES lead_contacts(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_submissions ADD CONSTRAINT lead_submissions_capture_id_fk FOREIGN KEY (org_id,capture_id) REFERENCES contact_captures(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_status_events ADD CONSTRAINT lead_status_events_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE lead_status_events ADD CONSTRAINT lead_status_events_lead_id_fk FOREIGN KEY (org_id,lead_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE lead_status_events ADD CONSTRAINT lead_status_events_actor_id_fk FOREIGN KEY (org_id,actor_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE opportunities ADD CONSTRAINT opportunities_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE opportunities ADD CONSTRAINT opportunities_lead_id_fk FOREIGN KEY (org_id,lead_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE opportunities ADD CONSTRAINT opportunities_owner_user_id_fk FOREIGN KEY (org_id,owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE geo_questions ADD CONSTRAINT geo_questions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE geo_observations ADD CONSTRAINT geo_observations_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE geo_observations ADD CONSTRAINT geo_observations_question_id_fk FOREIGN KEY (org_id,question_id) REFERENCES geo_questions(org_id,id);
-- statement-breakpoint
ALTER TABLE geo_observations ADD CONSTRAINT geo_observations_reviewed_by_fk FOREIGN KEY (org_id,reviewed_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE workflow_steps ADD CONSTRAINT workflow_steps_run_id_fk FOREIGN KEY (org_id,run_id) REFERENCES workflow_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
CREATE INDEX outbox_events_idx_0 ON outbox_events (dispatched_at,next_attempt_at);
-- statement-breakpoint
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE ai_runs ADD CONSTRAINT ai_runs_workflow_run_id_fk FOREIGN KEY (org_id,workflow_run_id) REFERENCES workflow_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE report_snapshots ADD CONSTRAINT report_snapshots_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_report_id_fk FOREIGN KEY (org_id,report_id) REFERENCES report_snapshots(org_id,id);
-- statement-breakpoint
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE cost_ledger ADD CONSTRAINT cost_ledger_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE settings ADD CONSTRAINT settings_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE settings ADD CONSTRAINT settings_updated_by_fk FOREIGN KEY (org_id,updated_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE execution_policies ADD CONSTRAINT execution_policies_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE execution_policies ADD CONSTRAINT execution_policies_active_version_id_fk FOREIGN KEY (org_id,active_version_id) REFERENCES policy_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE execution_policies ADD CONSTRAINT execution_policies_created_by_fk FOREIGN KEY (org_id,created_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
CREATE INDEX execution_policies_idx_0 ON execution_policies (org_id,status);
-- statement-breakpoint
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_policy_id_fk FOREIGN KEY (org_id,policy_id) REFERENCES execution_policies(org_id,id);
-- statement-breakpoint
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_approved_by_fk FOREIGN KEY (org_id,approved_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE policy_versions ADD CONSTRAINT policy_versions_created_by_fk FOREIGN KEY (org_id,created_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE insights ADD CONSTRAINT insights_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE insights ADD CONSTRAINT insights_ai_run_id_fk FOREIGN KEY (org_id,ai_run_id) REFERENCES ai_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE insights ADD CONSTRAINT insights_metric_policy_version_id_fk FOREIGN KEY (org_id,metric_policy_version_id) REFERENCES metric_policy_versions(org_id,id);
-- statement-breakpoint
CREATE INDEX insights_idx_0 ON insights (org_id,state,data_cutoff);
-- statement-breakpoint
ALTER TABLE insight_evidence ADD CONSTRAINT insight_evidence_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE insight_evidence ADD CONSTRAINT insight_evidence_insight_id_fk FOREIGN KEY (org_id,insight_id) REFERENCES insights(org_id,id);
-- statement-breakpoint
ALTER TABLE insight_evidence ADD CONSTRAINT insight_evidence_claim_id_fk FOREIGN KEY (org_id,claim_id) REFERENCES evidence_claims(org_id,id);
-- statement-breakpoint
ALTER TABLE topics ADD CONSTRAINT topics_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE topics ADD CONSTRAINT topics_insight_id_fk FOREIGN KEY (org_id,insight_id) REFERENCES insights(org_id,id);
-- statement-breakpoint
ALTER TABLE topics ADD CONSTRAINT topics_plan_cycle_id_fk FOREIGN KEY (org_id,plan_cycle_id) REFERENCES plan_cycles(org_id,id);
-- statement-breakpoint
ALTER TABLE topics ADD CONSTRAINT topics_policy_version_id_fk FOREIGN KEY (org_id,policy_version_id) REFERENCES policy_versions(org_id,id);
-- statement-breakpoint
CREATE INDEX topics_idx_0 ON topics (org_id,state,scheduled_at);
-- statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE platform_accounts ADD CONSTRAINT platform_accounts_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
CREATE INDEX platform_accounts_idx_0 ON platform_accounts (org_id,enabled,session_status);
-- statement-breakpoint
ALTER TABLE platform_profiles ADD CONSTRAINT platform_profiles_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE platform_profiles ADD CONSTRAINT platform_profiles_platform_account_id_fk FOREIGN KEY (org_id,platform_account_id) REFERENCES platform_accounts(org_id,id);
-- statement-breakpoint
ALTER TABLE platform_profiles ADD CONSTRAINT platform_profiles_current_version_id_fk FOREIGN KEY (org_id,current_version_id) REFERENCES platform_profile_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE platform_profile_versions ADD CONSTRAINT platform_profile_versions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE platform_profile_versions ADD CONSTRAINT platform_profile_versions_profile_id_fk FOREIGN KEY (org_id,profile_id) REFERENCES platform_profiles(org_id,id);
-- statement-breakpoint
ALTER TABLE platform_profile_versions ADD CONSTRAINT platform_profile_versions_calibrated_by_fk FOREIGN KEY (org_id,calibrated_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE media_assets ADD CONSTRAINT media_assets_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE media_assets ADD CONSTRAINT media_assets_source_version_id_fk FOREIGN KEY (org_id,source_version_id) REFERENCES source_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE media_assets ADD CONSTRAINT media_assets_content_version_id_fk FOREIGN KEY (org_id,content_version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE media_assets ADD CONSTRAINT media_assets_brand_authorization_id_fk FOREIGN KEY (org_id,brand_authorization_id) REFERENCES brand_authorizations(org_id,id);
-- statement-breakpoint
CREATE INDEX media_assets_idx_0 ON media_assets (org_id,state);
-- statement-breakpoint
ALTER TABLE content_variants ADD CONSTRAINT content_variants_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE content_variants ADD CONSTRAINT content_variants_mother_content_version_id_fk FOREIGN KEY (org_id,mother_content_version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE content_variants ADD CONSTRAINT content_variants_content_version_id_fk FOREIGN KEY (org_id,content_version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE content_variants ADD CONSTRAINT content_variants_platform_account_id_fk FOREIGN KEY (org_id,platform_account_id) REFERENCES platform_accounts(org_id,id);
-- statement-breakpoint
ALTER TABLE content_variants ADD CONSTRAINT content_variants_platform_profile_version_id_fk FOREIGN KEY (org_id,platform_profile_version_id) REFERENCES platform_profile_versions(org_id,id);
-- statement-breakpoint
CREATE INDEX content_variants_idx_0 ON content_variants (org_id,platform_account_id,validation_status);
-- statement-breakpoint
ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_execution_action_id_fk FOREIGN KEY (org_id,execution_action_id) REFERENCES execution_actions(org_id,id);
-- statement-breakpoint
ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_platform_account_id_fk FOREIGN KEY (org_id,platform_account_id) REFERENCES platform_accounts(org_id,id);
-- statement-breakpoint
ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_content_variant_id_fk FOREIGN KEY (org_id,content_variant_id) REFERENCES content_variants(org_id,id);
-- statement-breakpoint
CREATE INDEX publish_jobs_idx_0 ON publish_jobs (org_id,delivery_state,scheduled_at);
-- statement-breakpoint
CREATE INDEX publish_jobs_idx_1 ON publish_jobs (org_id,next_attempt_at);
-- statement-breakpoint
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_platform_account_id_fk FOREIGN KEY (org_id,platform_account_id) REFERENCES platform_accounts(org_id,id);
-- statement-breakpoint
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_execution_action_id_fk FOREIGN KEY (org_id,execution_action_id) REFERENCES execution_actions(org_id,id);
-- statement-breakpoint
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_workflow_run_id_fk FOREIGN KEY (org_id,workflow_run_id) REFERENCES workflow_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE browser_commands ADD CONSTRAINT browser_commands_login_session_id_fk FOREIGN KEY (org_id,login_session_id) REFERENCES login_sessions(org_id,id);
-- statement-breakpoint
CREATE INDEX browser_commands_idx_0 ON browser_commands (org_id,state,next_attempt_at);
-- statement-breakpoint
CREATE INDEX browser_commands_idx_1 ON browser_commands (org_id,platform_account_id,state);
-- statement-breakpoint
ALTER TABLE login_sessions ADD CONSTRAINT login_sessions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE login_sessions ADD CONSTRAINT login_sessions_platform_account_id_fk FOREIGN KEY (org_id,platform_account_id) REFERENCES platform_accounts(org_id,id);
-- statement-breakpoint
ALTER TABLE login_sessions ADD CONSTRAINT login_sessions_user_id_fk FOREIGN KEY (org_id,user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE login_sessions ADD CONSTRAINT login_sessions_browser_command_id_fk FOREIGN KEY (org_id,browser_command_id) REFERENCES browser_commands(org_id,id);
-- statement-breakpoint
CREATE INDEX login_sessions_idx_0 ON login_sessions (org_id,platform_account_id,state);
-- statement-breakpoint
CREATE INDEX login_sessions_idx_1 ON login_sessions (org_id,expires_at);
-- statement-breakpoint
ALTER TABLE business_master_versions ADD CONSTRAINT business_master_versions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE business_master_versions ADD CONSTRAINT business_master_versions_source_version_id_fk FOREIGN KEY (org_id,source_version_id) REFERENCES source_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE business_master_versions ADD CONSTRAINT business_master_versions_supersedes_id_fk FOREIGN KEY (org_id,supersedes_id) REFERENCES business_master_versions(org_id,id);
-- statement-breakpoint
CREATE INDEX business_master_versions_idx_0 ON business_master_versions (org_id,category,status);
-- statement-breakpoint
ALTER TABLE brand_authorizations ADD CONSTRAINT brand_authorizations_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE brand_authorizations ADD CONSTRAINT brand_authorizations_source_version_id_fk FOREIGN KEY (org_id,source_version_id) REFERENCES source_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE brand_authorizations ADD CONSTRAINT brand_authorizations_confirmed_by_fk FOREIGN KEY (org_id,confirmed_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE lead_contacts ADD CONSTRAINT lead_contacts_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
CREATE INDEX lead_contacts_idx_0 ON lead_contacts (org_id,normalized_contact_hmac);
-- statement-breakpoint
CREATE INDEX lead_contacts_idx_1 ON lead_contacts (org_id,retention_until);
-- statement-breakpoint
ALTER TABLE contact_captures ADD CONSTRAINT contact_captures_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE contact_captures ADD CONSTRAINT contact_captures_contact_id_fk FOREIGN KEY (org_id,contact_id) REFERENCES lead_contacts(org_id,id);
-- statement-breakpoint
ALTER TABLE contact_captures ADD CONSTRAINT contact_captures_lead_id_fk FOREIGN KEY (org_id,lead_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE contact_captures ADD CONSTRAINT contact_captures_conversation_id_fk FOREIGN KEY (org_id,conversation_id) REFERENCES reception_conversations(org_id,id);
-- statement-breakpoint
ALTER TABLE contact_captures ADD CONSTRAINT contact_captures_submission_id_fk FOREIGN KEY (org_id,submission_id) REFERENCES lead_submissions(org_id,id);
-- statement-breakpoint
CREATE INDEX contact_captures_idx_0 ON contact_captures (org_id,contact_id,captured_at);
-- statement-breakpoint
ALTER TABLE reception_conversations ADD CONSTRAINT reception_conversations_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE reception_conversations ADD CONSTRAINT reception_conversations_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
ALTER TABLE reception_conversations ADD CONSTRAINT reception_conversations_contact_id_fk FOREIGN KEY (org_id,contact_id) REFERENCES lead_contacts(org_id,id);
-- statement-breakpoint
ALTER TABLE reception_conversations ADD CONSTRAINT reception_conversations_lead_id_fk FOREIGN KEY (org_id,lead_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE reception_conversations ADD CONSTRAINT reception_conversations_handoff_owner_user_id_fk FOREIGN KEY (org_id,handoff_owner_user_id) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE reception_conversations ADD CONSTRAINT reception_conversations_policy_version_id_fk FOREIGN KEY (org_id,policy_version_id) REFERENCES policy_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE reception_messages ADD CONSTRAINT reception_messages_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE reception_messages ADD CONSTRAINT reception_messages_conversation_id_fk FOREIGN KEY (org_id,conversation_id) REFERENCES reception_conversations(org_id,id);
-- statement-breakpoint
ALTER TABLE reception_messages ADD CONSTRAINT reception_messages_ai_run_id_fk FOREIGN KEY (org_id,ai_run_id) REFERENCES ai_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE reception_messages ADD CONSTRAINT reception_messages_execution_action_id_fk FOREIGN KEY (org_id,execution_action_id) REFERENCES execution_actions(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_contact_id_fk FOREIGN KEY (org_id,contact_id) REFERENCES lead_contacts(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_lead_id_fk FOREIGN KEY (org_id,lead_id) REFERENCES leads(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_capture_id_fk FOREIGN KEY (org_id,capture_id) REFERENCES contact_captures(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_conversation_id_fk FOREIGN KEY (org_id,conversation_id) REFERENCES reception_conversations(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_connection_id_fk FOREIGN KEY (org_id,connection_id) REFERENCES connections(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_content_item_id_fk FOREIGN KEY (org_id,content_item_id) REFERENCES content_items(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_page_id_fk FOREIGN KEY (org_id,page_id) REFERENCES pages(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_publish_job_id_fk FOREIGN KEY (org_id,publish_job_id) REFERENCES publish_jobs(org_id,id);
-- statement-breakpoint
ALTER TABLE attribution_touches ADD CONSTRAINT attribution_touches_metric_policy_version_id_fk FOREIGN KEY (org_id,metric_policy_version_id) REFERENCES metric_policy_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE metric_policy_versions ADD CONSTRAINT metric_policy_versions_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE metric_policy_versions ADD CONSTRAINT metric_policy_versions_approved_by_fk FOREIGN KEY (org_id,approved_by) REFERENCES memberships(org_id,user_id);
-- statement-breakpoint
ALTER TABLE advertising_archives ADD CONSTRAINT advertising_archives_org_id_fk FOREIGN KEY (org_id) REFERENCES organizations(id);
-- statement-breakpoint
ALTER TABLE advertising_archives ADD CONSTRAINT advertising_archives_content_version_id_fk FOREIGN KEY (org_id,content_version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
ALTER TABLE advertising_archives ADD CONSTRAINT advertising_archives_platform_account_id_fk FOREIGN KEY (org_id,platform_account_id) REFERENCES platform_accounts(org_id,id);
-- statement-breakpoint
ALTER TABLE advertising_archives ADD CONSTRAINT advertising_archives_execution_action_id_fk FOREIGN KEY (org_id,execution_action_id) REFERENCES execution_actions(org_id,id);
-- statement-breakpoint
ALTER TABLE policy_versions ADD UNIQUE (org_id,policy_id,id);
-- statement-breakpoint
ALTER TABLE execution_policies ADD FOREIGN KEY (org_id,id,active_version_id) REFERENCES policy_versions(org_id,policy_id,id);
-- statement-breakpoint
ALTER TABLE source_versions ADD UNIQUE (org_id,document_id,id);
-- statement-breakpoint
ALTER TABLE source_documents ADD FOREIGN KEY (org_id,id,current_version_id) REFERENCES source_versions(org_id,document_id,id);
-- statement-breakpoint
ALTER TABLE platform_profile_versions ADD UNIQUE (org_id,profile_id,id);
-- statement-breakpoint
ALTER TABLE platform_profiles ADD FOREIGN KEY (org_id,id,current_version_id) REFERENCES platform_profile_versions(org_id,profile_id,id);
-- statement-breakpoint
ALTER TABLE releases ADD UNIQUE (org_id,page_id,id);
-- statement-breakpoint
ALTER TABLE pages ADD FOREIGN KEY (org_id,id,published_release_id) REFERENCES releases(org_id,page_id,id);
-- statement-breakpoint
CREATE FUNCTION check_org_uuid_array() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; found integer;
BEGIN
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO ids USING NEW;
  IF ids IS NULL OR cardinality(ids)=0 THEN RETURN NEW; END IF;
  EXECUTE format('SELECT count(*) FROM %I WHERE org_id=$1 AND id=ANY($2)', TG_ARGV[1]) INTO found USING NEW.org_id, ids;
  IF found <> (SELECT count(DISTINCT v) FROM unnest(ids) AS v) THEN RAISE EXCEPTION 'Cross-organization or missing array reference: %.%', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE='23503'; END IF;
  RETURN NEW;
END;
$$;
-- statement-breakpoint
CREATE TRIGGER policy_versions_account_ids_org BEFORE INSERT OR UPDATE OF account_ids,org_id ON policy_versions FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('account_ids','platform_accounts');
-- statement-breakpoint
CREATE TRIGGER content_versions_claim_ids_org BEFORE INSERT OR UPDATE OF claim_ids,org_id ON content_versions FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('claim_ids','evidence_claims');
-- statement-breakpoint
CREATE TRIGGER topics_keyword_ids_org BEFORE INSERT OR UPDATE OF keyword_ids,org_id ON topics FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('keyword_ids','keywords');
-- statement-breakpoint
CREATE TRIGGER topics_claim_ids_org BEFORE INSERT OR UPDATE OF claim_ids,org_id ON topics FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('claim_ids','evidence_claims');
-- statement-breakpoint
CREATE TRIGGER plan_cycles_goal_ids_org BEFORE INSERT OR UPDATE OF goal_ids,org_id ON plan_cycles FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('goal_ids','business_goals');
-- statement-breakpoint
CREATE TRIGGER content_variants_asset_ids_org BEFORE INSERT OR UPDATE OF asset_ids,org_id ON content_variants FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('asset_ids','media_assets');
-- statement-breakpoint
CREATE TRIGGER report_snapshots_source_batch_ids_org BEFORE INSERT OR UPDATE OF source_batch_ids,org_id ON report_snapshots FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('source_batch_ids','ingestion_batches');
-- statement-breakpoint
CREATE TRIGGER ai_runs_source_ids_org BEFORE INSERT OR UPDATE OF source_ids,org_id ON ai_runs FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('source_ids','source_versions');
-- statement-breakpoint
CREATE TRIGGER advertising_archives_claim_ids_org BEFORE INSERT OR UPDATE OF claim_ids,org_id ON advertising_archives FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('claim_ids','evidence_claims');
-- statement-breakpoint
CREATE TRIGGER advertising_archives_brand_authorization_ids_org BEFORE INSERT OR UPDATE OF brand_authorization_ids,org_id ON advertising_archives FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('brand_authorization_ids','brand_authorizations');
-- statement-breakpoint
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE='23514'; END;
$$;
-- statement-breakpoint
CREATE TRIGGER releases_immutable BEFORE UPDATE OR DELETE ON releases FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE TRIGGER action_attempts_immutable BEFORE UPDATE OR DELETE ON action_attempts FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE TRIGGER lead_status_events_immutable BEFORE UPDATE OR DELETE ON lead_status_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE TRIGGER insight_evidence_immutable BEFORE UPDATE OR DELETE ON insight_evidence FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE TRIGGER business_master_versions_immutable BEFORE UPDATE OR DELETE ON business_master_versions FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE TRIGGER attribution_touches_immutable BEFORE UPDATE OR DELETE ON attribution_touches FOR EACH ROW EXECUTE FUNCTION immutable_row();
-- statement-breakpoint
CREATE FUNCTION immutable_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION '% payload cannot be deleted', TG_TABLE_NAME USING ERRCODE='23514'; END IF;
  FOREACH field IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(NEW)->field) IS DISTINCT FROM (to_jsonb(OLD)->field) THEN RAISE EXCEPTION 'Immutable field %.%', TG_TABLE_NAME, field USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
-- statement-breakpoint
CREATE TRIGGER execution_actions_payload_immutable BEFORE UPDATE OR DELETE ON execution_actions FOR EACH ROW EXECUTE FUNCTION immutable_payload('org_id','action_type','target','version_id','payload','payload_hash','request_hash','policy_version_id','approval_id','idempotency_key');
-- statement-breakpoint
CREATE TRIGGER content_versions_payload_immutable BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION immutable_payload('org_id','content_item_id','version_no','body_json','claim_ids','payload_hash');
-- statement-breakpoint
CREATE TRIGGER source_versions_payload_immutable BEFORE UPDATE OR DELETE ON source_versions FOR EACH ROW EXECUTE FUNCTION immutable_payload('org_id','document_id','revision','content_hash','object_key');
-- statement-breakpoint
CREATE TRIGGER policy_versions_payload_immutable BEFORE UPDATE OR DELETE ON policy_versions FOR EACH ROW EXECUTE FUNCTION immutable_payload('org_id','policy_id','version_no','business_scope','account_ids','allowed_actions','currency','daily_budget_minor','total_budget_minor','max_bid_change_pct','publish_frequency','publish_windows','stop_conditions','valid_from','valid_until','payload_hash','created_by','allowed_ad_operations','allowed_ad_entity_levels','approved_path_prefixes','reception_scope');
-- statement-breakpoint
CREATE TRIGGER report_snapshots_payload_immutable BEFORE UPDATE OR DELETE ON report_snapshots FOR EACH ROW EXECUTE FUNCTION immutable_payload('org_id','kind','period_start','period_end','revision','metric_version','source_batch_ids','query_hash','data_cutoff','quality','metrics_json','body_json');
-- statement-breakpoint
CREATE TRIGGER lead_submissions_payload_immutable BEFORE UPDATE OR DELETE ON lead_submissions FOR EACH ROW EXECUTE FUNCTION immutable_payload('org_id','submission_id','request_hash','page_id','release_id','channel','privacy_notice_version','consent','attribution','received_at','test_record');
-- statement-breakpoint
CREATE FUNCTION policy_approval_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.approved_by IS NOT NULL AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN RAISE EXCEPTION 'Policy approval is immutable'; END IF;
 IF NEW.approved_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM memberships WHERE org_id=NEW.org_id AND user_id=NEW.approved_by AND active AND 'owner'=ANY(roles)) THEN RAISE EXCEPTION 'Policy approval requires active owner'; END IF;
 RETURN NEW;
END; $$;
-- statement-breakpoint
CREATE TRIGGER policy_approval_guard BEFORE INSERT OR UPDATE ON policy_versions FOR EACH ROW EXECUTE FUNCTION policy_approval_once();
-- statement-breakpoint
CREATE INDEX workflow_steps_claim_idx ON workflow_steps (state,lease_until,created_at);
-- statement-breakpoint
CREATE INDEX outbox_claim_idx ON outbox_events (dispatched_at,next_attempt_at);
