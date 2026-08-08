const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "beachbash_dev_secret";

/**
 * Like authenticate, but doesn't reject if no token is present.
 * Attaches req.user if a valid token is provided, otherwise leaves it undefined.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
    req.user = {
      id: payload.userId,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: payload.role,
    };
  } catch {
    // invalid token — just continue as guest
  }
  next();
}

module.exports = optionalAuth;
