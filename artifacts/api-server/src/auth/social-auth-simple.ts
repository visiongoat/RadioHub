import { normalizeGenreSlug, SAFE_GENRE_SLUG_RE } from '../seo/genre-slug';
import { getPostgresPool } from '../postgres-runtime';
import { pgCreateUser } from '../data/postgres-user-store';
import { userHandleBase, userHandleCandidate } from '../utils/user-handle';

// Check if social auth is configured
export function getSocialAuthStatus() {
  return {
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    facebook: !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    apple: !!((process.env.APPLE_CLIENT_ID || process.env.APPLE_SERVICE_ID) && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY)
  };
}

// Helper function to generate unique username
export async function generateUniqueUsername(baseUsername: string): Promise<string> {
  const base = userHandleBase(baseUsername);
  let username = base;
  let counter = 0;
  
  while (true) {
    const existingUser = await getPostgresPool().query('SELECT 1 FROM users WHERE username=$1', [username]);
    if (!existingUser.rowCount) {
      return username;
    }
    counter++;
    username = userHandleCandidate(base, counter);
  }
}

/**
 * Shared slug generator used by the social-auth flow (Task #278).
 *
 * CONTRACT — DO NOT WEAKEN WITHOUT UPDATING TASK #161 / #206 TESTS:
 *   - When `entityType === 'genre'`, the helper MUST funnel `name`
 *     through `normalizeGenreSlug` so the result either satisfies
 *     `SAFE_GENRE_SLUG_RE` or the helper refuses to write (throws).
 *     The schema-level validator on `Genre.slug` would reject a bad
 *     value at save time too, but throwing here keeps the failure
 *     local to the call site that produced the junk and avoids the
 *     "where did this slug come from?" forensic trail when malformed
 *     genres later show up in the sitemap.
 *   - Each entity type queries its OWN collection for uniqueness —
 *     before Task #278 this helper queried `User.findOne` regardless
 *     of `entityType`, which silently broke any non-user caller.
 *
 * Today only the social-signup user path uses `'user'`; the `'genre'`
 * branch exists defensively because the signature has always exposed
 * it and a future refactor that creates favorite-genre rows from
 * social-profile metadata is the most likely place malformed slugs
 * would re-emerge unnoticed (Task #278 motivation).
 */
export async function generateUniqueSlug(
  name: string,
  entityType: 'station' | 'genre' | 'user',
  excludeId?: string,
): Promise<string> {
  let baseSlug: string;

  if (entityType === 'genre') {
    baseSlug = normalizeGenreSlug(name);
    if (!baseSlug) {
      // Refuse to write. The caller produced something that the shared
      // normalizer collapsed to ''. Persisting a junk slug here would
      // bypass the SAFE_GENRE_SLUG_RE contract enforced everywhere else.
      throw new Error(
        `generateUniqueSlug: refusing to write empty Genre.slug for input ${JSON.stringify(name)}`,
      );
    }
  } else {
    baseSlug = name
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
      .replace(/^-+|-+$/g, '');
  }

  const table = entityType === 'genre' ? 'genres' : entityType === 'station' ? 'stations' : 'users';

  let uniqueSlug = baseSlug;
  let counter = 1;

  while (true) {
    const filter: Record<string, unknown> = { slug: uniqueSlug };
    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    const existing = await getPostgresPool().query(`SELECT 1 FROM ${table} WHERE slug=$1 AND ($2::text IS NULL OR id<>$2)`, [uniqueSlug, excludeId || null]);
    if (!existing.rowCount) {
      break;
    }

    uniqueSlug = `${baseSlug}-${counter}`;
    counter++;
  }

  if (entityType === 'genre' && !SAFE_GENRE_SLUG_RE.test(uniqueSlug)) {
    // Belt-and-suspenders: counters are digits and `baseSlug` was just
    // normalized, so this should be unreachable — but if a future tweak
    // ever changes the suffix format, fail loudly instead of silently
    // writing a malformed slug.
    throw new Error(
      `generateUniqueSlug: produced unsafe Genre.slug "${uniqueSlug}" for input ${JSON.stringify(name)}`,
    );
  }

  return uniqueSlug;
}

// Create user from social profile
export async function createUserFromSocialProfile(profile: any, provider: 'google' | 'facebook' | 'apple') {
  const email = profile.emails?.[0]?.value || profile.email;
  const fullName = profile.displayName || 
                   `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() ||
                   [profile.name?.firstName, profile.name?.lastName].filter(Boolean).join(' ');

  const userData: any = {
    fullName,
    email,
    emailVerified: true, // Social emails are pre-verified
    profilePicture: profile.photos?.[0]?.value || profile.picture,
    role: 'user',
    status: 'active',
    followersCount: 0,
    followingCount: 0,
    favoriteStationsCount: 0,
    totalListeningTime: 0,
    stationsCreatedCount: 0,
    stats: {
      totalPlays: 0,
      totalListeningHours: 0,
      favoriteGenres: [],
      joinDate: new Date(),
      lastActiveDate: new Date(),
      streakDays: 0
    }
  };

  // Set the appropriate social ID
  if (provider === 'google') userData.googleId = profile.id;
  if (provider === 'facebook') userData.facebookId = profile.id;
  if (provider === 'apple') userData.appleId = profile.id;

  // Generate unique slug for the new social user
  let slugSource = '';
  if (userData.username) {
    slugSource = userData.username;
  } else if (userData.fullName) {
    slugSource = userData.fullName;
  } else {
    slugSource = 'listener';
  }

  userData.slug = await generateUniqueSlug(slugSource, 'user');
  console.log(`🔤 Generated slug for social user: "${userData.slug}" (${userData.email})`);

  return pgCreateUser(userData);
}
