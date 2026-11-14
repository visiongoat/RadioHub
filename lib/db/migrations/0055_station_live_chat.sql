-- Live rooms exist by station identity; only connected viewers acquire leases.
CREATE TABLE station_chat_messages (
 id text PRIMARY KEY, station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id uuid NOT NULL, content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 400),
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 UNIQUE(user_id,client_id)
);
CREATE INDEX station_chat_messages_room ON station_chat_messages(station_id,created_at DESC,id DESC);
CREATE INDEX station_chat_messages_retention ON station_chat_messages(created_at);
CREATE INDEX station_chat_messages_sender ON station_chat_messages(user_id,created_at DESC);
CREATE TABLE station_chat_sessions (
 token_hash text PRIMARY KEY, station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
 user_id text REFERENCES users(id) ON DELETE CASCADE, identity_id text NOT NULL,
 connected boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL DEFAULT now()+interval '60 seconds'
);
CREATE INDEX station_chat_sessions_presence ON station_chat_sessions(station_id,expires_at) WHERE connected;
CREATE INDEX station_chat_sessions_expiry ON station_chat_sessions(expires_at);
CREATE TABLE station_chat_blocks (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,blocked_user_id),CHECK(user_id<>blocked_user_id)
);
CREATE TABLE station_chat_reports (
 id text PRIMARY KEY, station_id text NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
 message_id text REFERENCES station_chat_messages(id) ON DELETE SET NULL,
 reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reported_user_id text REFERENCES users(id) ON DELETE SET NULL,
 content_snapshot text NOT NULL, reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(message_id,reporter_id)
);
CREATE INDEX station_chat_reports_pending ON station_chat_reports(status,created_at DESC);
CREATE TABLE station_chat_sanctions (
 user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, reason text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
