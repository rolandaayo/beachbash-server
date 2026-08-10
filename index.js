require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const authRoutes = require("./routes/auth");
const chatRoutes = require("./routes/chat");
const userRoutes = require("./routes/users");
const orderRoutes = require("./routes/orders");
const { paystackWebhook } = require("./controllers/orderController");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || "";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const ALLOWED_ORIGINS = [
  CLIENT_URL,
  "https://www.beachbashparty.com",
  "https://beachbashparty.com",
  "http://localhost:3000",
].filter(Boolean);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
app.set("io", io);

io.on("connection", (socket) => {
  socket.on("join_user", (userId) => socket.join(`user_${userId}`));
  socket.on("join_admin", () => socket.join("admin"));
});

// ── Paystack webhook — must be BEFORE express.json() to get raw body ─────────
app.post(
  "/api/orders/paystack/webhook",
  express.raw({ type: "application/json" }),
  paystackWebhook,
);

// ── Global middleware ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/users", userRoutes);
app.use("/api/orders", orderRoutes);

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) =>
  res.json({ status: "ok", message: "BEACHBASH API 🏖️" }),
);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  if (MONGO_URI) {
    try {
      await mongoose.connect(MONGO_URI);
      console.log("🍃 MongoDB connected");
    } catch (err) {
      console.error("MongoDB error:", err.message);
    }
  } else {
    console.warn("⚠️  MONGO_URI not set — persistence disabled");
  }
  server.listen(PORT, () =>
    console.log(`🏖️  BEACHBASH API on http://localhost:${PORT}`),
  );
}

start();
