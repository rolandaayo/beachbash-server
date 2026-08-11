const express = require("express");
const router = express.Router();
const adminOnly = require("../middleware/adminOnly");
const optionalAuth = require("../middleware/optionalAuth");
const {
  createOrder,
  listOrders,
  getOrder,
  getTicketPublic,
  updateOrderStatus,
  checkInOrder,
  deleteOrder,
} = require("../controllers/orderController");

// Ticket scan — public, no auth
router.get("/ticket/:id", getTicketPublic);

// POST /api/orders — create order (guest or logged-in)
router.post("/", optionalAuth, createOrder);

// GET /api/orders — admin: list all orders
router.get("/", adminOnly, listOrders);

// GET /api/orders/:id — get by orderId string
router.get("/:id", getOrder);

// PATCH /api/orders/:id/status — admin: manually update status
router.patch("/:id/status", adminOnly, updateOrderStatus);

// PATCH /api/orders/:id/checkin — admin: toggle check-in
router.patch("/:id/checkin", adminOnly, checkInOrder);

// DELETE /api/orders/:id — admin: delete order
router.delete("/:id", adminOnly, deleteOrder);

module.exports = router;
