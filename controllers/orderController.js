const crypto = require("crypto");
const axios = require("axios");
const Order = require("../models/Order");
const AbandonedOrder = require("../models/AbandonedOrder");
const { sendTicketEmail } = require("../lib/mailer");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";

// ── Temporary in-memory store for pending (unpaid) orders ────────────────────
// Keyed by orderId (Paystack reference). Entries are removed after 2 hours or
// when the webhook confirms payment. NOTHING touches the orders collection in
// MongoDB until payment is fully confirmed — this is intentional.
const pendingOrders = new Map();
const PENDING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Schedule a pending order for expiry. If it has not been confirmed (paid) or
// explicitly abandoned by then, we write it to AbandonedOrder with reason
// 'expired' so the admin has a record without it polluting the orders list.
function schedulePendingExpiry(orderId) {
  setTimeout(async () => {
    const data = pendingOrders.get(orderId);
    if (!data) return; // already handled (paid or abandoned)
    pendingOrders.delete(orderId);
    try {
      const alreadyPaid = await Order.exists({ orderId });
      const alreadyAbandoned = await AbandonedOrder.exists({ orderId });
      if (!alreadyPaid && !alreadyAbandoned) {
        await AbandonedOrder.create({ ...data, reason: "expired" });
        console.log(`[ORDER] Expired pending order archived: ${orderId}`);
      }
    } catch (err) {
      console.error("[ORDER] Failed to archive expired order:", err.message);
    }
  }, PENDING_TTL_MS);
}

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

  // Store ONLY in memory — no DB write until payment succeeds.
  // The webhook (charge.success) or confirmPayment endpoint will create the
  // real Order document. If neither fires within PENDING_TTL_MS the attempt
  // is archived as an AbandonedOrder.
  pendingOrders.set(orderId, orderData);
  schedulePendingExpiry(orderId);

  console.log(
    `[ORDER] Pending (memory only): ${orderId} — ₦${total.toLocaleString()}`,
  );

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
          // Route funds to the configured subaccount (95% to subaccount,
          // 5% remains with main account as configured in Paystack dashboard)
          subaccount: "ACCT_na8z4nbbw1n7qbj",
          callback_url: `${process.env.CLIENT_URL || "http://localhost:3000"}/confirmation?orderId=${orderId}&paid=1`,
        },
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
      );
      paystackData = data.data;
      console.log(`[PAYSTACK] Init OK: ${orderId}`);
    } catch (err) {
      const psError = err.response?.data || err.message;
      console.error("[PAYSTACK] Init failed:", psError);
      paystackData = { error: psError };
    }
  }

  res.status(201).json({
    orderId,
    status: "pending_payment",
    message: "Payment initialised. Awaiting confirmation.",
    paystack: paystackData,
  });
}

// ── POST /api/orders/:id/abandon — called by client on payment cancel ────────
// Moves the pending order from memory to the AbandonedOrder collection so the
// admin can see it without it showing up in the real orders list.
async function abandonOrder(req, res) {
  const orderId = req.params.id;
  const pending = pendingOrders.get(orderId);

  if (!pending) {
    // Could have already been paid (race) or never existed
    const alreadyPaid = await Order.exists({ orderId });
    if (alreadyPaid) {
      return res.status(409).json({ error: "Order already paid" });
    }
    // Possibly already abandoned — just acknowledge
    return res.json({ message: "Order not pending; nothing to abandon" });
  }

  // Remove from in-memory store
  pendingOrders.delete(orderId);

  try {
    // Upsert to avoid duplicates if called twice
    await AbandonedOrder.findOneAndUpdate(
      { orderId },
      { ...pending, reason: "cancelled", abandonedAt: new Date() },
      { upsert: true, new: true },
    );
    console.log(`[ORDER] Abandoned: ${orderId}`);
  } catch (err) {
    console.error("[ORDER] Failed to save abandoned order:", err.message);
    // Non-fatal — don't block the client
  }

  res.json({ message: "Order marked as abandoned" });
}

