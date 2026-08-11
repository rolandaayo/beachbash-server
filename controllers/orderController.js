const crypto = require("crypto");
const axios = require("axios");
const Order = require("../models/Order");
const { sendTicketEmail } = require("../lib/mailer");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";

// ── Temporary in-memory store for pending (unpaid) orders ────────────────────
// Keyed by orderId (Paystack reference). Entries are removed after 2 hours or
// when the webhook confirms payment. Nothing touches MongoDB until payment succeeds.
const pendingOrders = new Map();
const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── POST /api/orders — init Paystack, hold data in memory only ───────────────
async function createOrder(req, res) {
  const { customer, tickets, total } = req.body;

  if (
    !customer ||
    !tickets ||
    !Array.isArray(tickets) ||
    tickets.length === 0
  ) {
    return res.status(400).json({ error: "Invalid order payload" });
  }

  const required = ["firstName", "lastName", "email", "phone"];
  for (const f of required) {
    if (!customer[f] || !String(customer[f]).trim()) {
      return res.status(400).json({ error: `Missing field: ${f}` });
    }
  }

  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRx.test(customer.email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  const orderId = `BB-${Date.now().toString(36).toUpperCase()}`;
  const userId = req.user?.id || null;

  const orderData = {
    orderId,
    userId,
    customer: {
      firstName: customer.firstName.trim(),
      lastName: customer.lastName.trim(),
      email: customer.email.trim().toLowerCase(),
      phone: customer.phone.trim(),
    },
    tickets,
    total,
    createdAt: new Date().toISOString(),
  };

  // Save to DB immediately as pending_payment
  // Webhook will update to 'paid' in production
  // On localhost, client onSuccess calls PATCH /status manually
  await Order.create({
    orderId,
    userId,
    customer: orderData.customer,
    tickets,
    total,
    status: "pending_payment",
  });

  // Also keep in memory for webhook lookup
  pendingOrders.set(orderId, orderData);
  setTimeout(() => pendingOrders.delete(orderId), PENDING_TTL_MS);

  console.log(`[ORDER] Created: ${orderId} — ₦${total.toLocaleString()}`);

  // ── Init Paystack transaction ────────────────────────────────────────────
  let paystackData = null;
  if (PAYSTACK_SECRET) {
    try {
      const { data } = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: orderData.customer.email,
          amount: total * 100,
          reference: orderId,
          metadata: {
            orderId,
            name: `${orderData.customer.firstName} ${orderData.customer.lastName}`,
          },
          callback_url: `${process.env.CLIENT_URL || "http://localhost:3000"}/confirmation?orderId=${orderId}&paid=1`,
        },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
      );
      paystackData = data.data;
      console.log(`[PAYSTACK] Init OK: ${orderId}`);
    } catch (err) {
      console.error(
        "[PAYSTACK] Init failed:",
        err.response?.data || err.message,
      );
    }
  }

  res.status(201).json({
    orderId,
    status: "pending_payment",
    message: "Payment initialised. Awaiting confirmation.",
    paystack: paystackData,
  });
}

// ── GET /api/orders/ticket/:id — public scan page endpoint ──────────────────
async function getTicketPublic(req, res) {
  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) {
    return res.status(404).json({ error: "Ticket not found" });
  }
  if (order.status !== "paid") {
    return res
      .status(402)
      .json({ error: "Payment not yet confirmed", status: order.status });
  }
  res.json({
    valid: true,
    orderId: order.orderId,
    firstName: order.customer.firstName,
    lastName: order.customer.lastName,
    email: order.customer.email,
    phone: order.customer.phone,
    tickets: order.tickets.map((t) => ({
      name: t.name,
      quantity: t.quantity,
      price: t.price,
      total: t.price * t.quantity,
    })),
    total: order.total,
    paidAt: order.paidAt,
    checkedIn: order.checkedIn,
    checkedInAt: order.checkedInAt,
  });
}

// ── GET /api/orders — list all orders (admin) ────────────────────────────────
async function listOrders(req, res) {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json({ orders });
}

// ── GET /api/orders/:id ──────────────────────────────────────────────────────
async function getOrder(req, res) {
  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order });
}

