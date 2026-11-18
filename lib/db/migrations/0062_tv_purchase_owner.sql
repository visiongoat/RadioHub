-- Only account-bound Premium QR codes populate this field. Legacy login and purchase codes retain their existing contract.
ALTER TABLE tv_device_codes ADD COLUMN IF NOT EXISTS purchase_owner_id text REFERENCES users(id) ON DELETE CASCADE;
