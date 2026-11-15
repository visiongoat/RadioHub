-- Verified official homepage preflight, before the unchanged 0058 migration.
-- Official HTTP HEAD verified 301 -> https://oe3.orf.at/; HTTPS verified 200.
-- Captured source, manual ownership, playback and user relations are untouched.
DO $repair$
DECLARE
  station stations%ROWTYPE;
  audit_key constant text := 'verifiedOe3HomepageHttpsRecovery20261115';
  touched integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stations WHERE id='68a8c483bd66579311ab2ffe') THEN
    RAISE NOTICE '[oe3 homepage recovery] skipped: reviewed survivor absent';
    RETURN;
  END IF;
  PERFORM set_config('lock_timeout','500ms',true);
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-slug-assignment',0));
  LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE station_merge_aliases IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO station FROM stations WHERE id='68a8c483bd66579311ab2ffe' FOR UPDATE;
  IF station.id IS NULL OR station.station_uuid IS DISTINCT FROM 'e723f7f8-0db1-4bc5-a64c-64d8377f9f9a' THEN
    RAISE EXCEPTION '[oe3 homepage recovery] reviewed survivor changed';
  END IF;
  IF station.homepage='https://oe3.orf.at/' AND station.slug='orf-hitradio-o3'
     AND station.no_index_recovery_journal->'verifiedOe3CanonicalRecovery20261115'->>'survivorId'=station.id
     AND station.no_index_recovery_journal->'verifiedOe3CanonicalRecovery20261115'->>'reason'='restore-reviewed-pilot-after-duplicate-merge'
     AND EXISTS (SELECT 1 FROM radiohub_schema_migrations WHERE name='0058_verified_oe3_canonical_recovery.sql') THEN
    RAISE NOTICE '[oe3 homepage recovery] skipped: canonical recovery already verified';
    RETURN;
  END IF;
  IF station.no_index_recovery_journal ? audit_key THEN
    IF station.homepage IS DISTINCT FROM 'https://oe3.orf.at/'
       OR station.no_index_recovery_journal->audit_key->>'reason'
          IS DISTINCT FROM 'verified-official-http-301-to-https'
       OR station.no_index_recovery_journal->audit_key->'previous'->>'homepage'
          IS DISTINCT FROM 'http://oe3.orf.at/' THEN
      RAISE EXCEPTION '[oe3 homepage recovery] prior receipt/state changed';
    END IF;
    RETURN;
  END IF;
  IF station.slug IS DISTINCT FROM 'orf-hitradio-o3-hq'
     OR station.name IS DISTINCT FROM 'ORF Hitradio Ö3 | HQ'
     OR station.homepage IS DISTINCT FROM 'http://oe3.orf.at/'
     OR station.country IS DISTINCT FROM 'Austria'
     OR station.country_code IS DISTINCT FROM 'AT'
     OR station.url IS DISTINCT FROM 'https://orf-live.ors-shoutcast.at/oe3-q2a'
     OR station.url_resolved IS DISTINCT FROM station.url
     OR station.redirect_to_slug IS NOT NULL
     OR station.no_index IS DISTINCT FROM false
     OR station.is_list_visible IS DISTINCT FROM true
     OR jsonb_typeof(station.source) IS DISTINCT FROM 'object'
     OR station.source->>'homepage' IS DISTINCT FROM 'http://oe3.orf.at/'
     OR NOT COALESCE(station.source->'mergedStationIds' @> '["68a8c483bd66579311ab2ffa"]'::jsonb,false)
     OR jsonb_typeof(station.manual_edit_fields) IS DISTINCT FROM 'object'
     OR (station.manual_edit_fields ? 'homepage' AND station.manual_edit_fields->'homepage' IS DISTINCT FROM 'false'::jsonb)
     OR (station.no_index_recovery_journal IS NOT NULL AND jsonb_typeof(station.no_index_recovery_journal) IS DISTINCT FROM 'object')
     OR array_position(station.slug_aliases,NULL) IS NOT NULL
     OR ('orf-hitradio-o3'=ANY(station.slug_aliases)) IS DISTINCT FROM true
     OR NOT EXISTS (SELECT 1 FROM station_merge_aliases WHERE alias='68a8c483bd66579311ab2ffa' AND station_id=station.id)
     OR EXISTS (SELECT 1 FROM stations WHERE id='68a8c483bd66579311ab2ffa')
     OR EXISTS (SELECT 1 FROM radiohub_schema_migrations WHERE name='0058_verified_oe3_canonical_recovery.sql')
  THEN
    RAISE EXCEPTION '[oe3 homepage recovery] reviewed HTTP state changed; no update';
  END IF;
  UPDATE stations SET homepage='https://oe3.orf.at/',updated_at=clock_timestamp(),
    no_index_recovery_journal=COALESCE(station.no_index_recovery_journal,'{}'::jsonb)
      || jsonb_build_object(audit_key,jsonb_build_object(
        'reason','verified-official-http-301-to-https',
        'stationId',station.id,'stationUuid',station.station_uuid,'appliedAt',clock_timestamp(),
        'previous',jsonb_build_object('homepage',station.homepage,'updatedAt',station.updated_at,
          'journalWasNull',station.no_index_recovery_journal IS NULL)))
  WHERE id=station.id AND station_uuid=station.station_uuid AND homepage=station.homepage;
  GET DIAGNOSTICS touched=ROW_COUNT;
  IF touched<>1 THEN RAISE EXCEPTION '[oe3 homepage recovery] expected exactly one changed row'; END IF;
  RAISE NOTICE '[oe3 homepage recovery] upgraded exactly one official homepage; source and playback preserved';
END
$repair$;
