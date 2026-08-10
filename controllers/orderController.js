const crypto = require("crypto");
const axios = require("axios");
const Order = require("../models/Order");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";

// ── POST /api/orders — place order + init Paystack payment ──────────────────
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

  const order = await Order.create({
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
    status: "pending_payment",
  });

  console.log(`[ORDER] Created ${orderId} — ₦${total.toLocaleString()}`);

  // ── Init Paystack transaction ────────────────────────────────────────────
  let paystackData = null;
  if (PAYSTACK_SECRET) {
    try {
      const { data } = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: order.customer.email,
          amount: total * 100, // Paystack uses kobo
          reference: orderId,
          metadata: {
            orderId,
            name: `${order.customer.firstName} ${order.customer.lastName}`,
          },
          callback_url: `${process.env.CLIENT_URL || "http://localhost:3000"}/confirmation?orderId=${orderId}`,
        },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
      );
      paystackData = data.data; // { authorization_url, access_code, reference }
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
    message: "Order placed. Proceed to payment.",
    paystack: paystackData,
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
  const secret = PAYSTACK_SECRET;
  if (!secret) return res.sendStatus(200); // no-op if not configured

  // Verify Paystack signature
  const hash = crypto
    .createHmac("sha512", secret)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.sendStatus(400);
  }

  const { event, data } = req.body;

  if (event === "charge.success") {
    const order = await Order.findOne({ orderId: data.reference });
    if (order && order.status !== "paid") {
      order.status = "paid";
      order.paystackRef = data.reference;
      order.paystackChannel = data.channel;
      order.paidAt = new Date();
      await order.save();

      console.log(`[PAYSTACK] Payment confirmed: ${order.orderId}`);

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
  }

  res.sendStatus(200);
}

// ── PATCH /api/orders/:id/status (admin manual override) ────────────────────
async function updateOrderStatus(req, res) {
  const { status } = req.body;
  const valid = ["pending_payment", "paid", "failed", "refunded"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ error: "Order not found" });

  order.status = status;
  if (status === "paid" && !order.paidAt) order.paidAt = new Date();
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
  paystackWebhook,
  updateOrderStatus,
};
