-- Valid populated catalog styles are checked by the authoritative API. The old
-- fixed twelve-style database enum rejected valid Arabesk/Folk Music selections.
ALTER TABLE chat_groups DROP CONSTRAINT IF EXISTS chat_groups_music_styles_check;
ALTER TABLE chat_groups ADD CONSTRAINT chat_groups_music_styles_check CHECK (
 cardinality(genres)<=3 AND array_position(genres,NULL) IS NULL
);
