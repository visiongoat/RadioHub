-- Keep provider references separate from validated user captions; one atomic message.
ALTER TABLE station_chat_messages ADD COLUMN caption text NOT NULL DEFAULT ''
  CHECK (char_length(caption)<=400 AND (caption='' OR message_type='gif'));
