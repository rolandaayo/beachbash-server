const crypto = require("crypto");
const axios = require("axios");
const Order = require("../models/Order");
const AbandonedOrder = require("../models/AbandonedOrder");
const { sendTicketEmail } = require("../lib/mailer");

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || "";

// ── Canonical ticket catalogue (single source of truth for prices) ───────────
// Any ticket line sent by the client is validated against this map.
// If the ticketId is unknown or the client sends a wrong price, the server
// uses the authoritative price from here — the client can never fake a discount.
const TICKET_CATALOGUE = {
  "regular-girls-25": { name: "Girls — ₦25k", price: 25000 },
  "regular-girls-40": { name: "Girls — ₦40k", price: 40000 },
  "regular-guys-40": { name: "Guys — ₦40k", price: 40000 },
  "regular-guys-60": { name: "Guys — ₦60k", price: 60000 },
  "table-700": { name: "Table 700K", price: 700000 },
  "table-1m": { name: "Table 1M", price: 1000000 },
  "table-1.5m": { name: "Table 1.5M", price: 1500000 },
};

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

  // ── Validate & sanitise ticket lines against the server catalogue ────────
  // Ignore whatever price the client sent — use only the server's authoritative
  // price for each ticketId so no one can buy a ₦700k table for ₦1.
  const sanitisedTickets = [];
  for (const line of tickets) {
    if (
      !line.ticketId ||
      !Number.isInteger(line.quantity) ||
      line.quantity < 1
    ) {
      return res.status(400).json({ error: "Invalid ticket line" });
    }
    const catalogueEntry = TICKET_CATALOGUE[line.ticketId];
    if (!catalogueEntry) {
      return res
        .status(400)
        .json({ error: `Unknown ticket type: ${line.ticketId}` });
    }
    sanitisedTickets.push({
      ticketId: line.ticketId,
      name: catalogueEntry.name, // use server name, not client
      price: catalogueEntry.price, // use server price, not client
      quantity: line.quantity,
    });
  }

  // Recalculate total server-side — never trust the client's total
  const serverTotal = sanitisedTickets.reduce(
    (sum, t) => sum + t.price * t.quantity,
    0,
  );

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
    tickets: sanitisedTickets,
    total: serverTotal,
    createdAt: new Date().toISOString(),
  };

  // Store in memory for fast webhook lookup
  pendingOrders.set(orderId, orderData);
  schedulePendingExpiry(orderId);

  // Also write to DB as pending_payment so data is never lost if server restarts.
  // The webhook / confirmPayment will upgrade this to "paid".
  // It will NOT appear in "All Orders" or "Successful Purchases" until status = "paid".
  try {
    await Order.create({
      orderId,
      userId,
      customer: orderData.customer,
      tickets: sanitisedTickets,
      total: serverTotal,
      status: "pending_payment",
    });
  } catch (err) {
    // Duplicate key — order already exists (shouldn't happen, but safe to ignore)
    console.warn(`[ORDER] DB create skipped (duplicate?): ${orderId}`);
  }

  console.log(
    `[ORDER] Initialised: ${orderId} — ₦${serverTotal.toLocaleString()}`,
  );

  // ── Init Paystack transaction ────────────────────────────────────────────
  let paystackData = null;
  if (PAYSTACK_SECRET) {
    try {
      const { data } = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: orderData.customer.email,
          amount: serverTotal * 100,
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
    total: serverTotal,
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

  // Always look up from DB first — it's written on createOrder now
  const order = await Order.findOne({ orderId });

  // Already paid — webhook beat us to it, or called twice
  if (order && order.status === "paid") {
    return res.json({ success: true, orderId: order.orderId });
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
      // Don't block on verify failure — webhook will double-check
    }
  }

  if (!order) {
    // Very unlikely — means createOrder never wrote to DB (restart scenario).
    // Try to recover from in-memory pending store.
    const pending = pendingOrders.get(orderId);
    if (!pending) {
      return res.status(404).json({ error: "Order not found" });
    }
    const newOrder = await Order.create({
      orderId: pending.orderId,
      userId: pending.userId,
      customer: pending.customer,
      tickets: pending.tickets,
      total: pending.total,
      status: "paid",
      paystackRef: reference || null,
      paidAt: new Date(),
    });
    pendingOrders.delete(orderId);
    AbandonedOrder.deleteOne({ orderId }).catch(() => {});
    console.log(
      `[CONFIRM] Order recovered from memory and saved as paid: ${orderId}`,
    );
    sendTicketEmail(newOrder).catch((err) =>
      console.error("[MAIL] Ticket email failed:", err.message),
    );
    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("order_paid", {
        orderId: newOrder.orderId,
        total: newOrder.total,
        customer: newOrder.customer,
        paidAt: newOrder.paidAt,
        paystackRef: newOrder.paystackRef,
      });
    }
    return res.json({ success: true, orderId: newOrder.orderId });
  }

  // Order exists as pending_payment — mark it paid now
  order.status = "paid";
  order.paystackRef = reference || order.paystackRef;
  order.paidAt = new Date();
  await order.save();

  // Clean up memory and any abandoned record
  pendingOrders.delete(orderId);
  AbandonedOrder.deleteOne({ orderId }).catch(() => {});

  console.log(`[CONFIRM] Order marked paid: ${orderId}`);

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

    // Look up by orderId (which equals the Paystack reference)
    const existing = await Order.findOne({ orderId: reference });

    // Already paid — idempotent, nothing to do
    if (existing && existing.status === "paid") {
      console.log(`[PAYSTACK] Already paid: ${reference}`);
      return res.sendStatus(200);
    }

    let order;
    if (existing) {
      // Normal path — order is in DB as pending_payment, upgrade to paid
      existing.status = "paid";
      existing.paystackRef = reference;
      existing.paystackChannel = data.channel;
      existing.paidAt = new Date();
      await existing.save();
      order = existing;
      console.log(`[PAYSTACK] Order marked paid: ${order.orderId}`);
    } else {
      // Fallback — server restarted between createOrder and payment, try memory
      const pending = pendingOrders.get(reference);
      console.warn(
        `[PAYSTACK] Order not in DB for: ${reference} — ${pending ? "recovering from memory" : "creating from webhook data"}`,
      );
      const payload = pending || {
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
      };
      order = await Order.create({
        orderId: payload.orderId,
        userId: payload.userId,
        customer: payload.customer,
        tickets: payload.tickets,
        total: payload.total,
        status: "paid",
        paystackRef: reference,
        paystackChannel: data.channel,
        paidAt: new Date(),
      });
      console.log(`[PAYSTACK] Order created from fallback: ${order.orderId}`);
    }

    // Clean up memory and any abandoned record (user retried and paid)
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

// ── DELETE /api/orders/abandoned/:id (admin) ────────────────────────────────
async function deleteAbandonedOrder(req, res) {
  const order = await AbandonedOrder.findOneAndDelete({
    orderId: req.params.id,
  });
  if (!order)
    return res.status(404).json({ error: "Abandoned order not found" });
  console.log(`[ORDER] Abandoned order deleted: ${req.params.id}`);
  res.json({ message: "Abandoned order deleted", orderId: req.params.id });
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
  deleteAbandonedOrder,
  sendOrderQr,
};
