DROP TRIGGER execution_policies_active_approval ON execution_policies;
-- statement-breakpoint
DROP FUNCTION require_approved_active_policy();
-- statement-breakpoint
ALTER TABLE approvals DROP CONSTRAINT approvals_version_id_org_fk;
