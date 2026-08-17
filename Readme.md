# BEACHBASH API (Server) — Summary

Small Express backend for BEACHBASH: handles user auth, ticket orders (with Paystack hooks), QR ticket emails, admin order management, and a simple user↔admin chat with Socket.io notifications.

What developers will find
- Authentication endpoints for registering/logging in and fetching the current user.
- Order endpoints to create orders (guest or authenticated), confirm payments, view tickets, and admin-only management (status, check-in, resend QR, delete).
- Chat endpoints to let users send messages and admins reply, plus real-time Socket.io events for new messages and paid orders.

Where to look in the code
- `index.js` — server bootstrap, Socket.io, webhook wiring
- `routes/` — route definitions
- `controllers/` — handlers and business logic
- `lib/mailer.js` — QR email formatting

No secrets or `.env` values are included here — check the code for required environment variables when running the server.

For quick reference, the main route groups are: `/api/auth`, `/api/chat`, `/api/users`, `/api/orders`.

Read the implementation in `routes/` and `controllers/` for exact parameters and responses.
