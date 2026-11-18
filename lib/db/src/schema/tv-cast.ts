import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, date as dateColumn, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './relational';

const date = (name: string) => timestamp(name, { withTimezone: true });
const owner = () => text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });

export const tvDeviceCodes = pgTable('tv_device_codes', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), code: text('code').notNull(),
  deviceId: text('device_id').notNull(), platform: text('platform').notNull().default('other'),
  status: text('status').notNull().default('pending'), userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  purchaseOwnerId: text('purchase_owner_id').references(() => users.id),
  token: text('token'), plan: text('plan'), stripeSessionId: text('stripe_session_id'),
  expiresAt: date('expires_at').notNull(), createdAt: date('created_at').notNull().defaultNow(), completedAt: date('completed_at'),
}, t => [
  check('tv_device_codes_kind_check', sql`${t.kind} IN ('login','subscription')`),
  check('tv_device_codes_code_check', sql`${t.code} ~ '^[0-9]{6}$'`),
  check('tv_device_codes_status_check', sql`${t.status} IN ('pending','activated','completed','expired')`),
  uniqueIndex('tv_device_codes_live_code').on(t.kind,t.code).where(sql`${t.status}<>'expired'`),
  uniqueIndex('tv_device_codes_pending_device').on(t.kind,t.deviceId).where(sql`${t.status}='pending'`),
  index('tv_device_codes_device_time').on(t.kind,t.deviceId,t.createdAt.desc()), index('tv_device_codes_expiry').on(t.expiresAt),
]);
export const userDevices = pgTable('user_devices', {
  id: text('id').primaryKey(), userId: owner(), deviceId: text('device_id').notNull(), deviceName: text('device_name').notNull(),
  platform: text('platform').notNull().default('other'), isActive: boolean('is_active').notNull().default(true),
  pairedAt: date('paired_at').notNull().defaultNow(), lastSeenAt: date('last_seen_at').notNull().defaultNow(),
}, t => [uniqueIndex('user_devices_user_id_device_id_key').on(t.userId,t.deviceId), index('user_devices_owner_seen').on(t.userId,t.isActive,t.lastSeenAt.desc())]);
export const castSessions = pgTable('cast_sessions', {
  id: text('id').primaryKey(), sessionId: text('session_id').notNull().unique(), pairingCode: text('pairing_code'),
  userId: owner(), mobileDeviceId: text('mobile_device_id'), tvDeviceId: text('tv_device_id'), status: text('status').notNull(),
  currentStation: jsonb('current_station'), isPlaying: boolean('is_playing').notNull().default(false),
  createdAt: date('created_at').notNull().defaultNow(), pairedAt: date('paired_at'), expiresAt: date('expires_at').notNull(), lastActivityAt: date('last_activity_at').notNull().defaultNow(),
}, t => [check('cast_sessions_status_check', sql`${t.status} IN ('waiting_for_pair','paired','active','expired')`),
  uniqueIndex('cast_sessions_pending_code').on(t.pairingCode).where(sql`${t.status}='waiting_for_pair'`),
  index('cast_sessions_owner').on(t.userId,t.status,t.expiresAt), index('cast_sessions_expiry').on(t.expiresAt)]);
export const castCommands = pgTable('cast_commands', {
  id: text('id').primaryKey(), userId: owner(), deviceId: text('device_id').notNull(), type: text('type').notNull(), payload: jsonb('payload').$type<{volumeDelta?:number}>(), station: jsonb('station'),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(), consumed: boolean('consumed').notNull().default(false), createdAt: date('created_at').notNull().defaultNow(),
}, t => [check('cast_commands_type_check', sql`${t.type} IN ('cast:play','cast:pause','cast:resume','cast:stop','cast:volume')`),
  index('cast_commands_poll').on(t.userId,t.deviceId,t.timestamp,t.id).where(sql`${t.consumed}=false`), index('cast_commands_expiry').on(t.createdAt)]);
