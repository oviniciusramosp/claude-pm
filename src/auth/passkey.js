import { generateToken } from './jwt.js';

/**
 * Check if passkey authentication is enabled
 * @returns {boolean}
 */
export function isPasskeyEnabled() {
  return Boolean(process.env.AUTH_PASSKEY);
}

/**
 * Verify a passkey against the configured value
 * @param {string} passkey - Passkey to verify
 * @returns {boolean}
 */
export function verifyPasskey(passkey) {
  const configuredPasskey = process.env.AUTH_PASSKEY;

  if (!configuredPasskey) {
    return false;
  }

  return passkey === configuredPasskey;
}

/**
 * Generate a JWT token for passkey authentication
 * @returns {string}
 */
export function generatePasskeyToken() {
  // Create a generic user object for passkey auth
  const user = {
    id: 'passkey:user',
    email: 'passkey@local',
    name: 'Authenticated User',
    provider: 'passkey',
    avatar: null
  };

  return generateToken(user);
}
