-- One current emoji per user is replaced atomically under the message row lock.
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS reactions_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE chat_group_messages ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE chat_group_messages ADD COLUMN IF NOT EXISTS reactions_revision bigint NOT NULL DEFAULT 0;
