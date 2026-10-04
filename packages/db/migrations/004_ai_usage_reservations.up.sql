CREATE TABLE ai_usage_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES organizations(id),
 provider varchar(40) NOT NULL,
 day_key date NOT NULL,
 minute_key varchar(16) NOT NULL CHECK (minute_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$' AND substring(minute_key,1,10)=day_key::text),
 state varchar(20) NOT NULL CHECK (state IN ('reserved','received','rejected','unknown')),
 reserved_cost_micro bigint CHECK (reserved_cost_micro >= 0),
 actual_cost_micro bigint CHECK (actual_cost_micro >= 0),
 currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
 pricing_version text CHECK (length(pricing_version) BETWEEN 1 AND 200),
 usage_json jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 UNIQUE(org_id,id),
 CHECK (reserved_cost_micro IS NULL OR currency IS NOT NULL AND pricing_version IS NOT NULL),
 CHECK (state NOT IN ('reserved','unknown') OR actual_cost_micro IS NULL),
 CHECK (state <> 'rejected' OR actual_cost_micro IS NOT NULL AND actual_cost_micro = 0),
 CHECK (state <> 'reserved' OR settled_at IS NULL)
);
-- statement-breakpoint
CREATE INDEX ai_usage_reservations_daily ON ai_usage_reservations(org_id,provider,day_key,minute_key);
