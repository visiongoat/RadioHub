CREATE TABLE IF NOT EXISTS chat_view_once_media (
 id text PRIMARY KEY,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 file_name text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 kind text CHECK(kind IN ('direct','group')),
 target_id text,
 message_id text,
 recipients text[] NOT NULL DEFAULT '{}',
 opened_by text[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_view_once_expiry ON chat_view_once_media(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS chat_view_once_message ON chat_view_once_media(message_id) WHERE message_id IS NOT NULL;
