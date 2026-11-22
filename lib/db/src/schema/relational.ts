import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/**
 * IDs deliberately remain text during the migration. Existing API contracts,
 * caches and mobile clients expose Mongo ObjectId strings. Preserving those IDs
 * makes a rollback and row-by-row parity checks possible without an ID map.
 */
export const countries = pgTable(
  "countries",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    continent: text("continent"),
    stationCount: integer("station_count").notNull().default(0),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("countries_code_uq").on(table.code)],
);

export const languages = pgTable(
  "languages",
  {
    id: text("id").primaryKey(),
    code: text("code"),
    name: text("name").notNull(),
    stationCount: integer("station_count").notNull().default(0),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("languages_code_uq").on(table.code),
    index("languages_name_idx").on(table.name),
  ],
);

export const genres = pgTable(
  "genres",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug"),
    isDiscoverable: boolean("is_discoverable").notNull().default(true),
    stationCount: integer("station_count").notNull().default(0),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("genres_slug_uq").on(table.slug),
    check("genres_discoverable_slug_check", sql`${table.slug} IS NOT NULL OR ${table.isDiscoverable}=false`),
    index("genres_discoverable_count_idx").on(
      table.isDiscoverable,
      table.stationCount,
    ),
  ],
);

export type StationDescriptions = Record<
  string,
  string | { full?: string; meta?: string; [key: string]: unknown }
>;

export const stations = pgTable(
  "stations",
  {
    id: text("id").primaryKey(),
    stationUuid: text("station_uuid").notNull(),
    changeUuid: text("change_uuid"),
    name: text("name").notNull(),
    slug: text("slug"),
    slugAliases: text("slug_aliases").array().notNull().default([]),
    redirectToSlug: text("redirect_to_slug"),
    url: text("url").notNull(),
    urlResolved: text("url_resolved"),
    homepage: text("homepage"),
    favicon: text("favicon"),
    country: text("country"),
    countryCode: text("country_code"),
    state: text("state"),
    language: text("language"),
    languageCodes: text("language_codes"),
    tagsRaw: text("tags_raw"),
    codec: text("codec"),
    bitrate: integer("bitrate"),
    hls: boolean("hls").notNull().default(false),
    votes: integer("votes").notNull().default(0),
    clickCount: integer("click_count").notNull().default(0),
    clickTrend: doublePrecision("click_trend").notNull().default(0),
    averageRating: real("average_rating").notNull().default(0),
    totalRatings: integer("total_ratings").notNull().default(0),
    lastCheckOk: boolean("last_check_ok").notNull().default(true),
    isListVisible: boolean("is_list_visible").notNull().default(true),
    visibilityExpiresAt: timestamp("visibility_expires_at", { withTimezone: true }),
    availabilityOutcome: text("availability_outcome"),
    availabilityCheckedAt: timestamp("availability_checked_at", { withTimezone: true }),
    lastCheckTime: timestamp("last_check_time", { withTimezone: true }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    hasLogo: boolean("has_logo").notNull().default(false),
    logoAssets: jsonb("logo_assets").$type<Record<string, unknown>>(),
    descriptions: jsonb("descriptions")
      .$type<StationDescriptions>()
      .notNull()
      .default({}),
    manualEditFields: jsonb("manual_edit_fields")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    mediaGroupId: text("media_group_id"),
    isFeatured: boolean("is_featured").notNull().default(false),
    showInGlobalPopular: boolean("show_in_global_popular")
      .notNull()
      .default(false),
    noIndex: boolean("no_index").notNull().default(false),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("stations_uuid_uq").on(table.stationUuid),
    index("stations_slug_idx").on(table.slug),
    index("stations_country_working_popular_idx").on(
      table.countryCode,
      table.lastCheckOk,
      table.votes,
    ),
    index("stations_working_logo_votes_idx").on(
      table.lastCheckOk,
      table.hasLogo,
      table.votes,
    ),
    index("stations_updated_idx").on(table.updatedAt),
    index("stations_media_group_idx").on(table.mediaGroupId),
  ],
);

export const stationGenres = pgTable(
  "station_genres",
  {
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    genreSlug: text("genre_slug").notNull(),
    position: integer("position").notNull().default(0),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.stationId, table.genreSlug] }),
    index("station_genres_slug_station_idx").on(
      table.genreSlug,
      table.stationId,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    fullName: text("full_name").notNull(),
    slug: text("slug"),
    bio: text("bio"),
    avatar: text("avatar"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    emailVerified: boolean("email_verified").notNull().default(false),
    isPublicProfile: boolean("is_public_profile").notNull().default(false),
    googleId: text("google_id"),
    facebookId: text("facebook_id"),
    appleId: text("apple_id"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default({}),
    permissions: jsonb("permissions").$type<Record<string, unknown>>().default({}),
    stats: jsonb("stats").$type<Record<string, unknown>>().default({}),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("users_username_uq").on(table.username),
    uniqueIndex("users_email_uq").on(table.email),
    uniqueIndex("users_google_id_uq").on(table.googleId),
    uniqueIndex("users_facebook_id_uq").on(table.facebookId),
    uniqueIndex("users_apple_id_uq").on(table.appleId),
    index("users_public_slug_idx").on(table.isPublicProfile, table.slug),
    index("users_role_status_idx").on(table.role, table.status),
  ],
);

export const userFavorites = pgTable(
  "user_favorites",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.stationId] }),
    index("user_favorites_station_created_idx").on(
      table.stationId,
      table.createdAt,
    ),
  ],
);

