import { verifyToken } from './jwt.js';

/**
 * Middleware to require authentication
 * Only enforces auth when in public mode
 * @param {boolean} isPublicMode - Whether the server is running in public mode
 * @returns {Function} Express middleware
 */
export function requireAuth(isPublicMode) {
  return (req, res, next) => {
    // Skip auth check in local mode
    if (!isPublicMode) {
      return next();
    }

    // Check for JWT in cookie
    const token = req.cookies?.pm_auth_token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Verify token
    const user = verifyToken(token);
    if (!user) {
      res.clearCookie('pm_auth_token');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Optional: check email whitelist
    if (process.env.AUTH_ALLOWED_EMAILS) {
      const allowedEmails = process.env.AUTH_ALLOWED_EMAILS.split(',').map((e) => e.trim());
      if (!allowedEmails.includes(user.email)) {
        return res.status(403).json({ error: 'Your email is not authorized to access this panel' });
      }
    }

    // Attach user to request
    req.user = user;
    next();
  };
}

/**
 * Middleware to optionally attach user if authenticated
 * Does not block if not authenticated
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
export function optionalAuth(req, res, next) {
  const token = req.cookies?.pm_auth_token;
  if (token) {
    const user = verifyToken(token);
    if (user) {
      req.user = user;
    }
  }
  next();
}
