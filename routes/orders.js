const express = require("express");
const router = express.Router();
const adminOnly = require("../middleware/adminOnly");
const optionalAuth = require("../middleware/optionalAuth");
const {
  createOrder,
  abandonOrder,
  listOrders,
  listAbandonedOrders,
  getOrder,
  getTicketPublic,
  updateOrderStatus,
  sendOrderQr,
  confirmPayment,
  checkInOrder,
  deleteOrder,
} = require("../controllers/orderController");

// Ticket scan — public, no auth
router.get("/ticket/:id", getTicketPublic);

// POST /api/orders/:id/confirm — public, verifies with Paystack then marks paid
router.post("/:id/confirm", confirmPayment);

// POST /api/orders — create order (guest or logged-in)
router.post("/", optionalAuth, createOrder);

// POST /api/orders/:id/abandon — client calls this when payment is cancelled
router.post("/:id/abandon", abandonOrder);

// GET /api/orders — admin: list all confirmed/paid orders
router.get("/", adminOnly, listOrders);

// GET /api/orders/abandoned — admin: list cancelled/expired attempts
// Must be registered BEFORE /:id so Express doesn't treat "abandoned" as an id
router.get("/abandoned", adminOnly, listAbandonedOrders);

// GET /api/orders/:id — get a single order by orderId string
router.get("/:id", getOrder);

// PATCH /api/orders/:id/status — admin: manually update status
router.patch("/:id/status", adminOnly, updateOrderStatus);

// PATCH /api/orders/:id/checkin — admin: toggle check-in
router.patch("/:id/checkin", adminOnly, checkInOrder);

// POST /api/orders/:id/send-qr — admin: send ticket email for this order
router.post("/:id/send-qr", adminOnly, sendOrderQr);

// DELETE /api/orders/:id — admin: delete order
router.delete("/:id", adminOnly, deleteOrder);

module.exports = router;
