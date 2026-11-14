CREATE TABLE direct_chat_blocks (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,blocked_user_id),CHECK(user_id<>blocked_user_id)
);
CREATE INDEX direct_chat_blocks_reverse ON direct_chat_blocks(blocked_user_id,user_id);
CREATE TABLE direct_chat_reports (
 id text PRIMARY KEY, reporter_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reported_user_id text REFERENCES users(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK(reason IN ('harassment','spam','other')),
 message_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX direct_chat_reports_pending ON direct_chat_reports(status,created_at DESC);
