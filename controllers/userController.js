const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Order = require("../models/Order");

// ── GET /api/users — list all users ─────────────────────────────────────────
async function listUsers(req, res) {
  const users = await User.find()
    .sort({ createdAt: -1 })
    .select("-passwordHash");
  res.json({ users: users.map((u) => u.toSafe()) });
}

// ── GET /api/users/all — registered users + guest buyers merged ──────────────
async function listAllPeople(req, res) {
  // 1. All registered users
  const users = await User.find().select("-passwordHash").lean();
  // 2. All paid orders
  const orders = await Order.find({ status: "paid" }).lean();

  // Build a map email → order(s)
  const ordersByEmail = {};
  for (const o of orders) {
    const email = o.customer.email.toLowerCase();
    if (!ordersByEmail[email]) ordersByEmail[email] = [];
    ordersByEmail[email].push(o);
  }

  // Merge registered users with their orders
  const registeredEmails = new Set();
  const people = users.map((u) => {
    const email = u.email.toLowerCase();
    registeredEmails.add(email);
    const userOrders = ordersByEmail[email] || [];
    return {
      id: u._id.toString(),
      type: "registered",
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      phone: u.phone || "",
      role: u.role,
      createdAt: u.createdAt,
      hasTicket: userOrders.length > 0,
      checkedIn: userOrders.some((o) => o.checkedIn),
      orders: userOrders.map((o) => ({
        orderId: o.orderId,
        tickets: o.tickets,
        total: o.total,
        paidAt: o.paidAt,
        checkedIn: o.checkedIn,
        checkedInAt: o.checkedInAt,
      })),
    };
  });

  // Add guest buyers (ordered but never registered)
  for (const o of orders) {
    const email = o.customer.email.toLowerCase();
    if (registeredEmails.has(email)) continue; // already included

    // Check if we already added this guest email
    const already = people.find((p) => p.email === email && p.type === "guest");
    if (already) {
      already.orders.push({
        orderId: o.orderId,
        tickets: o.tickets,
        total: o.total,
        paidAt: o.paidAt,
        checkedIn: o.checkedIn,
        checkedInAt: o.checkedInAt,
      });
      if (o.checkedIn) already.checkedIn = true;
      continue;
    }

    people.push({
      id: `guest_${o.customer.email}`,
      type: "guest",
      firstName: o.customer.firstName,
      lastName: o.customer.lastName,
      email: o.customer.email,
      phone: o.customer.phone || "",
      role: "guest",
      createdAt: o.createdAt,
      hasTicket: true,
      checkedIn: o.checkedIn,
      orders: [
        {
          orderId: o.orderId,
          tickets: o.tickets,
          total: o.total,
          paidAt: o.paidAt,
          checkedIn: o.checkedIn,
          checkedInAt: o.checkedInAt,
        },
      ],
    });
  }

  // Sort: registered first, then guests; within each by createdAt desc
  people.sort((a, b) => {
    if (a.type !== b.type) return a.type === "registered" ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  res.json({ people, total: people.length });
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

module.exports = {
  listUsers,
  listAllPeople,
  getUser,
  createUser,
  updateUser,
  deleteUser,
};
