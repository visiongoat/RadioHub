import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import { googleOAuthCallbackUrl } from './oauth-redirect';
import { newPublicUserId, pgCreateUser, pgDeleteUser, pgFindUserById, pgFindUserByIdentity, pgUpdateUser, pgUserSlugExists, userStore, } from '../data/postgres-user-store';
async function findIdentity(input: {
    email?: string;
    googleId?: string;
    facebookId?: string;
}): Promise<any | null> {
    return pgFindUserByIdentity(input);
}
async function saveIdentity(user: any, patch: Record<string, any>): Promise<any> {
    Object.assign(user, patch);
    await pgUpdateUser(String(user._id), patch);
    return user;
}
async function slugExists(slug: string): Promise<boolean> {
    return pgUserSlugExists(slug);
}
async function createIdentity(input: Record<string, any>): Promise<any> {
    const id = newPublicUserId();
    let user: any;
    user = await pgCreateUser({ ...input, id } as any);
    return user;
}
// Local email/password strategy
passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
}, async (email: string, password: string, done) => {
    try {
        const user = await findIdentity({ email });
        if (!user) {
            return done(null, false, { message: 'No user found with this email' });
        }
        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return done(null, false, { message: 'Invalid password' });
        }
        // Update last login
        await saveIdentity(user, { lastLoginAt: new Date() });
        return done(null, user);
    }
    catch (error) {
        return done(error);
    }
}));
// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    // CRITICAL: Use callback URL from environment variable or production domain as fallback
    // This allows different domains for dev/test/production environments
    // Google Console MUST have EXACTLY this URL registered as a valid redirect URI
    //
    // Set GOOGLE_CALLBACK_URL to the exact URL registered in Google Console.
    // Example: GOOGLE_CALLBACK_URL=https://themegaradio.com/api/auth/google/callback
    const callbackURL = googleOAuthCallbackUrl();
    console.log('🔐 Google OAuth configured with callback URL:', callbackURL);
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL,
        passReqToCallback: false // Standard OAuth2 flow
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            console.log('🔐 Google OAuth callback received for:', profile.displayName, profile.emails?.[0]?.value);
            console.log('🔐 Google OAuth profile photo captured:', profile.photos?.[0]?.value ? 'Yes' : 'No');
            // Check if user already exists with this Google ID
            let user = await findIdentity({ googleId: profile.id });
            if (user) {
                // Update last login AND avatar (always refresh from Google profile)
                const googleAvatar = profile.photos?.[0]?.value;
                user.lastLoginAt = new Date();
                if (googleAvatar && !user.avatar) {
                    (user as any).avatar = googleAvatar;
                }
                // Backfill fullName from Google if DB record has none (handles accounts
                // created before this guard existed, or where displayName was empty at
                // registration time — avoids showing the generated user_<id> username).
                if (!user.fullName && profile.displayName) {
                    user.fullName = profile.displayName;
                }
                await saveIdentity(user, {
                    lastLoginAt: user.lastLoginAt, avatar: user.avatar, fullName: user.fullName,
                });
                return done(null, user);
            }
            // Check if user exists with same email
            user = await findIdentity({ email: profile.emails?.[0]?.value });
            if (user) {
                // Link Google account to existing user, set avatar if not already set
                const googleAvatar = profile.photos?.[0]?.value;
                user.googleId = profile.id;
                user.lastLoginAt = new Date();
                if (googleAvatar && !(user as any).avatar) {
                    (user as any).avatar = googleAvatar;
                }
                if (!user.fullName && profile.displayName) {
                    user.fullName = profile.displayName;
                }
                await saveIdentity(user, {
                    googleId: user.googleId, lastLoginAt: user.lastLoginAt,
                    avatar: user.avatar, fullName: user.fullName,
                });
                return done(null, user);
            }
            console.log('🆕 Creating new Google user:', profile.emails?.[0]?.value);
            // Generate slug for new Google user
            const generateSlugForOAuth = (displayName: string, email: string): string => {
                let slugSource = displayName || email.split('@')[0];
                return slugSource
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .trim()
                    .replace(/^-+|-+$/g, '');
            };
            const baseSlug = generateSlugForOAuth(profile.displayName, profile.emails?.[0]?.value || '');
            let userSlug = baseSlug;
            let counter = 1;
            // Check for slug uniqueness (simple check for OAuth)
            while (await slugExists(userSlug)) {
                userSlug = `${baseSlug}-${counter}`;
                counter++;
            }
            // Create new user — fullName prefers Google displayName, falls back to
            // the email username part so we never end up with an empty fullName that
            // forces the UI to show the generated user_<id> username string.
            const emailForName = profile.emails?.[0]?.value || `google-${profile.id}@oauth.invalid`;
            const derivedFullName = profile.displayName || emailForName.split('@')[0] || '';
            const newUser = await createIdentity({
                googleId: profile.id,
                email: emailForName,
                fullName: derivedFullName,
                avatar: profile.photos?.[0]?.value,
                username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                slug: userSlug, // Add automatic slug for Google users
                passwordHash: '', // No password for OAuth users
                emailVerified: true, // Google accounts are pre-verified
                lastLoginAt: new Date()
            });
            console.log(`✅ New Google user created with slug: "${userSlug}" (${newUser.email})`);
            return done(null, newUser);
        }
        catch (error) {
            console.error('❌ Google OAuth error:', error);
            return done(error);
        }
    }));
}
// Facebook OAuth Strategy
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: "/api/auth/facebook/callback",
        profileFields: ['id', 'displayName', 'photos', 'email']
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            console.log('🔐 Facebook OAuth callback received for:', profile.displayName, profile.emails?.[0]?.value);
            console.log('🔐 Facebook OAuth profile photo captured:', profile.photos?.[0]?.value ? 'Yes' : 'No');
            // Check if user already exists with this Facebook ID
            let user = await findIdentity({ facebookId: profile.id });
            if (user) {
                user.lastLoginAt = new Date();
                if (!user.fullName && profile.displayName) {
                    user.fullName = profile.displayName;
                }
                await saveIdentity(user, { lastLoginAt: user.lastLoginAt, fullName: user.fullName });
                return done(null, user);
            }
            // Check if user exists with same email
            user = await findIdentity({ email: profile.emails?.[0]?.value });
            if (user) {
                user.facebookId = profile.id;
                user.lastLoginAt = new Date();
                if (!user.fullName && profile.displayName) {
                    user.fullName = profile.displayName;
                }
                await saveIdentity(user, {
                    facebookId: user.facebookId, lastLoginAt: user.lastLoginAt, fullName: user.fullName,
                });
                return done(null, user);
            }
            // Generate slug for new Facebook user
            const generateSlugForOAuth = (displayName: string, email: string): string => {
                let slugSource = displayName || email.split('@')[0];
                return slugSource
                    .toLowerCase()
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .trim()
                    .replace(/^-+|-+$/g, '');
            };
            const baseSlug = generateSlugForOAuth(profile.displayName, profile.emails?.[0]?.value || '');
            let userSlug = baseSlug;
            let counter = 1;
            // Check for slug uniqueness
            while (await slugExists(userSlug)) {
                userSlug = `${baseSlug}-${counter}`;
                counter++;
            }
            const fbEmail = profile.emails?.[0]?.value || `facebook-${profile.id}@oauth.invalid`;
            const fbFullName = profile.displayName || fbEmail.split('@')[0] || '';
            const newUser = await createIdentity({
                facebookId: profile.id,
                email: fbEmail,
                fullName: fbFullName,
                avatar: profile.photos?.[0]?.value,
                username: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                slug: userSlug, // Add automatic slug for Facebook users
                passwordHash: '',
                emailVerified: true,
                lastLoginAt: new Date()
            });
            console.log(`✅ New Facebook user created with slug: "${userSlug}" (${newUser.email})`);
            return done(null, newUser);
        }
        catch (error) {
            return done(error);
        }
    }));
}
if (process.env.APPLE_CLIENT_ID || process.env.APPLE_SERVICE_ID) {
    console.log('🍎 Apple Sign-In configured (web OAuth flow via jose JWT)');
}
else {
    console.log('⚠️ Apple Sign-In not configured (missing APPLE_CLIENT_ID/APPLE_SERVICE_ID)');
}
// Serialize/deserialize user for session management
passport.serializeUser((user: any, done) => {
    done(null, user._id);
});
passport.deserializeUser(async (id: string, done) => {
    try {
        {
            return done(null, await pgFindUserById(String(id)));
        }
    }
    catch (error) {
        done(error);
    }
});
export default passport;
