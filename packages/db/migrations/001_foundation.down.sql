-- Explicit destructive rollback: back up first.
DROP TABLE advertising_archives CASCADE;
-- statement-breakpoint
DROP TABLE metric_policy_versions CASCADE;
-- statement-breakpoint
DROP TABLE attribution_touches CASCADE;
-- statement-breakpoint
DROP TABLE reception_messages CASCADE;
-- statement-breakpoint
DROP TABLE reception_conversations CASCADE;
-- statement-breakpoint
DROP TABLE contact_captures CASCADE;
-- statement-breakpoint
DROP TABLE lead_contacts CASCADE;
-- statement-breakpoint
DROP TABLE brand_authorizations CASCADE;
-- statement-breakpoint
DROP TABLE business_master_versions CASCADE;
-- statement-breakpoint
DROP TABLE login_sessions CASCADE;
-- statement-breakpoint
DROP TABLE browser_commands CASCADE;
-- statement-breakpoint
DROP TABLE publish_jobs CASCADE;
-- statement-breakpoint
DROP TABLE content_variants CASCADE;
-- statement-breakpoint
DROP TABLE media_assets CASCADE;
-- statement-breakpoint
DROP TABLE platform_profile_versions CASCADE;
-- statement-breakpoint
DROP TABLE platform_profiles CASCADE;
-- statement-breakpoint
DROP TABLE platform_accounts CASCADE;
-- statement-breakpoint
DROP TABLE topics CASCADE;
-- statement-breakpoint
DROP TABLE insight_evidence CASCADE;
-- statement-breakpoint
DROP TABLE insights CASCADE;
-- statement-breakpoint
DROP TABLE policy_versions CASCADE;
-- statement-breakpoint
DROP TABLE execution_policies CASCADE;
-- statement-breakpoint
DROP TABLE idempotency_records CASCADE;
-- statement-breakpoint
DROP TABLE settings CASCADE;
-- statement-breakpoint
DROP TABLE cost_ledger CASCADE;
-- statement-breakpoint
DROP TABLE audit_logs CASCADE;
-- statement-breakpoint
DROP TABLE notifications CASCADE;
-- statement-breakpoint
DROP TABLE report_snapshots CASCADE;
-- statement-breakpoint
DROP TABLE ai_runs CASCADE;
-- statement-breakpoint
DROP TABLE outbox_events CASCADE;
-- statement-breakpoint
DROP TABLE workflow_steps CASCADE;
-- statement-breakpoint
DROP TABLE workflow_runs CASCADE;
-- statement-breakpoint
DROP TABLE geo_observations CASCADE;
-- statement-breakpoint
DROP TABLE geo_questions CASCADE;
-- statement-breakpoint
DROP TABLE opportunities CASCADE;
-- statement-breakpoint
DROP TABLE lead_status_events CASCADE;
-- statement-breakpoint
DROP TABLE lead_submissions CASCADE;
-- statement-breakpoint
DROP TABLE leads CASCADE;
-- statement-breakpoint
DROP TABLE web_events CASCADE;
-- statement-breakpoint
DROP TABLE ad_daily_facts CASCADE;
-- statement-breakpoint
DROP TABLE ingestion_batches CASCADE;
-- statement-breakpoint
DROP TABLE action_attempts CASCADE;
-- statement-breakpoint
DROP TABLE execution_actions CASCADE;
-- statement-breakpoint
DROP TABLE approvals CASCADE;
-- statement-breakpoint
DROP TABLE releases CASCADE;
-- statement-breakpoint
DROP TABLE pages CASCADE;
-- statement-breakpoint
DROP TABLE content_versions CASCADE;
-- statement-breakpoint
DROP TABLE content_items CASCADE;
-- statement-breakpoint
DROP TABLE evidence_claims CASCADE;
-- statement-breakpoint
DROP TABLE source_versions CASCADE;
-- statement-breakpoint
DROP TABLE source_documents CASCADE;
-- statement-breakpoint
DROP TABLE experiments CASCADE;
-- statement-breakpoint
DROP TABLE tasks CASCADE;
-- statement-breakpoint
DROP TABLE plan_cycles CASCADE;
-- statement-breakpoint
DROP TABLE keywords CASCADE;
-- statement-breakpoint
DROP TABLE business_goals CASCADE;
-- statement-breakpoint
DROP TABLE connections CASCADE;
-- statement-breakpoint
DROP TABLE memberships CASCADE;
-- statement-breakpoint
DROP TABLE users CASCADE;
-- statement-breakpoint
DROP TABLE organizations CASCADE;
-- statement-breakpoint
DROP FUNCTION policy_approval_once();
-- statement-breakpoint
DROP FUNCTION immutable_payload();
-- statement-breakpoint
DROP FUNCTION immutable_row();
-- statement-breakpoint
DROP FUNCTION check_org_uuid_array();
