/**
 * Password policy — mirrors password_routes.py _validate_password()
 * >=8 chars, 1 upper, 1 lower, 1 digit, 1 special
 */
function validatePassword(password) {
  if (!password || password.length < 8)
    return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password))
    return 'Password must contain at least 1 uppercase letter.';
  if (!/[a-z]/.test(password))
    return 'Password must contain at least 1 lowercase letter.';
  if (!/[0-9]/.test(password))
    return 'Password must contain at least 1 digit.';
  if (!/[^A-Za-z0-9]/.test(password))
    return 'Password must contain at least 1 special character.';
  return null; // valid
}

module.exports = { validatePassword };
