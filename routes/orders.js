const express = require("express");
const router = express.Router();
const adminOnly = require("../middleware/adminOnly");
const optionalAuth = require("../middleware/optionalAuth");
const {
  createOrder,
  listOrders,
  getOrder,
  updateOrderStatus,
} = require("../controllers/orderController");

// POST /api/orders — create order (guest or logged-in)
router.post("/", optionalAuth, createOrder);

// GET /api/orders — admin: list all orders
router.get("/", adminOnly, listOrders);

// GET /api/orders/:id — get by orderId string
router.get("/:id", getOrder);

// PATCH /api/orders/:id/status — admin: manually update status
router.patch("/:id/status", adminOnly, updateOrderStatus);

module.exports = router;
