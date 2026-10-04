DROP TRIGGER private_candidate_review_guard ON content_versions;
-- statement-breakpoint
DROP FUNCTION private_candidate_review_guard();
-- statement-breakpoint
DROP TRIGGER content_versions_candidate_immutable ON content_versions;
-- statement-breakpoint
DROP TRIGGER content_versions_source_ids_org ON content_versions;
-- statement-breakpoint
DROP INDEX content_versions_pipeline_generation;
-- statement-breakpoint
ALTER TABLE content_versions DROP COLUMN draft_state, DROP COLUMN source_version_ids, DROP COLUMN generation_key;
-- statement-breakpoint
DROP INDEX content_items_pipeline_generation;
-- statement-breakpoint
ALTER TABLE content_items DROP COLUMN execution_mode, DROP COLUMN generation_key;
-- statement-breakpoint
ALTER TABLE topics DROP CONSTRAINT topics_ai_run_fk, DROP COLUMN execution_mode, DROP COLUMN ai_run_id, DROP COLUMN gaps_json, DROP COLUMN priority_reason, DROP COLUMN proposal_key;
-- statement-breakpoint
ALTER TABLE insights DROP COLUMN execution_mode, DROP COLUMN gaps_json, DROP COLUMN proposal_key;
-- statement-breakpoint
ALTER TABLE evidence_claims DROP CONSTRAINT evidence_claims_ai_run_fk, DROP CONSTRAINT evidence_claims_ai_proposal_unique, DROP COLUMN ai_run_id, DROP COLUMN proposal_key, DROP COLUMN execution_mode;
-- statement-breakpoint
DROP INDEX ai_runs_pipeline_idempotency;
-- statement-breakpoint
ALTER TABLE ai_runs DROP COLUMN workflow_kind, DROP COLUMN execution_mode, DROP COLUMN idempotency_key, DROP COLUMN request_metadata;
-- statement-breakpoint
DROP TRIGGER source_versions_text_immutable ON source_versions;
-- statement-breakpoint
ALTER TABLE source_versions DROP COLUMN text_hash, DROP COLUMN execution_mode;
