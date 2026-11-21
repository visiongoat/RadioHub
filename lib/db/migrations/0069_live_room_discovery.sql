-- Public Home snippets are promoted only after an independent fail-closed review.
CREATE TABLE IF NOT EXISTS station_chat_home_previews (
 message_id text PRIMARY KEY REFERENCES station_chat_messages(id) ON DELETE CASCADE,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 display_name text NOT NULL, reviewed_content text NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS station_chat_home_approved ON station_chat_home_previews(message_id) WHERE decision='approved';
CREATE INDEX IF NOT EXISTS station_chat_sessions_active_home ON station_chat_sessions(expires_at,station_id,identity_id) WHERE connected;
