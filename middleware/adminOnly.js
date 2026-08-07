const ADMIN_SECRET = process.env.ADMIN_SECRET || "beachbash_admin_2026";

/**
 * Simple admin gate — checks for x-admin-secret header.
 * For a production app, replace with a proper admin role on the JWT.
 */
function adminOnly(req, res, next) {
  const secret = req.headers["x-admin-secret"];
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = adminOnly;
