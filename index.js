require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "";

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log(`[SOCKET] connected: ${socket.id}`);

  // User joins their personal room to receive admin replies
  socket.on("join_user", (userId) => {
    socket.join(`user_${userId}`);
    console.log(`[SOCKET] user joined room: user_${userId}`);
  });

  // Admin joins the admin room to receive all new messages
  socket.on("join_admin", () => {
    socket.join("admin");
    console.log(`[SOCKET] admin joined`);
  });

  socket.on("disconnect", () => {
    console.log(`[SOCKET] disconnected: ${socket.id}`);
  });
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "BEACHBASH API running 🏖️" });
});

// ── In-memory order store (replace with DB later) ─────────────────────────────
const orders = [];

app.get("/api/orders", (req, res) => {
  res.json({ orders });
});

app.post("/api/orders", (req, res) => {
  const { customer, tickets, total } = req.body;

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

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(customer.email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

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
    `[ORDER] ${orderId} — ₦${total.toLocaleString()} — ${customer.email}`,
  );

  res.status(201).json({
    orderId,
    message:
      "Order placed successfully. Payment details will be sent to your email.",
    status: "pending_payment",
  });
});

app.get("/api/orders/:id", (req, res) => {
  const order = orders.find((o) => o.orderId === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order });
});

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  if (MONGO_URI) {
    try {
      await mongoose.connect(MONGO_URI);
      console.log("🍃 MongoDB connected");
    } catch (err) {
      console.error("MongoDB connection error:", err.message);
    }
  } else {
    console.warn("⚠️  MONGO_URI not set — chat persistence disabled");
  }

  server.listen(PORT, () => {
    console.log(`🏖️  BEACHBASH API running on http://localhost:${PORT}`);
  });
}

start();
