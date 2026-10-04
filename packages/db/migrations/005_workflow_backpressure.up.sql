ALTER TABLE workflow_steps ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
-- statement-breakpoint
CREATE INDEX workflow_steps_ready_next_attempt ON workflow_steps(org_id,execution_mode,next_attempt_at,created_at) WHERE state='queued' AND NOT external_write;
