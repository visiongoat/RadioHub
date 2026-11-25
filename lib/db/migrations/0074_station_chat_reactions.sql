ALTER TABLE station_chat_messages
  ADD COLUMN reactions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN reactions_revision bigint NOT NULL DEFAULT 0;
