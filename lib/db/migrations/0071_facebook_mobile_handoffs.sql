-- One-use, browser-session-bound state shared by all API replicas.
CREATE TABLE facebook_oauth_states (
  state_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX facebook_oauth_states_expiry ON facebook_oauth_states(expires_at);

-- Short-lived mobile browser handoffs. No access tokens or raw codes are stored.
CREATE TABLE oauth_mobile_handoffs (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_mobile_handoffs_expiry ON oauth_mobile_handoffs(expires_at);
