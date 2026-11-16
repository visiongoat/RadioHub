ALTER TABLE cast_commands ADD COLUMN payload jsonb;
ALTER TABLE cast_commands DROP CONSTRAINT cast_commands_type_check;
ALTER TABLE cast_commands ADD CONSTRAINT cast_commands_type_check
  CHECK(type IN ('cast:play','cast:pause','cast:resume','cast:stop','cast:volume'));
