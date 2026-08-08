const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "beachbash_dev_secret";
const JWT_EXPIRES_IN = "7d";

// ── Helpers ──────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

// ── POST /api/auth/register ──────────────────────────────────────────────────
async function register(req, res) {
  const { firstName, lastName, email, password, phone } = req.body;

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

  const exists = await User.findOne({ email: email.toLowerCase().trim() });
  if (exists) {
    return res
      .status(409)
      .json({ error: "An account with that email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.toLowerCase().trim(),
    phone: phone?.trim() || "",
    passwordHash,
  });

  const token = signToken(user);
  console.log(`[AUTH] Registered: ${user.email}`);
  return res.status(201).json({ token, user: user.toSafe() });
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user);
  console.log(`[AUTH] Login: ${user.email}`);
  return res.json({ token, user: user.toSafe() });
}

// ── POST /api/auth/logout ────────────────────────────────────────────────────
function logout(req, res) {
  console.log(`[AUTH] Logout: ${req.user?.id}`);
  return res.json({ message: "Logged out successfully" });
}

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
async function me(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user: user.toSafe() });
}

module.exports = { register, login, logout, me };
