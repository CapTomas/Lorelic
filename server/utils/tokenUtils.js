import crypto from 'crypto';

/**
 * Generates a cryptographically secure random token.
 * @param {number} [length=32] - The desired length of the token string.
 * @returns {string} A random hex string.
 */
export function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generates an expiration date for a token.
 * @param {number} [minutesToExpire=60] - How many minutes from now the token should expire.
 * @returns {Date} The expiration date.
 */
export function generateTokenExpiry(minutesToExpire = 60) {
  return new Date(Date.now() + minutesToExpire * 60 * 1000);
}
