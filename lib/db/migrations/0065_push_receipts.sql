-- Provider handoff status only; no message contents or raw push tokens.
CREATE TABLE IF NOT EXISTS push_receipts (
 ticket_id text PRIMARY KEY,
 push_token_id text REFERENCES push_tokens(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','provider_accepted','error','expired')),
 error_code text,
 attempts integer NOT NULL DEFAULT 0,
 next_check_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_receipts_pending ON push_receipts(next_check_at) WHERE state='pending';
CREATE INDEX IF NOT EXISTS push_receipts_created ON push_receipts(created_at);
