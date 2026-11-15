-- Restore the reviewed pilot URL after its original record was merged into HQ.
-- Keep the survivor, playback, captured source, merge mappings and user data.
DO $repair$
DECLARE
  station stations%ROWTYPE;
  survivor_id constant text := '68a8c483bd66579311ab2ffe';
  original_id constant text := '68a8c483bd66579311ab2ffa';
  old_slug constant text := 'orf-hitradio-o3-hq';
  canonical_slug constant text := 'orf-hitradio-o3';
  audit_key constant text := 'verifiedOe3CanonicalRecovery20261115';
  applied_at timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stations WHERE id=survivor_id) THEN
    RAISE NOTICE '[oe3 canonical recovery] skipped: reviewed survivor absent';
    RETURN;
  END IF;

  PERFORM set_config('lock_timeout', '500ms', true);
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-slug-assignment',0));
  -- NOWAIT prevents an overlapping merge/edit from turning this into a long lock.
  LOCK TABLE stations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  LOCK TABLE station_merge_aliases IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  SELECT * INTO station FROM stations WHERE id=survivor_id FOR UPDATE;
  IF station.id IS NULL THEN
    RAISE EXCEPTION '[oe3 canonical recovery] survivor changed during review';
  END IF;
  IF station.slug_aliases IS NULL OR array_position(station.slug_aliases,NULL) IS NOT NULL THEN
    RAISE EXCEPTION '[oe3 canonical recovery] malformed slug aliases';
  END IF;
  IF station.no_index_recovery_journal ? audit_key THEN
    IF station.slug IS DISTINCT FROM canonical_slug
       OR (old_slug=ANY(station.slug_aliases)) IS DISTINCT FROM true
       OR (canonical_slug=ANY(station.slug_aliases)) IS DISTINCT FROM false THEN
      RAISE EXCEPTION '[oe3 canonical recovery] prior recovery state changed';
    END IF;
    RETURN;
  END IF;

  IF station.station_uuid IS DISTINCT FROM 'e723f7f8-0db1-4bc5-a64c-64d8377f9f9a'
     OR station.slug IS DISTINCT FROM old_slug
     OR station.name IS DISTINCT FROM 'ORF Hitradio Ö3 | HQ'
     OR station.homepage IS DISTINCT FROM 'https://oe3.orf.at/'
     OR station.country IS DISTINCT FROM 'Austria'
     OR station.country_code IS DISTINCT FROM 'AT'
     OR station.url IS DISTINCT FROM 'https://orf-live.ors-shoutcast.at/oe3-q2a'
     OR station.url_resolved IS DISTINCT FROM station.url
     OR station.redirect_to_slug IS NOT NULL
     OR station.no_index IS DISTINCT FROM false
     OR station.is_list_visible IS DISTINCT FROM true
     OR jsonb_typeof(station.source) IS DISTINCT FROM 'object'
     OR station.source->>'stationPageMode'='information'
     OR NOT COALESCE(station.source->'mergedStationIds' @> jsonb_build_array(original_id),false)
     OR (canonical_slug=ANY(station.slug_aliases)) IS DISTINCT FROM true
     OR jsonb_typeof(station.manual_edit_fields) IS DISTINCT FROM 'object'
     OR (station.no_index_recovery_journal IS NOT NULL
         AND jsonb_typeof(station.no_index_recovery_journal) IS DISTINCT FROM 'object')
     OR NOT EXISTS (SELECT 1 FROM station_merge_aliases WHERE alias=original_id AND station_id=survivor_id)
     OR EXISTS (SELECT 1 FROM stations WHERE id=original_id)
  THEN
    RAISE EXCEPTION '[oe3 canonical recovery] reviewed identity or merge evidence changed';
  END IF;

  IF EXISTS (SELECT 1 FROM stations WHERE id<>survivor_id AND (
       slug IN (old_slug,canonical_slug)
       OR slug_aliases && ARRAY[old_slug,canonical_slug]
       OR redirect_to_slug IN (old_slug,canonical_slug)
       OR source->>'redirectToSlug' IN (old_slug,canonical_slug)))
     OR EXISTS (SELECT 1 FROM station_merge_aliases
       WHERE alias IN (old_slug,canonical_slug) AND station_id<>survivor_id)
     OR EXISTS (SELECT 1 FROM genres WHERE slug IN (old_slug,canonical_slug))
     OR EXISTS (SELECT 1 FROM users WHERE slug IN (old_slug,canonical_slug))
  THEN
    RAISE EXCEPTION '[oe3 canonical recovery] conflicting ownership or incoming redirect';
  END IF;

  UPDATE stations SET slug=canonical_slug,
    slug_aliases=array_remove(station.slug_aliases,canonical_slug)
      || CASE WHEN old_slug=ANY(station.slug_aliases) THEN ARRAY[]::text[] ELSE ARRAY[old_slug] END,
    no_index_recovery_journal=COALESCE(station.no_index_recovery_journal,'{}'::jsonb)
      || jsonb_build_object(audit_key,jsonb_build_object(
        'reason','restore-reviewed-pilot-after-duplicate-merge',
        'survivorId',survivor_id,'originalId',original_id,'appliedAt',applied_at,
        'previous',jsonb_build_object('slug',station.slug,'slugAliases',station.slug_aliases,
          'updatedAt',station.updated_at,'journalWasNull',station.no_index_recovery_journal IS NULL))),
    updated_at=applied_at
  WHERE id=survivor_id;

  -- Change only cache invalidators for chunks already containing this same ID.
  -- Membership, version, generatedAt and public lastmod values are untouched.
  UPDATE sitemap_manifests m SET chunks=(
    SELECT jsonb_agg(CASE WHEN chunk->'stationIds' @> jsonb_build_array(survivor_id)
      THEN jsonb_set(chunk,'{maxUpdatedAt}',to_jsonb(greatest(
        date_trunc('millisecond',applied_at),
        date_trunc('millisecond',(chunk->>'maxUpdatedAt')::timestamptz)+interval '1 millisecond'
      ))) ELSE chunk END ORDER BY ord)
    FROM jsonb_array_elements(m.chunks) WITH ORDINALITY AS parts(chunk,ord))
  WHERE m.type='stations' AND m.status='active'
    AND m.chunks @> jsonb_build_array(jsonb_build_object('stationIds',jsonb_build_array(survivor_id)));
  RAISE NOTICE '[oe3 canonical recovery] restored canonical URL; survivor and merge aliases retained';
END
$repair$;
