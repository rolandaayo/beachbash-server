const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "beachbash_dev_secret";
const JWT_EXPIRES_IN = "7d";

// In-memory user store (replace with a DB later)
const users = [];

// ── Helper: generate token ───────────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// ── Helper: safe user shape (no passwordHash) ────────────────────────────────
function safeUser(user) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  };
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
async function register(req, res) {
  const { firstName, lastName, email, password } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: "All fields are required" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (users.find((u) => u.email === normalizedEmail)) {
    return res
      .status(409)
      .json({ error: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = {
    id: `USR-${Date.now().toString(36).toUpperCase()}`,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  users.push(user);

  const token = signToken(user.id);

  console.log(`[AUTH] New user registered: ${user.email} (${user.id})`);

  return res.status(201).json({ token, user: safeUser(user) });
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = users.find((u) => u.email === normalizedEmail);

  // Intentionally vague error to avoid user enumeration
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user.id);

  console.log(`[AUTH] User logged in: ${user.email}`);

  return res.json({ token, user: safeUser(user) });
}

// ── POST /api/auth/logout ────────────────────────────────────────────────────
// JWT is stateless — logout is handled client-side by discarding the token.
// This endpoint exists as a clean API contract and for future token-blocklist support.
function logout(req, res) {
  console.log(`[AUTH] Logout: ${req.user?.id}`);
  return res.json({ message: "Logged out successfully" });
}

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
function me(req, res) {
  // req.user.id is set by authenticate middleware
  const user = users.find((u) => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  return res.json({ user: safeUser(user) });
}

module.exports = { register, login, logout, me };
