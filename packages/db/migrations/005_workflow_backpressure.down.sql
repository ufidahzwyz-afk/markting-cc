DROP INDEX workflow_steps_ready_next_attempt;
-- statement-breakpoint
ALTER TABLE workflow_steps DROP COLUMN next_attempt_at;
