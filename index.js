require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

// In-memory order store (replace with a DB later)
const orders = [];

// ── Auth routes ──────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Health check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "BEACHBASH API running 🏖️" });
});

// ── GET /api/orders — list all orders ───────────────────────────────────────
app.get("/api/orders", (req, res) => {
  res.json({ orders });
});

// ── POST /api/orders — place a new order ────────────────────────────────────
app.post("/api/orders", (req, res) => {
  const { customer, tickets, total } = req.body;

  // Basic validation
  if (
    !customer ||
    !tickets ||
    !Array.isArray(tickets) ||
    tickets.length === 0
  ) {
    return res.status(400).json({ error: "Invalid order payload" });
  }

  const requiredFields = ["firstName", "lastName", "email", "phone"];
  for (const field of requiredFields) {
    if (!customer[field] || !String(customer[field]).trim()) {
      return res
        .status(400)
        .json({ error: `Missing customer field: ${field}` });
    }
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(customer.email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  // Generate order ID
  const orderId = `BB-${Date.now().toString(36).toUpperCase()}`;

  const order = {
    orderId,
    customer: {
      firstName: customer.firstName.trim(),
      lastName: customer.lastName.trim(),
      email: customer.email.trim().toLowerCase(),
      phone: customer.phone.trim(),
    },
    tickets,
    total,
    status: "pending_payment",
    createdAt: new Date().toISOString(),
  };

  orders.push(order);

  console.log(
    `[ORDER] New order placed: ${orderId} — ₦${total.toLocaleString()} — ${customer.email}`,
  );

  res.status(201).json({
    orderId,
    message:
      "Order placed successfully. Payment details will be sent to your email.",
    status: "pending_payment",
  });
});

// ── GET /api/orders/:id — get order by ID ───────────────────────────────────
app.get("/api/orders/:id", (req, res) => {
  const order = orders.find((o) => o.orderId === req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }
  res.json({ order });
});

// ── 404 fallback ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`🏖️  BEACHBASH API running on http://localhost:${PORT}`);
});
