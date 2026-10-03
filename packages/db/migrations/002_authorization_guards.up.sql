ALTER TABLE approvals ADD CONSTRAINT approvals_version_id_org_fk FOREIGN KEY (org_id,version_id) REFERENCES content_versions(org_id,id);
-- statement-breakpoint
CREATE FUNCTION require_approved_active_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='active' AND NOT EXISTS (
    SELECT 1 FROM policy_versions v JOIN memberships m ON m.org_id=v.org_id AND m.user_id=v.approved_by JOIN users u ON u.id=m.user_id
    WHERE v.org_id=NEW.org_id AND v.policy_id=NEW.id AND v.id=NEW.active_version_id AND v.approved_at IS NOT NULL AND m.active AND u.active AND 'owner'=ANY(m.roles)
  ) THEN RAISE EXCEPTION 'Active policy requires approved version and active owner' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
-- statement-breakpoint
CREATE TRIGGER execution_policies_active_approval BEFORE INSERT OR UPDATE OF status,active_version_id ON execution_policies FOR EACH ROW EXECUTE FUNCTION require_approved_active_policy();
