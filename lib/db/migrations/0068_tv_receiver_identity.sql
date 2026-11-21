-- Bind the TV app device ID to its locally verified Samsung receiver UUID.
-- Metadata does not create an account pairing or change the TV profile.
ALTER TABLE user_devices ADD COLUMN receiver_uuid text;
ALTER TABLE user_devices ADD COLUMN receiver_application text;
ALTER TABLE user_devices ADD CONSTRAINT user_devices_receiver_identity_check CHECK (
 (receiver_uuid IS NULL AND receiver_application IS NULL) OR
 (receiver_uuid IS NOT NULL AND receiver_application IS NOT NULL AND receiver_uuid ~* '^uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND receiver_application IN ('MgRadioDev.MegaRadioTVAPP','lJoKY533ah.MegaRadioTVAPP'))
);