export const stationVotes = pgTable('station_votes', {
  stationId: text('station_id').notNull().references(() => stations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt,
}, table => [primaryKey({ columns: [table.stationId, table.userId] }), index('station_votes_user_idx').on(table.userId)]);

export const stationRatings = pgTable(
  "station_ratings",
  {
    id: text("id").primaryKey(),
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    ipAddress: text("ip_address"),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("station_ratings_user_uq").on(table.stationId, table.userId),
    uniqueIndex("station_ratings_session_uq").on(
      table.stationId,
      table.sessionId,
    ),
    index("station_ratings_station_created_idx").on(
      table.stationId,
      table.createdAt,
    ),
  ],
);

export const userFollows = pgTable(
  "user_follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followingId: text("following_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index("user_follows_following_idx").on(table.followingId),
  ],
);

export const userNotifications = pgTable(
  "user_notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    isRead: boolean("is_read").notNull().default(false),
    readAt: timestamp("read_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("user_notifications_user_created_idx").on(table.userId, table.createdAt),
    index("user_notifications_user_unread_idx").on(table.userId, table.isRead, table.createdAt),
  ],
);

export const directMessages = pgTable(
  "direct_messages",
  {
    id: text("id").primaryKey(),
    fromUserId: text("from_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    messageType: text("message_type").notNull().default("text"),
    imageUrl: text("image_url"),
    replyToId: text("reply_to_id"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    isRead: boolean("is_read").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    hiddenFor: text("hidden_for").array().notNull().default(sql`ARRAY[]::text[]`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("direct_messages_conversation_time_idx").on(table.fromUserId, table.toUserId, table.createdAt),
    index("direct_messages_recipient_unread_idx").on(table.toUserId, table.isRead, table.createdAt),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceType: text("device_type").notNull().default("mobile"),
    deviceName: text("device_name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull(),
    isRevoked: boolean("is_revoked").notNull().default(false),
    source: jsonb("source").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [
    uniqueIndex("auth_tokens_token_uq").on(table.token),
    index("auth_tokens_user_idx").on(table.userId),
    index("auth_tokens_expiry_idx").on(table.expiresAt),
  ],
);

// Only hashes are stored; callback state and mobile handoffs are consumed atomically.
export const facebookOAuthStates = pgTable('facebook_oauth_states', {
  stateHash: text('state_hash').primaryKey(),
  expiresAt: timestamp('expires_at', {withTimezone:true}).notNull(),
}, table => [index('facebook_oauth_states_expiry').on(table.expiresAt)]);

export const oauthMobileHandoffs = pgTable('oauth_mobile_handoffs', {
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, {onDelete:'cascade'}),
  challenge: text('challenge').notNull(),
  expiresAt: timestamp('expires_at', {withTimezone:true}).notNull(),
}, table => [index('oauth_mobile_handoffs_expiry').on(table.expiresAt)]);

export const listeningHistory = pgTable(
  "listening_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    sessionId: text("session_id").notNull(),
    stationId: text("station_id").notNull(),
    stationName: text("station_name").notNull(),
    country: text("country"),
    genre: text("genre"),
    listenDuration: integer("listen_duration").notNull().default(0),
    interactionType: text("interaction_type").notNull(),
    listenedAt: timestamp("listened_at", { withTimezone: true }).notNull(),
    deviceType: text("device_type"),
    context: jsonb("context").$type<Record<string, unknown>>().default({}),
    createdAt,
  },
  (table) => [
    index("listening_user_time_idx").on(table.userId, table.listenedAt),
    index("listening_session_time_idx").on(table.sessionId, table.listenedAt),
    index("listening_station_time_idx").on(table.stationId, table.listenedAt),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan").notNull().default("none"),
    platform: text("platform"),
    status: text("status").notNull().default("inactive"),
    productId: text("product_id"),
    transactionId: text("transaction_id"),
    originalTransactionId: text("original_transaction_id"),
    purchaseToken: text("purchase_token"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    paddleCustomerId: text("paddle_customer_id"),
    paddleSubscriptionId: text("paddle_subscription_id"),
    isActive: boolean("is_active").notNull().default(false),
    isTrial: boolean("is_trial").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    renewsAt: timestamp("renews_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    providerData: jsonb("provider_data").$type<Record<string, unknown>>().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("subscriptions_original_tx_uq").on(table.originalTransactionId),
    uniqueIndex("subscriptions_purchase_token_uq").on(table.purchaseToken),
    index("subscriptions_active_expiry_idx").on(table.isActive, table.expiresAt),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    plan: text("plan"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    origin: text("origin").notNull().default("runtime"),
    createdAt,
  },
  (table) => [
    uniqueIndex("payment_events_provider_event_uq").on(
      table.provider,
      table.providerEventId,
    ),
    index("payment_events_user_time_idx").on(table.userId, table.occurredAt),
    index("payment_events_status_time_idx").on(table.status, table.occurredAt),
    index("payment_events_origin_time_idx").on(table.origin, table.occurredAt),
  ],
);

export const translationKeys = pgTable(
  "translation_keys",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    defaultValue: text("default_value").notNull(),
    category: text("category").notNull(),
    description: text("description"),
    context: text("context"),
    isPlural: boolean("is_plural").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("translation_keys_key_uq").on(table.key)],
);

export const translations = pgTable(
  "translations",
  {
    id: text("id").primaryKey(),
    keyId: text("key_id")
      .notNull()
      .references(() => translationKeys.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    value: text("value").notNull(),
    isCompleted: boolean("is_completed").notNull().default(false),
    lastModified: timestamp("last_modified", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("translations_key_language_uq").on(table.keyId, table.language),
    index("translations_language_completed_idx").on(
      table.language,
      table.isCompleted,
    ),
  ],
);

export const translationMetadata = pgTable(
  "translation_metadata",
  {
    scope: text("scope").primaryKey(),
    languagesVersion: bigint("languages_version", { mode: "number" }).notNull().default(1),
    lastBumpedAt: timestamp("last_bumped_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (table) => [check("translation_metadata_languages_version_check", sql`${table.languagesVersion} >= 1`)],
);

export const translationLanguages = pgTable(
  "translation_languages",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt,
  },
  (table) => [uniqueIndex("translation_languages_code_key").on(table.code)],
);

export const countryLanguageMappings = pgTable(
  "country_language_mappings",
  {
    id: text("id").primaryKey(),
    countryCode: text("country_code").notNull(),
    countryName: text("country_name").notNull(),
    languageCode: text("language_code").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    priority: integer("priority").notNull().default(0),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("country_language_mappings_country_code_key").on(table.countryCode),
    index("country_language_mappings_active_priority_idx").on(table.isActive, table.priority.desc()),
  ],
);

export const countryLanguageMappingAudit = pgTable(
  "country_language_mapping_audit",
  {
    id: text("id").primaryKey(),
    action: text("action").notNull().default("clear-overrides"),
    actorEmail: text("actor_email"),
    deletedCount: integer("deleted_count").notNull().default(0),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>[]>().notNull().default([]),
    changes: jsonb("changes").$type<Record<string, unknown>[]>().notNull().default([]),
    note: text("note"),
    createdAt,
  },
  (table) => [index("country_language_mapping_audit_created_idx").on(table.createdAt.desc())],
);

export const urlTranslations = pgTable(
  "url_translations",
  {
    id: text("id").primaryKey(),
    languageCode: text("language_code").notNull(),
    englishPath: text("english_path").notNull(),
    translatedPath: text("translated_path").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("url_translations_lang_path_uq").on(
      table.languageCode,
      table.englishPath,
    ),
    index("url_translations_reverse_idx").on(
      table.languageCode,
      table.translatedPath,
    ),
  ],
);

/** Complete lossless copy of every Mongo collection during the transition. */
export const legacyDocuments = pgTable(
  "legacy_documents",
  {
    collectionName: text("collection_name").notNull(),
    documentId: text("document_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    checksum: text("checksum").notNull(),
    bsonPayload: jsonb("bson_payload").$type<Record<string, unknown>>(),
    bsonChecksum: text("bson_checksum"),
    lastSeenRunId: text("last_seen_run_id").notNull(),
    mongoUpdatedAt: timestamp("mongo_updated_at", { withTimezone: true }),
    migratedAt: timestamp("migrated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.collectionName, table.documentId] }),
    index("legacy_documents_collection_updated_idx").on(
      table.collectionName,
      table.mongoUpdatedAt,
    ),
  ],
);

export const migrationRuns = pgTable(
  "migration_runs",
  {
    id: text("id").primaryKey(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    sourceDatabase: text("source_database"),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
  },
  (table) => [index("migration_runs_started_idx").on(table.startedAt)],
);

export const migrationCheckpoints = pgTable(
  "migration_checkpoints",
  {
    collectionName: text("collection_name").primaryKey(),
    lastDocumentId: text("last_document_id"),
    documentsProcessed: integer("documents_processed").notNull().default(0),
    sourceCount: integer("source_count").notNull().default(0),
    targetCount: integer("target_count").notNull().default(0),
    status: text("status").notNull().default("pending"),
    updatedAt,
  },
  (table) => [index("migration_checkpoints_status_idx").on(table.status)],
);

export const mongoChangeStreamCheckpoints = pgTable(
  "mongo_change_stream_checkpoints",
  {
    streamName: text("stream_name").primaryKey(),
    resumeToken: jsonb("resume_token").$type<Record<string, unknown> | null>(),
    status: text("status").notNull().default("starting"),
    eventsProcessed: bigint("events_processed", { mode: "number" }).notNull().default(0),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastError: text("last_error"),
    ownerId: text("owner_id"),
    updatedAt,
  },
  (table) => [index("mongo_change_stream_checkpoints_status_idx").on(table.status, table.updatedAt)],
);

export type StationRow = typeof stations.$inferSelect;
export const databaseWriteAuthority = pgTable("database_write_authority", {
  domain: text("domain").primaryKey(),
  authority: text("authority").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("database_write_authority_authority_check", sql`${table.authority} = 'postgres'`)]);

export type NewStationRow = typeof stations.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

export const seoQualifiedLanguagesLkg = pgTable("seo_qualified_languages_lkg", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  languages: text("languages").array().notNull().default(sql`ARRAY[]::text[]`),
  hash: text("hash").notNull(),
  source: text("source").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
  updatedAt,
}, (table) => [
  index("seo_qualified_languages_lkg_expiry_idx").on(table.expiresAt),
  check("seo_qualified_languages_lkg_source_check", sql`${table.source} IN ('computed','seed')`),
]);

export const adminSettings = pgTable("admin_settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").$type<unknown>(),
  updatedBy: text("updated_by"),
  createdAt,
  updatedAt,
});

export const adminSettingHistory = pgTable("admin_setting_history", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  action: text("action").notNull(),
  previousValue: jsonb("previous_value").$type<unknown>(),
  newValue: jsonb("new_value").$type<unknown>(),
  changedBy: text("changed_by"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("admin_setting_history_key_changed_idx").on(table.key, table.changedAt.desc()),
  check("admin_setting_history_action_check", sql`${table.action} IN ('update','clear')`),
]);

export const stationMergeAliases = pgTable('station_merge_aliases', {
  alias: text('alias').primaryKey(),
  stationId: text('station_id').notNull().references(() => stations.id, { onDelete: 'cascade' }),
  createdAt,
}, table => [
  index('station_merge_aliases_station_idx').on(table.stationId),
  check('station_merge_aliases_alias_check', sql`length(${table.alias}) > 0`),
]);

export const stationDuplicateJobs = pgTable('station_duplicate_jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('queued'),
  phase: text('phase').notNull().default('scan'),
  threshold: real('threshold').notNull().default(0.85),
  previewJobId: text('preview_job_id').unique().references((): AnyPgColumn => stationDuplicateJobs.id),
  totalGroups: integer('total_groups').notNull().default(0),
  groupsProcessed: integer('groups_processed').notNull().default(0),
  eligibleGroups: integer('eligible_groups').notNull().default(0),
  skippedGroups: integer('skipped_groups').notNull().default(0),
  mergedGroups: integer('merged_groups').notNull().default(0),
  stationsToDelete: integer('stations_to_delete').notNull().default(0),
  stationsDeleted: integer('stations_deleted').notNull().default(0),
  mergedStations: jsonb('merged_stations').notNull().default([]),
  errors: jsonb('errors').notNull().default([]),
  skippedReasons: jsonb('skipped_reasons').notNull().default({}),
  errorMessage: text('error_message'),
  createdAt,
  startedAt: timestamp('started_at', { withTimezone: true }),
  updatedAt,
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, table => [
  index('station_duplicate_jobs_active_idx').on(table.createdAt).where(sql`${table.status} IN ('queued','running')`),
  index('station_duplicate_jobs_kind_created_idx').on(table.kind, table.createdAt.desc()),
  check('station_duplicate_jobs_kind_check', sql`${table.kind} IN ('preview','manual','automatic')`),
  check('station_duplicate_jobs_status_check', sql`${table.status} IN ('queued','running','completed','failed')`),
  check('station_duplicate_jobs_phase_check', sql`${table.phase} IN ('scan','evaluate')`),
]);

export const stationDuplicateJobGroups = pgTable('station_duplicate_job_groups', {
  jobId: text('job_id').notNull().references(() => stationDuplicateJobs.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  stationIds: text('station_ids').array().notNull(),
  stationCount: integer('station_count').notNull(),
  groupName: text('group_name').notNull(),
  country: text('country').notNull(),
  status: text('status').notNull().default('pending'),
  reason: text('reason'),
  attempts: integer('attempts').notNull().default(0),
}, table => [
  primaryKey({ columns: [table.jobId, table.ordinal] }),
  index('station_duplicate_groups_pending_idx').on(table.jobId, table.ordinal).where(sql`${table.status}='pending'`),
  check('station_duplicate_job_groups_status_check', sql`${table.status} IN ('pending','eligible','skipped','merged')`),
]);

export const stationDuplicateMergeControl = pgTable('station_duplicate_merge_control', {
  id: integer('id').primaryKey(),
  nextAutoAt: timestamp('next_auto_at', { withTimezone: true }).notNull().default(sql`now()+interval '24 hours'`),
  nextCycleAt: timestamp('next_cycle_at', { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  leaseOwner: text('lease_owner'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  summary: jsonb('summary').notNull().default({}),
}, table => [check('station_duplicate_merge_control_id_check', sql`${table.id}=1`)]);

export const chatGroups = pgTable('chat_groups', {
 id:text('id').primaryKey(),name:text('name').notNull(),avatar:text('avatar'),genres:text('genres').array().notNull().default([]),
 createdBy:text('created_by').notNull().references(()=>users.id),createdAt,
});
export const chatGroupMembers = pgTable('chat_group_members',{
 groupId:text('group_id').notNull().references(()=>chatGroups.id,{onDelete:'cascade'}),
 userId:text('user_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
 role:text('role').notNull().default('member'),status:text('status').notNull().default('invited'),
 joinedAt:timestamp('joined_at',{withTimezone:true}).notNull().defaultNow(),readAt:timestamp('read_at',{withTimezone:true}).notNull().defaultNow(),
},table=>[primaryKey({columns:[table.groupId,table.userId]}),index('chat_group_members_user_idx').on(table.userId,table.status)]);
export const chatGroupMessages = pgTable('chat_group_messages',{
 id:text('id').primaryKey(),groupId:text('group_id').notNull().references(()=>chatGroups.id,{onDelete:'cascade'}),
 fromUserId:text('from_user_id').notNull().references(()=>users.id),content:text('content').notNull(),
 messageType:text('message_type').notNull().default('text'),imageUrl:text('image_url'),createdAt,
 hiddenFor:text('hidden_for').array().notNull().default(sql`'{}'::text[]`),deletedAt:timestamp('deleted_at',{withTimezone:true}),
 replyToId:text('reply_to_id'),pinnedAt:timestamp('pinned_at',{withTimezone:true}),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
},table=>[index('chat_group_messages_time_idx').on(table.groupId,table.createdAt,table.id)]);
