-- Extend the existing opt-in aggregate counter allowlist; no new identifiers or raw events.
ALTER TABLE tv_diagnostic_daily DROP CONSTRAINT IF EXISTS tv_diagnostic_daily_event_check;
ALTER TABLE tv_diagnostic_daily ADD CONSTRAINT tv_diagnostic_daily_event_check
 CHECK(event IN ('startup_ready','startup_error','js_error','promise_error','react_error','catalog_error','playback_error','app_open','screen_view','playback_start','playback_pause','activity_heartbeat','listening_heartbeat'));