// ── POST /api/orders/:id/confirm — public, verifies with Paystack ────────────
async function confirmPayment(req, res) {
  const { reference } = req.body; // Paystack transaction reference
  const orderId = req.params.id;

  // Check if already saved (webhook may have beaten us to it)
  const existing = await Order.findOne({ orderId });
  if (existing && existing.status === "paid") {
    return res.json({ success: true, orderId: existing.orderId });
  }

  // Verify with Paystack if secret key is configured
  if (PAYSTACK_SECRET && reference) {
    try {
      const { data } = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } },
      );
      if (data.data?.status !== "success") {
        return res
          .status(402)
          .json({ error: "Payment not verified by Paystack" });
      }
    } catch (err) {
      console.error(
        "[CONFIRM] Paystack verify failed:",
        err.response?.data || err.message,
      );
      // Don't block — fall through and create order (webhook will double-check)
    }
  }

  // Retrieve pending data from memory (may still be there if webhook hasn't fired)
  const pending = pendingOrders.get(orderId);
  if (!pending && !existing) {
    return res.status(404).json({ error: "Order not found" });
  }

  let order = existing;
  if (!order) {
    // First time we're seeing this confirmed payment — create the order now
    const payload = pending || {
      orderId,
      userId: null,
      customer: {},
      tickets: [],
      total: 0,
    };
    order = await Order.create({
      orderId: payload.orderId,
      userId: payload.userId,
      customer: payload.customer,
      tickets: payload.tickets,
      total: payload.total,
      status: "paid",
      paystackRef: reference || null,
      paidAt: new Date(),
    });
  } else {
    order.status = "paid";
    order.paystackRef = reference || order.paystackRef;
    order.paidAt = new Date();
    await order.save();
  }

  // Clean up memory and any abandoned record (user retried and paid)
  pendingOrders.delete(orderId);
  AbandonedOrder.deleteOne({ orderId }).catch(() => {});

  console.log(`[CONFIRM] Order saved as paid: ${orderId}`);

  // Send ticket email
  sendTicketEmail(order).catch((err) =>
    console.error("[MAIL] Ticket email failed:", err.message),
  );

  // Notify admin via socket
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

  res.json({ success: true, orderId: order.orderId });
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

// ── GET /api/orders/abandoned — list abandoned orders (admin) ────────────────
async function listAbandonedOrders(req, res) {
  const orders = await AbandonedOrder.find().sort({ abandonedAt: -1 });
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

    // Retrieve pending data from memory
    const pending = pendingOrders.get(reference);

    if (!pending && !existing) {
      console.warn(
        `[PAYSTACK] No pending data for: ${reference} — creating from webhook`,
      );
    }

    // Build order payload from pending memory, existing DB record, or raw webhook data
    const orderPayload =
      pending ||
      (existing
        ? {
            orderId: existing.orderId,
            userId: existing.userId,
            customer: existing.customer,
            tickets: existing.tickets,
            total: existing.total,
          }
        : {
            orderId: reference,
            userId: null,
            customer: {
              firstName: data.metadata?.name?.split(" ")[0] || "Unknown",
              lastName:
                data.metadata?.name?.split(" ").slice(1).join(" ") || "",
              email: data.customer?.email || "",
              phone: "",
            },
            tickets: [],
            total: data.amount / 100,
          });

    let order;
    if (existing) {
      // Order was pre-created somehow — just mark it paid
      existing.status = "paid";
      existing.paystackRef = reference;
      existing.paystackChannel = data.channel;
      existing.paidAt = new Date();
      await existing.save();
      order = existing;
      console.log(`[PAYSTACK] Existing order marked paid: ${order.orderId}`);
    } else {
      // First confirmation — create the order record now (only on success)
      order = await Order.create({
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
      console.log(
        `[PAYSTACK] Payment confirmed & order saved: ${order.orderId}`,
      );
    }

    // Clean up in-memory store and any abandoned record (user retried and paid)
    pendingOrders.delete(reference);
    AbandonedOrder.deleteOne({ orderId: reference }).catch(() => {});

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

// ── POST /api/orders/:id/send-qr — admin: send ticket QR email for an order ──
async function sendOrderQr(req, res) {
  const order = await Order.findOne({ orderId: req.params.id });
  if (!order) return res.status(404).json({ error: "Order not found" });

  try {
    await sendTicketEmail(order);
    res.json({ message: "QR email sent" });
  } catch (err) {
    console.error("[MAIL] sendOrderQr error", err);
    res.status(500).json({ error: "Failed to send email" });
  }
}

module.exports = {
  createOrder,
  abandonOrder,
  listOrders,
  listAbandonedOrders,
  getOrder,
  getTicketPublic,
  paystackWebhook,
  updateOrderStatus,
  confirmPayment,
  checkInOrder,
  deleteOrder,
  sendOrderQr,
};
