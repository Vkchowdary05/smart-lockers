const crypto = require('crypto');

/**
 * Generate a cryptographically secure temporary password.
 * Mirrors Python's _generate_temp_password() in super_admin_routes.py
 * Format: >=12 chars with upper, lower, digit, special guaranteed.
 */
function generateTempPassword(length = 12) {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const digits  = '0123456789';
  const special = '!@#$%&*';
  const all     = upper + lower + digits + special;

  const pick = (charset) => charset[crypto.randomInt(0, charset.length)];
  const pw = [
    pick(upper),
    pick(lower),
    pick(digits),
    pick(special),
    ...Array.from({ length: length - 4 }, () => pick(all)),
  ];

  // Fisher-Yates shuffle
  for (let i = pw.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }

  return pw.join('');
}

module.exports = { generateTempPassword };
