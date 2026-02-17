import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

/**
 * Configure Passport with OAuth strategies
 * @param {string} callbackBaseUrl - Base URL for OAuth callbacks (e.g., http://localhost:4100 or tunnel URL)
 */
export function configurePassport(callbackBaseUrl) {
  // GitHub OAuth Strategy
  if (process.env.OAUTH_GITHUB_CLIENT_ID && process.env.OAUTH_GITHUB_CLIENT_SECRET) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: process.env.OAUTH_GITHUB_CLIENT_ID,
          clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET,
          callbackURL: `${callbackBaseUrl}/auth/github/callback`,
          scope: ['user:email']
        },
        (accessToken, refreshToken, profile, done) => {
          // Extract email from profile
          const email = profile.emails?.[0]?.value || `${profile.username}@github.local`;

          // Normalize user object
          const user = {
            id: `github:${profile.id}`,
            email,
            name: profile.displayName || profile.username,
            provider: 'github',
            avatar: profile.photos?.[0]?.value || null
          };

          return done(null, user);
        }
      )
    );
  }

  // Google OAuth Strategy
  if (process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.OAUTH_GOOGLE_CLIENT_ID,
          clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET,
          callbackURL: `${callbackBaseUrl}/auth/google/callback`,
          scope: ['profile', 'email']
        },
        (accessToken, refreshToken, profile, done) => {
          // Extract email from profile
          const email = profile.emails?.[0]?.value || `${profile.id}@google.local`;

          // Normalize user object
          const user = {
            id: `google:${profile.id}`,
            email,
            name: profile.displayName,
            provider: 'google',
            avatar: profile.photos?.[0]?.value || null
          };

          return done(null, user);
        }
      )
    );
  }

  // Serialize and deserialize user (required by Passport even for stateless sessions)
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user));
}

/**
 * Get list of enabled OAuth providers based on environment variables
 * @returns {string[]} Array of provider names (e.g., ['github', 'google'])
 */
export function getEnabledProviders() {
  const providers = [];

  if (process.env.OAUTH_GITHUB_CLIENT_ID && process.env.OAUTH_GITHUB_CLIENT_SECRET) {
    providers.push('github');
  }

  if (process.env.OAUTH_GOOGLE_CLIENT_ID && process.env.OAUTH_GOOGLE_CLIENT_SECRET) {
    providers.push('google');
  }

  return providers;
}
