# Haven Hotel Management

A responsive, database-backed hotel management system built with React/Vite, Node.js/Express, SQLite, and cookie-based authentication. It includes a live operations dashboard, reservation lifecycle, room inventory, guest records/history, booking calendar, payments and reports, notifications, and hotel/user settings.

## Requirements

- Node.js 24 or newer (uses the built-in `node:sqlite` module)
- npm

## Setup

1. Install the root development dependency and each app's packages:
   ```powershell
   npm install
   npm install --prefix server
   npm install --prefix client
   ```
2. Copy `server/.env.example` to `server/.env`. Set `JWT_SECRET` to a long, unique random value. The checked-in example/default secret is for local development only.
   Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` in `server/.env` to enable password-reset email delivery. Use credentials from your SMTP provider; never commit `server/.env`. Without SMTP configuration, reset requests are not sent and the UI displays a setup error.
3. Start the frontend and backend from the workspace root:
   ```powershell
   npm run dev
   ```
4. Configure a unique `HOTEL_ADMIN_SETUP_KEY` in `server/.env`, open `http://localhost:5173/setup-admin`, and initialize the first administrator with that key. The bootstrap endpoint is atomically and permanently disabled after it succeeds. Public sign-up at `/register` always creates a Customer / Guest account; only an administrator can create or promote staff accounts.

The API listens on `http://localhost:4000`. The relational SQLite database is initialized in `server/data/haven.sqlite`; existing account and reservation records are migrated in place and new installations receive room inventory. Do not commit `server/.env` or `server/data/`.

If the database needs to be reset for a fresh local demo, stop the server and delete `server/data/haven.sqlite` (and its `-shm`/`-wal` sidecar files if present); it is recreated with the sample records on the next launch.

## Authentication and safety

- Passwords are hashed with bcrypt; passwords are never stored in plaintext.
- The signed JWT is kept in an HTTP-only, same-site cookie and is not exposed to browser JavaScript.
- Registration and login inputs are validated on the server. Authentication endpoints are rate-limited.
- Public registration cannot request staff roles. Staff role assignment and account suspension are administrator-only, and the initial administrator setup uses a server-side secret plus a durable one-time database marker.
- Cookie-authenticated mutations reject unexpected browser origins. Set `HOTEL_ADMIN_SETUP_KEY` only for first-admin initialization and remove it after bootstrap; it is ineffective after the permanent setup marker is set.
- Change `JWT_SECRET` before deployment, configure `CLIENT_ORIGIN` for your deployed frontend, and use HTTPS in production.

## Useful scripts

- `npm run dev` — start both applications for local development.
- `npm run build` — build the React frontend.
- `npm start --prefix server` — start the API server.

## Hotel operations

- Reservations are created for specific rooms and dates. Pending, confirmed, checked-in, checked-out, and cancelled states are supported. SQLite immediate transactions protect room assignment and prevent overlapping active reservations.
- Room availability is evaluated against requested dates; rooms marked cleaning or maintenance are excluded. Check-in/out updates operational room state.
- Guest profiles store contact, identification, and preference details with reservation history.
- Reservation totals are calculated from nights × nightly rate + charges + taxes − discounts. When tax is not entered manually, the configured hotel tax percentage is applied. Payments are separately recorded, and cannot exceed the remaining balance.
- Revenue reports sum completed payments in the selected date range. Dashboard occupancy uses checked-in room records divided by sellable inventory; maintenance rooms are excluded. Dashboard arrivals, departures, and overdue check-outs use the current date and reservation states.
- Finance exports payment rows as CSV. Administrator-only settings manage hotel details, tax, and user roles; managers can manage room inventory.
- The Reports & Finance cash convention is successful offline payments minus completed refunds. Operating expenses affect the displayed operational result; taxes and reservation charges are shown separately. Online provider checkout, provider webhooks, refund rails, and certified PDF/Excel integrations require external providers and are not simulated.
- An invoice snapshot and stable confirmation number are created for every reservation. Customer cancellation is a request for staff review; room cleaning and maintenance checks are required before a room is returned to service.
- Users can update their profile and change their password after verifying the current password. Forgot password emails use the configured SMTP provider and contain a single-use link that expires after 30 minutes. Password reset invalidates existing sessions.

New installations start with empty reservation, guest, and payment records so that financial and occupancy figures are derived from actual application activity rather than sample dashboard values.
