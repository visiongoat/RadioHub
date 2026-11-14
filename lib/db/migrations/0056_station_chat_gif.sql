-- Provider references only; clients never submit arbitrary remote media URLs.
ALTER TABLE station_chat_messages ADD COLUMN message_type text NOT NULL DEFAULT 'text' CHECK(message_type IN ('text','gif'));
ALTER TABLE station_chat_messages ADD CONSTRAINT station_chat_gif_reference CHECK(message_type<>'gif' OR deleted_at IS NOT NULL OR content ~ '^klipy:[a-zA-Z0-9_-]{1,200}$');
