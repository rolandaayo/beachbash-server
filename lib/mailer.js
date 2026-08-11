const nodemailer = require("nodemailer");
const QRCode = require("qrcode");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// ── Transport ─────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Send ticket confirmation email with QR code ───────────────────────────────
async function sendTicketEmail(order) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[MAIL] SMTP not configured — skipping email");
    return;
  }

  const { orderId, customer, tickets, total, paidAt } = order;

  // Generate QR code pointing to the ticket scan page
  const ticketUrl = `${CLIENT_URL}/ticket/${orderId}`;
  const qrDataUrl = await QRCode.toDataURL(ticketUrl, {
    width: 300,
    margin: 2,
    color: { dark: "#1e0a3c", light: "#ffffff" },
    errorCorrectionLevel: "H",
  });

  // Strip "data:image/png;base64," prefix for nodemailer inline attachment
  const qrBase64 = qrDataUrl.split(",")[1];

  const ticketLines = tickets
    .map(
      (t) => `<tr>
      <td style="padding:6px 0;color:#1e0a3c;font-size:13px;">${t.name}</td>
      <td style="padding:6px 0;color:#7c3aed;font-size:13px;text-align:right;">×${t.quantity}</td>
      <td style="padding:6px 0;color:#1e0a3c;font-size:13px;text-align:right;font-weight:700;">₦${(t.price * t.quantity).toLocaleString()}</td>
    </tr>`,
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#faf5ff;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #ede9fe;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);padding:32px 32px 24px;text-align:center;">
      <div style="font-size:36px;margin-bottom:8px;">🏖️</div>
      <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:900;letter-spacing:-0.5px;">BEACHBASH PARTY</h1>
      <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px;">October 10, 2026 · Lagos, Nigeria</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px 18px;margin-bottom:24px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">✅</span>
        <div>
          <p style="margin:0;color:#15803d;font-weight:700;font-size:14px;">Payment Confirmed</p>
          <p style="margin:2px 0 0;color:#166534;font-size:12px;">Your spot is locked in for BEACHBASH 2026</p>
        </div>
      </div>

      <p style="color:#1e0a3c;font-size:15px;margin:0 0 4px;">Hey ${customer.firstName} 👋</p>
      <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0 0 24px;">
        Your tickets are confirmed and paid. Show the QR code below at the entrance — no printing needed. You can also screenshot it or open the link directly.
      </p>

      <!-- QR Code -->
      <div style="text-align:center;margin-bottom:8px;">
        <img src="cid:ticket-qr" alt="Entry QR Code" width="220" height="220"
          style="border-radius:16px;border:4px solid #ede9fe;display:block;margin:0 auto 10px;" />
        <p style="color:#7c3aed;font-size:11px;font-weight:700;letter-spacing:0.1em;margin:0 0 6px;">SCAN AT ENTRY</p>
        <a href="${CLIENT_URL}/ticket/${orderId}"
          style="color:#7c3aed;font-size:11px;text-decoration:underline;">
          ${CLIENT_URL}/ticket/${orderId}
        </a>
      </div>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 18px;margin-bottom:24px;text-align:center;">
        <p style="margin:0;color:#c2410c;font-weight:700;font-size:13px;">📸 Screenshot the QR code above</p>
        <p style="margin:4px 0 0;color:#ea580c;font-size:12px;">Save it to your camera roll — you'll need it at the entrance on Oct 10.</p>
      </div>

      <!-- Order details -->
      <div style="background:#faf5ff;border-radius:12px;padding:18px;margin-bottom:24px;">
        <p style="color:#4c1d95;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 12px;">Order Summary</p>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #ede9fe;">
              <th style="text-align:left;color:#9ca3af;font-size:11px;padding-bottom:8px;font-weight:600;">Ticket</th>
              <th style="text-align:right;color:#9ca3af;font-size:11px;padding-bottom:8px;font-weight:600;">Qty</th>
              <th style="text-align:right;color:#9ca3af;font-size:11px;padding-bottom:8px;font-weight:600;">Amount</th>
            </tr>
          </thead>
          <tbody>${ticketLines}</tbody>
          <tfoot>
            <tr style="border-top:1px solid #ede9fe;">
              <td colspan="2" style="padding-top:10px;color:#4c1d95;font-weight:700;font-size:13px;">Total Paid</td>
              <td style="padding-top:10px;color:#1e0a3c;font-weight:900;font-size:15px;text-align:right;">₦${total.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Info grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
        ${[
          { label: "Order ID", val: orderId },
          { label: "Date", val: "October 10, 2026" },
          { label: "Doors", val: "4:00 PM — Till Dawn" },
          { label: "Venue", val: "TBA — Lagos (sent 14 days before)" },
        ]
          .map(
            (r) => `
        <div style="background:#faf5ff;border-radius:10px;padding:12px;">
          <p style="color:#9ca3af;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 3px;">${r.label}</p>
          <p style="color:#1e0a3c;font-size:12px;font-weight:700;margin:0;">${r.val}</p>
        </div>`,
          )
          .join("")}
      </div>

      <p style="color:#9ca3af;font-size:11px;line-height:1.6;margin:0;">
        All ticket sales are final and non-transferable. Keep this email safe — it is your entry pass.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#1e0a3c;padding:20px 32px;text-align:center;">
      <p style="color:rgba(255,255,255,0.4);font-size:11px;margin:0;letter-spacing:0.08em;">
        © 2026 BEACHBASH PARTY · Lagos, Nigeria
      </p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransport();

  await transporter.sendMail({
    from: `"BEACHBASH PARTY 🏖️" <${process.env.SMTP_USER}>`,
    to: customer.email,
    subject: `🎟️ Your BEACHBASH Ticket — ${orderId}`,
    html,
    attachments: [
      {
        filename: "ticket-qr.png",
        content: qrBase64,
        encoding: "base64",
        cid: "ticket-qr",
        contentType: "image/png",
      },
    ],
  });

  console.log(`[MAIL] Ticket email sent to ${customer.email} (${orderId})`);
}

module.exports = { sendTicketEmail };