export const castNowPlaying = pgTable('cast_now_playing', {
  id: text('id').primaryKey(), userId: owner(), deviceId: text('device_id').notNull(), platform: text('platform').notNull().default('other'),
  stationName: text('station_name'), title: text('title'), artist: text('artist'), isPlaying: boolean('is_playing').notNull().default(false), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [uniqueIndex('cast_now_playing_user_id_device_id_key').on(t.userId,t.deviceId)]);
export const pushTokens = pgTable('push_tokens', {
  id: text('id').primaryKey(), token: text('token').notNull().unique(), userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), tokenType: text('token_type').notNull(), deviceName: text('device_name').notNull().default(''),
  country: text('country').notNull().default(''), language: text('language').notNull().default(''), isActive: boolean('is_active').notNull().default(true),
  createdAt: date('created_at').notNull().defaultNow(), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [check('push_tokens_platform_check', sql`${t.platform} IN ('ios','android')`), check('push_tokens_token_type_check', sql`${t.tokenType} IN ('expo','apns','fcm')`),
  index('push_tokens_audience').on(t.platform,t.isActive,t.country),index('push_tokens_owner').on(t.userId)]);
export const tvVersionConfig = pgTable('tv_version_config', {
  singleton: boolean('singleton').primaryKey().default(true), id: text('id').notNull(), latest: jsonb('latest').notNull().default({}),
  minimum: jsonb('minimum').notNull().default({}), releaseNotes: jsonb('release_notes').notNull().default({}), storeUrl: jsonb('store_url').notNull().default({}), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [check('tv_version_config_singleton_check', sql`${t.singleton}`)]);
export const tvTelemetry = pgTable('tv_telemetry', {
  id: text('id').primaryKey(), ts: date('ts').notNull().defaultNow(), src: text('src').notNull().default('remote'),
  v: text('v'), plat: text('plat').notNull().default('other'), app: text('app'), did: text('did'), country: text('country'),
}, t => [index('tv_telemetry_expiry').on(t.ts)]);
export const tvTelemetryDaily = pgTable('tv_telemetry_daily', {
  id: text('id').primaryKey(), day: text('day').notNull(), plat: text('plat').notNull().default('other'), src: text('src').notNull().default('remote'),
  v: text('v').notNull().default(''), count: bigint('count', {mode:'number'}).notNull().default(0), uniqueDids: text('unique_dids').array().notNull().default(sql`ARRAY[]::text[]`), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [uniqueIndex('tv_telemetry_daily_day_plat_src_v_key').on(t.day,t.plat,t.src,t.v),index('tv_telemetry_daily_day').on(t.day.desc())]);
export const stripeSubscriptionPlans = pgTable('stripe_subscription_plans', {
  id: text('id').primaryKey(), planId: text('plan_id').notNull().unique(), stripePriceId: text('stripe_price_id').notNull().default(''),
  paddlePriceId: text('paddle_price_id'), label: text('label').notNull().default(''), description: text('description').notNull().default(''),
  currency: text('currency').notNull().default('usd'), amount: integer('amount').notNull().default(0), isActive: boolean('is_active').notNull().default(true), updatedAt: date('updated_at').notNull().defaultNow(),
}, t => [check('stripe_subscription_plans_plan_id_check', sql`${t.planId} IN ('remove_ads','premium_monthly','premium_yearly','premium_lifetime')`)]);
export const castEvents = pgTable('cast_events', {
  id: bigserial('id', {mode:'number'}).primaryKey(),sessionId:text('session_id').notNull(),payload:jsonb('payload').notNull(),createdAt:date('created_at').notNull().defaultNow(),
}, t => [index('cast_events_expiry').on(t.createdAt)]);
export const castConnections = pgTable('cast_connections', {
  connectionId:text('connection_id').primaryKey(),nodeId:text('node_id').notNull(),sessionId:text('session_id').notNull(),userId:owner(),
  deviceId:text('device_id'),role:text('role').notNull(),expiresAt:date('expires_at').notNull(),
}, t => [check('cast_connections_role_check', sql`${t.role} IN ('mobile','tv')`),index('cast_connections_presence').on(t.sessionId,t.role,t.expiresAt),index('cast_connections_node').on(t.nodeId)]);

// Sanitized opt-in TV counters; raw payloads and identifiers are never stored.
export const tvDiagnosticDaily = pgTable('tv_diagnostic_daily', {
  day: dateColumn('day').notNull().default(sql`current_date`), platform: text('platform').notNull(), appVersion: text('app_version').notNull(), bundleVersion: text('bundle_version').notNull(),
  event: text('event').notNull(), code: text('code').notNull(), route: text('route').notNull(), module: text('module').notNull(),
  line: integer('line_no').notNull().default(0), column: integer('column_no').notNull().default(0), count: integer('count').notNull().default(1),
}, t => [primaryKey({columns:[t.day,t.platform,t.appVersion,t.bundleVersion,t.event,t.code,t.route,t.module,t.line,t.column]}),index('tv_diagnostic_daily_day').on(t.day.desc()),
  check('tv_diagnostic_daily_platform_check',sql`${t.platform} IN ('tizen','webos')`),
  check('tv_diagnostic_daily_app_version_check',sql`length(${t.appVersion})<=20`),
  check('tv_diagnostic_daily_bundle_version_check',sql`length(${t.bundleVersion})<=64`),
  check('tv_diagnostic_daily_event_check',sql`${t.event} IN ('startup_ready','startup_error','js_error','promise_error','react_error','catalog_error','playback_error','app_open','screen_view','playback_start','playback_pause')`),
  check('tv_diagnostic_daily_code_check',sql`${t.code} IN ('startup_timeout','asset_load','syntax_error','type_error','reference_error','range_error','security_error','unknown_error','promise_rejected','render_error','http_error','network_error','request_timeout','media_aborted','media_network','media_decode','media_unsupported','playback_failed','none')`),
  check('tv_diagnostic_daily_route_check',sql`${t.route} IN ('discover','search','radio-playing','settings','favorites','login','premium-upgrade','countries','genres','other')`),
  check('tv_diagnostic_daily_module_check',sql`${t.module} IN ('main','audio','startup','vendor','api','unknown')`),
  check('tv_diagnostic_daily_line_no_check',sql`${t.line} BETWEEN 0 AND 10000000`),
  check('tv_diagnostic_daily_column_no_check',sql`${t.column} BETWEEN 0 AND 10000000`),
  check('tv_diagnostic_daily_count_check',sql`${t.count}>0`),
]);
