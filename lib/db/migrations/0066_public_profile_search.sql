-- Public search must not depend on favorite activity. Index the same normalized
-- expressions as the bounded query; private/inactive users are excluded.
CREATE INDEX IF NOT EXISTS users_public_name_search_idx ON users
  USING gin (translate(lower(COALESCE(full_name,'')),'çğıöşü','cgiosu') gin_trgm_ops)
  WHERE is_public_profile=true AND status='active';
CREATE INDEX IF NOT EXISTS users_public_username_search_idx ON users
  USING gin (translate(lower(COALESCE(username,'')),'çğıöşü','cgiosu') gin_trgm_ops)
  WHERE is_public_profile=true AND status='active';
