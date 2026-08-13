const Conversation = require("../models/Conversation");

// ── GET /api/chat/conversation — get or create conversation for the auth'd user
async function getOrCreateConversation(req, res) {
  const { id: userId, email: userEmail, firstName, lastName } = req.user;
  const userName = `${firstName} ${lastName}`;

  try {
    let convo = await Conversation.findOne({ userId });
    if (!convo) {
      convo = await Conversation.create({
        userId,
        userEmail,
        userName,
        messages: [],
      });
    }
    res.json({ conversation: convo });
  } catch (err) {
    console.error("[CHAT] getOrCreateConversation:", err);
    res.status(500).json({ error: "Failed to load conversation" });
  }
}

// ── POST /api/chat/message — user sends a message
async function sendMessage(req, res) {
  const { id: userId, email: userEmail, firstName, lastName } = req.user;
  const userName = `${firstName} ${lastName}`;
  const { text } = req.body;

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Message text is required" });
  }

  try {
    let convo = await Conversation.findOne({ userId });
    if (!convo) {
      convo = await Conversation.create({
        userId,
        userEmail,
        userName,
        messages: [],
      });
    }

    const message = { sender: "user", text: text.trim() };
    convo.messages.push(message);
    convo.lastMessage = text.trim();
    convo.unreadCount = (convo.unreadCount || 0) + 1;
    await convo.save();

    const saved = convo.messages[convo.messages.length - 1];

    // Emit to admin room via socket (attached to req.app)
    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("new_message", {
        conversationId: convo._id,
        userId,
        userName,
        userEmail,
        message: saved,
        unreadCount: convo.unreadCount,
      });
    }

    res.status(201).json({ message: saved, conversationId: convo._id });
  } catch (err) {
    console.error("[CHAT] sendMessage:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
}

// ── GET /api/chat/admin/conversations — admin: list all conversations
async function listConversations(req, res) {
  try {
    const convos = await Conversation.find()
      .sort({ updatedAt: -1 })
      .select("-messages");
    res.json({ conversations: convos });
  } catch (err) {
    console.error("[CHAT] listConversations:", err);
    res.status(500).json({ error: "Failed to list conversations" });
  }
}

// ── GET /api/chat/admin/conversations/:id — admin: full conversation
async function getConversation(req, res) {
  try {
    const convo = await Conversation.findById(req.params.id);
    if (!convo)
      return res.status(404).json({ error: "Conversation not found" });

    // Mark all user messages as read
    convo.messages.forEach((m) => {
      if (m.sender === "user") m.readByAdmin = true;
    });
    convo.unreadCount = 0;
    await convo.save();

    res.json({ conversation: convo });
  } catch (err) {
    console.error("[CHAT] getConversation:", err);
    res.status(500).json({ error: "Failed to get conversation" });
  }
}

// ── POST /api/chat/admin/reply — admin replies
async function adminReply(req, res) {
  const { conversationId, text } = req.body;
  if (!conversationId || !text?.trim()) {
    return res.status(400).json({ error: "conversationId and text required" });
  }

  try {
    const convo = await Conversation.findById(conversationId);
    if (!convo)
      return res.status(404).json({ error: "Conversation not found" });

    const message = { sender: "admin", text: text.trim() };
    convo.messages.push(message);
    convo.lastMessage = `Admin: ${text.trim()}`;
    await convo.save();

    const saved = convo.messages[convo.messages.length - 1];

    // Emit to the specific user room
    const io = req.app.get("io");
    if (io) {
      io.to(`user_${convo.userId}`).emit("admin_reply", {
        conversationId: convo._id,
        message: saved,
      });
      // Also notify admin room so other admin tabs update
      io.to("admin").emit("admin_replied", {
        conversationId: convo._id,
        message: saved,
      });
    }

    res.status(201).json({ message: saved });
  } catch (err) {
    console.error("[CHAT] adminReply:", err);
    res.status(500).json({ error: "Failed to send reply" });
  }
}

module.exports = {
  getOrCreateConversation,
  sendMessage,
  listConversations,
  getConversation,
  adminReply,
};

// ── Admin: delete a conversation entirely ─────────────────────────────────
async function deleteConversation(req, res) {
  try {
    const convo = await Conversation.findByIdAndDelete(req.params.id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });
    // Notify admins via socket
    const io = req.app.get("io");
    if (io) io.to("admin").emit("conversation_deleted", { conversationId: req.params.id });
    res.json({ message: "Conversation deleted" });
  } catch (err) {
    console.error("[CHAT] deleteConversation:", err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
}

// ── Admin: delete a single message inside a conversation ────────────────
async function deleteMessage(req, res) {
  try {
    const { id, messageId } = req.params;
    const convo = await Conversation.findById(id);
    if (!convo) return res.status(404).json({ error: "Conversation not found" });

    const idx = convo.messages.findIndex((m) => (m._id || m.id || m.tempId) == messageId);
    if (idx === -1) return res.status(404).json({ error: "Message not found" });

    convo.messages.splice(idx, 1);
    // Update lastMessage/unreadCount conservatively
    convo.lastMessage = convo.messages.length ? convo.messages[convo.messages.length - 1].text : "";
    convo.unreadCount = Math.max(0, (convo.unreadCount || 0) - 1);
    await convo.save();

    const io = req.app.get("io");
    if (io) io.to("admin").emit("message_deleted", { conversationId: id, messageId });

    res.json({ message: "Message deleted" });
  } catch (err) {
    console.error("[CHAT] deleteMessage:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
}

module.exports.deleteConversation = deleteConversation;
module.exports.deleteMessage = deleteMessage;
