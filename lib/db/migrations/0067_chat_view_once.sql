CREATE TABLE IF NOT EXISTS chat_view_once_media (
 id text PRIMARY KEY,
 owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 file_name text NOT NULL,
 photo_bytes bytea CHECK(photo_bytes IS NULL OR octet_length(photo_bytes)<=2097152),
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

-- Existing pending invitations must also be reachable in the bell inbox after upgrade.
-- Deterministic identifiers and the payload check keep migration/recovery idempotent.
INSERT INTO user_notifications(id,user_id,from_user_id,type,title,message,data,is_read,created_at)
SELECT substr(md5('group-invite:'||g.id||':'||m.user_id),1,24),m.user_id,g.created_by,
 'group_invitation',g.name,'Seni grup sohbetine davet etti.',
 jsonb_build_object('screen','group-chat','groupId',g.id),false,g.created_at
FROM chat_group_members m JOIN chat_groups g ON g.id=m.group_id
WHERE m.status='invited' AND NOT EXISTS (
 SELECT 1 FROM user_notifications n WHERE n.user_id=m.user_id
 AND n.type='group_invitation' AND n.data->>'groupId'=g.id
)
ON CONFLICT(id) DO NOTHING;
