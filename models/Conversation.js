const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      enum: ["user", "admin"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    readByAdmin: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },
    messages: [messageSchema],
    // last message preview for the admin list
    lastMessage: { type: String, default: "" },
    unreadCount: { type: Number, default: 0 },
    open: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Conversation", conversationSchema);