// ── POST /api/orders/paystack/webhook ────────────────────────────────────────
async function paystackWebhook(req, res) {
  if (!PAYSTACK_SECRET) return res.sendStatus(200);

  // Verify Paystack HMAC signature
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.sendStatus(400);
  }

  const { event, data } = req.body;

  if (event === "charge.success") {
    const reference = data.reference;

    // Avoid double-processing
    const existing = await Order.findOne({ orderId: reference });
    if (existing && existing.status === "paid") {
      console.log(`[PAYSTACK] Already paid: ${reference}`);
      return res.sendStatus(200);
    }

    // If order exists (saved on creation), update it to paid
    if (existing) {
      existing.status = "paid";
      existing.paystackRef = reference;
      existing.paystackChannel = data.channel;
      existing.paidAt = new Date();
      await existing.save();
      const order = existing;

      pendingOrders.delete(reference);
      console.log(`[PAYSTACK] Payment confirmed (updated): ${order.orderId}`);
      sendTicketEmail(order).catch((err) =>
        console.error("[MAIL] Ticket email failed:", err.message),
      );
      const io = req.app.get("io");
      if (io) {
        io.to("admin").emit("order_paid", {
          orderId: order.orderId,
          total: order.total,
          customer: order.customer,
          paidAt: order.paidAt,
          paystackRef: order.paystackRef,
        });
      }
      return res.sendStatus(200);
    }

    // Fallback: order not in DB yet — create from pending memory or webhook data
    const pending = pendingOrders.get(reference);

    if (!pending) {
      // Shouldn't happen in normal flow, but handle gracefully
      console.warn(
        `[PAYSTACK] No pending data for: ${reference} — creating from webhook`,
      );
    }

    // Build order from pending data or fall back to webhook metadata
    const orderPayload = pending || {
      orderId: reference,
      userId: null,
      customer: {
        firstName: data.metadata?.name?.split(" ")[0] || "Unknown",
        lastName: data.metadata?.name?.split(" ").slice(1).join(" ") || "",
        email: data.customer?.email || "",
        phone: "",
      },
      tickets: [],
      total: data.amount / 100,
      createdAt: new Date().toISOString(),
    };

    // NOW save to MongoDB — only on successful payment
    const order = await Order.create({
      orderId: orderPayload.orderId,
      userId: orderPayload.userId,
      customer: orderPayload.customer,
      tickets: orderPayload.tickets,
      total: orderPayload.total,
      status: "paid",
      paystackRef: reference,
      paystackChannel: data.channel,
      paidAt: new Date(),
    });

    // Clean up memory
    pendingOrders.delete(reference);

    console.log(`[PAYSTACK] Payment confirmed & order saved: ${order.orderId}`);

    // Send QR ticket email (fire-and-forget)
    sendTicketEmail(order).catch((err) =>
      console.error("[MAIL] Ticket email failed:", err.message),
    );

    // Push to admin via Socket.io
    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("order_paid", {
        orderId: order.orderId,
        total: order.total,
        customer: order.customer,
        paidAt: order.paidAt,
        paystackRef: order.paystackRef,
      });
    }
  }

  res.sendStatus(200);
}

// ── PATCH /api/orders/:id/checkin (admin) ───────────────────────────────────
async function checkInOrder(req, res) {
  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status !== "paid")
    return res.status(400).json({ error: "Order is not paid" });

  order.checkedIn = !order.checkedIn; // toggle
  order.checkedInAt = order.checkedIn ? new Date() : null;
  await order.save();

  res.json({
    orderId: order.orderId,
    checkedIn: order.checkedIn,
    checkedInAt: order.checkedInAt,
  });
}

// ── DELETE /api/orders/:id (admin) ──────────────────────────────────────────
async function deleteOrder(req, res) {
  const order = await Order.findOneAndDelete({ orderId: req.params.id });
  if (!order) return res.status(404).json({ error: "Order not found" });
  console.log(`[ORDER] Deleted ${req.params.id}`);
  res.json({ message: "Order deleted", orderId: req.params.id });
}

// ── PATCH /api/orders/:id/status (admin manual override) ────────────────────
async function updateOrderStatus(req, res) {
  const { status, paystackRef } = req.body;
  const valid = ["pending_payment", "paid", "failed", "refunded"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ error: "Order not found" });

  order.status = status;
  if (status === "paid" && !order.paidAt) order.paidAt = new Date();
  if (paystackRef) order.paystackRef = paystackRef;
  await order.save();

  if (status === "paid") {
    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("order_paid", {
        orderId: order.orderId,
        total: order.total,
        customer: order.customer,
        paidAt: order.paidAt,
        paystackRef: order.paystackRef,
      });
    }
  }

  res.json({ order });
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  getTicketPublic,
  paystackWebhook,
  updateOrderStatus,
  checkInOrder,
  deleteOrder,
};
