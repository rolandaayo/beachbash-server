const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authenticate");
const adminOnly = require("../middleware/adminOnly");
const {
  getOrCreateConversation,
  sendMessage,
  listConversations,
  getConversation,
  adminReply,
} = require("../controllers/chatController");

// ── User routes (require JWT) ────────────────────────────────────────────────
router.get("/conversation", authenticate, getOrCreateConversation);
router.post("/message", authenticate, sendMessage);

// ── Admin routes (require admin secret header) ───────────────────────────────
router.get("/admin/conversations", adminOnly, listConversations);
router.get("/admin/conversations/:id", adminOnly, getConversation);
router.post("/admin/reply", adminOnly, adminReply);

module.exports = router;
