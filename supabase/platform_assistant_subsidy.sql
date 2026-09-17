-- Platform admin can temporarily share their own BYOK with other users
-- for the in-browser AI Assistant only. Silicon Samples never uses this table.
-- Additive and idempotent. Worker/service-role access only; no browser policies.

CREATE TABLE IF NOT EXISTS public.platform_assistant_subsidy (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled         BOOLEAN NOT NULL DEFAULT false,
  expires_at      TIMESTAMPTZ,
  donor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  allowed_routes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.platform_assistant_subsidy (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_assistant_subsidy ENABLE ROW LEVEL SECURITY;
