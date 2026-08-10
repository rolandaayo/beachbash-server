/**
 * Seed Beachbash DB with sample users and ticket orders.
 * Run: node scripts/seed.js
 * Clear + reseed: node scripts/seed.js --fresh
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Order = require("../models/Order");

const TICKETS = [
  { ticketId: "regular-girls", name: "Regular — Girls", price: 40000 },
  { ticketId: "regular-guys", name: "Regular — Guys", price: 60000 },
  { ticketId: "table-700", name: "Table 700K", price: 700000 },
  { ticketId: "table-1m", name: "Table 1M", price: 1000000 },
  { ticketId: "table-1.5m", name: "Table 1.5M", price: 1500000 },
];

const FIRST = [
  "Ada",
  "Chidi",
  "Folake",
  "Emeka",
  "Ngozi",
  "Tunde",
  "Amina",
  "Kemi",
  "Yusuf",
  "Blessing",
  "Daniel",
  "Chioma",
  "Ibrahim",
  "Zainab",
  "David",
];
const LAST = [
  "Okonkwo",
  "Adeyemi",
  "Okafor",
  "Bello",
  "Eze",
  "Nwosu",
  "Ibrahim",
  "Johnson",
  "Williams",
  "Ogunleye",
  "Mohammed",
  "Chukwu",
  "Bakare",
  "Obi",
  "Sanni",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPhone() {
  const prefixes = ["0803", "0806", "0810", "0814", "0903", "0913"];
  return `+234${pick(prefixes).slice(1)}${randInt(1000000, 9999999)}`;
}

function randomEmail(first, last, i) {
  const domains = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"];
  return `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(domains)}`;
}

function randomTickets() {
  const count = randInt(1, 2);
  const chosen = new Set();
  const lines = [];
  while (lines.length < count) {
    const t = pick(TICKETS);
    if (chosen.has(t.ticketId)) continue;
    chosen.add(t.ticketId);
    const qty = t.price >= 700000 ? randInt(1, 1) : randInt(1, 3);
    lines.push({ ...t, quantity: qty });
  }
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  return { lines, total };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(randInt(9, 22), randInt(0, 59), 0, 0);
  return d;
}

async function seed() {
  const fresh = process.argv.includes("--fresh");
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set in server/.env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  if (fresh) {
    await Order.deleteMany({});
    await User.deleteMany({ email: { $regex: /@(gmail|yahoo|outlook|icloud)\.com$/ } });
    console.log("Cleared existing seed data");
  }

  const passwordHash = await bcrypt.hash("password123", 12);
  const users = [];

  // Admin + sample registered users
  const userRows = [
    {
      firstName: "Admin",
      lastName: "Beachbash",
      email: "admin@beachbash.party",
      phone: "+2348010000001",
      role: "admin",
    },
    ...Array.from({ length: 8 }, (_, i) => {
      const firstName = pick(FIRST);
      const lastName = pick(LAST);
      return {
        firstName,
        lastName,
        email: randomEmail(firstName, lastName, i + 1),
        phone: randomPhone(),
        role: "user",
      };
    }),
  ];

  for (const row of userRows) {
    const existing = await User.findOne({ email: row.email });
    if (existing) {
      users.push(existing);
      continue;
    }
    const user = await User.create({ ...row, passwordHash });
    users.push(user);
  }
  console.log(`Users ready: ${users.length}`);

  const statuses = ["paid", "paid", "paid", "paid", "paid", "pending_payment", "pending_payment", "failed"];
  const channels = ["card", "bank", "ussd", "bank_transfer"];
  const orders = [];

  for (let i = 0; i < 18; i++) {
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const status = pick(statuses);
    const { lines, total } = randomTickets();
    const createdAt = daysAgo(randInt(0, 14));
    const orderId = `BB-${Date.now().toString(36).toUpperCase()}${i}`;

    const linkedUser = Math.random() > 0.4 ? pick(users.filter((u) => u.role === "user")) : null;

    const order = await Order.create({
      orderId,
      userId: linkedUser?._id?.toString() ?? null,
      customer: {
        firstName,
        lastName,
        email: randomEmail(firstName, lastName, 100 + i),
        phone: randomPhone(),
      },
      tickets: lines,
      total,
      status,
      paystackRef: status === "paid" ? orderId : null,
      paystackChannel: status === "paid" ? pick(channels) : null,
      paidAt: status === "paid" ? new Date(createdAt.getTime() + randInt(1, 30) * 60000) : null,
      createdAt,
      updatedAt: createdAt,
    });
    orders.push(order);
  }

  const paid = orders.filter((o) => o.status === "paid");
  const pending = orders.filter((o) => o.status === "pending_payment");
  const revenue = paid.reduce((s, o) => s + o.total, 0);

  console.log("\nSeed complete");
  console.log("─────────────");
  console.log(`Users:     ${users.length}`);
  console.log(`Orders:    ${orders.length}`);
  console.log(`  Paid:    ${paid.length}`);
  console.log(`  Pending: ${pending.length}`);
  console.log(`Revenue:   ₦${revenue.toLocaleString("en-NG")}`);
  console.log("\nOpen http://localhost:3000/admin → Ticket Buyers tab");
  console.log("Admin login test user: admin@beachbash.party / password123");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
