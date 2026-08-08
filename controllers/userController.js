const bcrypt = require("bcryptjs");
const User = require("../models/User");

// ── GET /api/users — list all users ─────────────────────────────────────────
async function listUsers(req, res) {
  const users = await User.find()
    .sort({ createdAt: -1 })
    .select("-passwordHash");
  res.json({ users: users.map((u) => u.toSafe()) });
}

// ── GET /api/users/:id — get single user ────────────────────────────────────
async function getUser(req, res) {
  const user = await User.findById(req.params.id).select("-passwordHash");
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: user.toSafe() });
}

// ── POST /api/users — create user (admin) ───────────────────────────────────
async function createUser(req, res) {
  const { firstName, lastName, email, password, phone, role } = req.body;

  if (!firstName || !lastName || !email || !password) {
    return res
      .status(400)
      .json({ error: "firstName, lastName, email, password required" });
  }

  const exists = await User.findOne({ email: email.toLowerCase().trim() });
  if (exists) return res.status(409).json({ error: "Email already in use" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: email.toLowerCase().trim(),
    phone: phone?.trim() || "",
    role: role === "admin" ? "admin" : "user",
    passwordHash,
  });

  res.status(201).json({ user: user.toSafe() });
}

// ── PATCH /api/users/:id — update user ──────────────────────────────────────
async function updateUser(req, res) {
  const { firstName, lastName, phone, email, role, password } = req.body;

  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (firstName) user.firstName = firstName.trim();
  if (lastName) user.lastName = lastName.trim();
  if (phone) user.phone = phone.trim();
  if (role && ["user", "admin"].includes(role)) user.role = role;
  if (email) {
    const conflict = await User.findOne({
      email: email.toLowerCase().trim(),
      _id: { $ne: user._id },
    });
    if (conflict)
      return res.status(409).json({ error: "Email already in use" });
    user.email = email.toLowerCase().trim();
  }
  if (password) {
    if (password.length < 6)
      return res.status(400).json({ error: "Password too short" });
    user.passwordHash = await bcrypt.hash(password, 12);
  }

  await user.save();
  res.json({ user: user.toSafe() });
}

// ── DELETE /api/users/:id — delete user ─────────────────────────────────────
async function deleteUser(req, res) {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ message: "User deleted", id: req.params.id });
}

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser };
