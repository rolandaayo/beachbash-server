# BEACHBASH API (Server)

A lightweight Express server that powers the BEACHBASH ticketing & chat backend. It provides authentication, order/ticket management (with Paystack integration), admin tools, and a simple chat/conversation system with Socket.io notifications.

This README is aimed at developers who want to run or extend the API and quickly find the available endpoints.

**Quick Highlights**
- **Auth**: register, login, token-based auth, user profile
- **Orders**: create orders (guest or authenticated), Paystack init/confirm, ticket QR emails, admin order management and check-in
- **Chat**: simple user→admin conversation model with admin replies and real-time Socket.io events
- **Admin**: protected admin routes via `x-admin-secret` header (for quick admin tooling)

## Getting started

Prerequisites: Node.js, npm, and a MongoDB instance (or connection string).

Install dependencies:

```bash
npm install
```

Run locally (development):

```bash
npm run dev
```

Start in production mode:

```bash
npm start
```

## Environment variables
Create a `.env` (or set env vars) with the following values as needed:

- `PORT` — server port (default: `4000`)
- `MONGO_URI` — MongoDB connection string
- `CLIENT_URL` — allowed client origin (used for CORS and QR links)
- `JWT_SECRET` — JWT signing secret
- `ADMIN_SECRET` — simple admin gate used by admin routes (`x-admin-secret` header)
- `PAYSTACK_SECRET_KEY` — optional: Paystack secret for payment init/verify/webhook
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — optional: for sending ticket emails

Example `.env` snippet:

```env
PORT=4000
MONGO_URI=mongodb://localhost:27017/beachbash
CLIENT_URL=http://localhost:3000
JWT_SECRET=supersecret
ADMIN_SECRET=adminsecret
PAYSTACK_SECRET_KEY=sk_test_...
SMTP_USER=you@example.com
SMTP_PASS=yourpassword
```

## How the server is organised

- `index.js` — app bootstrap, Socket.io, route mounting, Paystack webhook
- `routes/` — Express route definitions (`/api/auth`, `/api/chat`, `/api/users`, `/api/orders`)
- `controllers/` — request handlers and business logic
- `models/` — Mongoose models: `User`, `Order`, `Conversation`
- `middleware/` — `authenticate`, `optionalAuth`, `adminOnly`, `requireDb`
- `lib/mailer.js` — QR ticket email generation (uses `qrcode` + `nodemailer`)

## API Reference (developer-focused)

Base URL: `http://localhost:4000` (or your `PORT`)

Auth
- POST /api/auth/register — body: `{ firstName,lastName,email,password,phone }` — create account; returns `{ token, user }`
- POST /api/auth/login — body: `{ email, password }` — returns `{ token, user }`
- POST /api/auth/logout — header: `Authorization: Bearer <token>` — logs out (stateless)
- GET /api/auth/me — header: `Authorization: Bearer <token>` — returns current user

Chat
- GET /api/chat/conversation — header: `Authorization: Bearer <token>` — get or create a user's conversation
- POST /api/chat/message — header: `Authorization: Bearer <token>` — body: `{ text }` — send user message

Admin Chat
- GET /api/chat/admin/conversations — header: `x-admin-secret: <ADMIN_SECRET>` — list conversations (no messages field)
- GET /api/chat/admin/conversations/:id — header: `x-admin-secret` — view full conversation (marks user messages read)
- POST /api/chat/admin/reply — header: `x-admin-secret` — body: `{ conversationId, text }` — admin reply

Orders & Tickets
- GET /api/orders/ticket/:id — public — returns ticket/order info for scanning (must be `paid`)
- POST /api/orders/:id/confirm — public — body: `{ reference }` — confirm Paystack reference and mark order `paid`
- POST /api/orders — body: order payload — `optionalAuth` supported (guests allowed)
- POST /api/orders/paystack/webhook — Paystack webhook (raw body expected) — handled in `index.js`

Admin Order Management
- GET /api/orders — header: `x-admin-secret` — list all orders
- GET /api/orders/:id — get order by `orderId`
- PATCH /api/orders/:id/status — header: `x-admin-secret` — body: `{ status, paystackRef }` — manually set status
- PATCH /api/orders/:id/checkin — header: `x-admin-secret` — toggle `checkedIn`
- POST /api/orders/:id/send-qr — header: `x-admin-secret` — resend ticket QR email
- DELETE /api/orders/:id — header: `x-admin-secret` — delete order

Users (admin)
- GET /api/users/all — header: `x-admin-secret` — list registered + guests
- GET /api/users — header: `x-admin-secret` — list users
- GET /api/users/:id — header: `x-admin-secret` — get user
- POST /api/users — header: `x-admin-secret` — create user
- PATCH /api/users/:id — header: `x-admin-secret` — update user
- DELETE /api/users/:id — header: `x-admin-secret` — delete user
- POST /api/users/:id/send-qr — header: `x-admin-secret` — send ticket email to a user

Realtime (Socket.io)
- Client events:
	- `join_user` — join room `user_<userId>`
	- `join_admin` — admin joins `admin` room
- Server emits:
	- `new_message` — to `admin` when a user sends a message
	- `admin_reply` — to `user_<userId>` when admin replies
	- `order_paid` — to `admin` when an order is confirmed/paid

Security notes
- Authentication is JWT-based. Include `Authorization: Bearer <token>` for protected routes.
- Admin routes are protected by a simple header `x-admin-secret` — suitable for internal tooling, but replace with role-based checks for production.
- Paystack webhook expects raw JSON and verifies HMAC with `PAYSTACK_SECRET_KEY` when configured.

Extending the API
- Controllers are organized per feature under `controllers/`. Add routes in `routes/` and implement handlers in `controllers/`.
- Use `optionalAuth` for endpoints that accept both guests and logged-in users.

Troubleshooting
- If you don't set `MONGO_URI`, the server will run but persistence is disabled (see `index.js` warnings).
- If SMTP is not configured, email-sending functions will log and skip sending — useful for local development.

License
- Internal / project-specific. Add a license file if you plan to open-source this repository.

---

Read the code in `routes/` and `controllers/` for implementation details and examples.
