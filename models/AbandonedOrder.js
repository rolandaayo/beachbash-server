const mongoose = require("mongoose");

const ticketLineSchema = new mongoose.Schema(
  {
    ticketId: String,
    name: String,
    price: Number,
    quantity: Number,
  },
  { _id: false },
);

/**
 * AbandonedOrder — stores checkout attempts where the user cancelled or the
 * payment popup was closed before any payment was made. These are NEVER
 * counted as sales. The admin can view them separately for analytics.
 */
const abandonedOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, default: null },
    customer: {
      firstName: String,
      lastName: String,
      email: String,
      phone: String,
    },
    tickets: [ticketLineSchema],
    total: { type: Number, required: true },
    // How the attempt ended: 'cancelled' (user closed popup), 'expired' (TTL)
    reason: {
      type: String,
      enum: ["cancelled", "expired"],
      default: "cancelled",
    },
    abandonedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("AbandonedOrder", abandonedOrderSchema);
