-- Append-only upgrade. Existing manual and mock records retain their identity and mode.
ALTER TABLE source_versions ADD COLUMN text_hash char(64) CHECK (text_hash IS NULL OR text_hash ~ '^[0-9a-f]{64}$'), ADD COLUMN execution_mode varchar(10) CHECK (execution_mode IN ('mock','live'));
-- statement-breakpoint
CREATE TRIGGER source_versions_text_immutable BEFORE UPDATE OR DELETE ON source_versions FOR EACH ROW EXECUTE FUNCTION immutable_payload('text_object_key','text_hash','execution_mode','coverage_json','mime_type','source_modified_at','visibility');
-- statement-breakpoint
ALTER TABLE ai_runs ADD COLUMN workflow_kind varchar(60), ADD COLUMN execution_mode varchar(10) CHECK (execution_mode IN ('mock','live')), ADD COLUMN idempotency_key char(64), ADD COLUMN request_metadata jsonb NOT NULL DEFAULT '{}';
-- statement-breakpoint
CREATE UNIQUE INDEX ai_runs_pipeline_idempotency ON ai_runs(org_id,execution_mode,workflow_kind,idempotency_key) WHERE idempotency_key IS NOT NULL;
-- statement-breakpoint
ALTER TABLE evidence_claims ADD COLUMN ai_run_id uuid, ADD COLUMN proposal_key text, ADD COLUMN execution_mode varchar(10) CHECK (execution_mode IN ('mock','live')), ADD CONSTRAINT evidence_claims_ai_run_fk FOREIGN KEY(org_id,ai_run_id) REFERENCES ai_runs(org_id,id), ADD CONSTRAINT evidence_claims_ai_proposal_unique UNIQUE(org_id,ai_run_id,proposal_key);
-- statement-breakpoint
ALTER TABLE insights ADD COLUMN execution_mode varchar(10) CHECK (execution_mode IN ('mock','live')), ADD COLUMN gaps_json jsonb NOT NULL DEFAULT '[]', ADD COLUMN proposal_key text;
-- statement-breakpoint
ALTER TABLE topics ADD COLUMN execution_mode varchar(10) CHECK (execution_mode IN ('mock','live')), ADD COLUMN ai_run_id uuid, ADD COLUMN gaps_json jsonb NOT NULL DEFAULT '[]', ADD COLUMN priority_reason text, ADD COLUMN proposal_key text, ADD CONSTRAINT topics_ai_run_fk FOREIGN KEY(org_id,ai_run_id) REFERENCES ai_runs(org_id,id);
-- statement-breakpoint
ALTER TABLE content_items ADD COLUMN execution_mode varchar(10) CHECK (execution_mode IN ('mock','live')), ADD COLUMN generation_key char(64);
-- statement-breakpoint
CREATE UNIQUE INDEX content_items_pipeline_generation ON content_items(org_id,execution_mode,generation_key) WHERE generation_key IS NOT NULL;
-- statement-breakpoint
ALTER TABLE content_versions ADD COLUMN draft_state varchar(30) CHECK (draft_state IN ('private_candidate')), ADD COLUMN source_version_ids uuid[] NOT NULL DEFAULT '{}', ADD COLUMN generation_key char(64);
-- statement-breakpoint
CREATE UNIQUE INDEX content_versions_pipeline_generation ON content_versions(org_id,generation_key) WHERE generation_key IS NOT NULL;
-- statement-breakpoint
CREATE TRIGGER content_versions_source_ids_org BEFORE INSERT OR UPDATE OF source_version_ids,org_id ON content_versions FOR EACH ROW EXECUTE FUNCTION check_org_uuid_array('source_version_ids','source_versions');
-- statement-breakpoint
CREATE TRIGGER content_versions_candidate_immutable BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION immutable_payload('draft_state','source_version_ids','generation_key','ai_run_id');
-- statement-breakpoint
CREATE FUNCTION private_candidate_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.draft_state='private_candidate' AND NEW.review_status='approved' THEN RAISE EXCEPTION 'Private candidate must be converted to independently validated public content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
-- statement-breakpoint
CREATE TRIGGER private_candidate_review_guard BEFORE INSERT OR UPDATE ON content_versions FOR EACH ROW EXECUTE FUNCTION private_candidate_review_guard();
