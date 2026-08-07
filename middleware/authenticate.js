const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "beachbash_dev_secret";

/**
 * Middleware that verifies a Bearer JWT and attaches req.user.
 * Returns 401 if the token is missing or invalid.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Attach a minimal user object; controllers can enrich this as needed
    req.user = { id: payload.userId };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = authenticate;
