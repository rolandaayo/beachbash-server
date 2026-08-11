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

const orderSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ["pending_payment", "paid", "failed", "refunded"],
      default: "pending_payment",
    },
    paystackRef: { type: String, default: null },
    paystackChannel: { type: String, default: null },
    paidAt: { type: Date, default: null },
    checkedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", orderSchema);
