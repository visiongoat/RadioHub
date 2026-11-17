-- A TV's paired controllers share its command stream and playback presence.
-- Account-specific pairing rows remain the authorization boundary.
CREATE INDEX cast_commands_device_poll ON cast_commands(device_id,timestamp,id) WHERE consumed=false;
CREATE INDEX cast_now_playing_device_updated ON cast_now_playing(device_id,updated_at DESC);
CREATE INDEX user_devices_active_device_seen ON user_devices(device_id,last_seen_at DESC) WHERE is_active=true;
