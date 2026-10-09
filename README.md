# Genius Bookings — database-backed mobile booking manager

A private Arabic booking manager for mobile and desktop using **Cloudflare Workers + D1** (SQLite), not Google Sheets and not GitHub Pages. The GitHub repository contains source code only. Personal client records are kept in the private Cloudflare D1 database.

## Features
- Responsive right-to-left interface with 2027+ annual/monthly dashboards and Cairo local date.
- Add, search, edit, reschedule and cancel bookings; checks overlapping times.
- Deposit, remaining and total value for each booking, summarized in the dashboard.
- Delete with explicit confirmation and transactional archive; recover an archived booking.
- Password-based admin login with PBKDF2-SHA256 password verification, HttpOnly/Secure/SameSite cookie, CSRF check, same-origin requests and rate limiting.
- Optimistic version checking prevents silent edits from another device.
- Private JSON migration wizard for previous data (max 500 records per batch). The migration JSON must never be committed to Git.

## First-time Cloudflare setup

You need a **Cloudflare account** for deployment. The GitHub repo is for source code, but GitHub Pages cannot run the database backend. **Do not deploy this version via GitHub Pages.**

1. Install Node.js 22+ and dependencies using `npm install`.
2. Log in to Cloudflare: `npx wrangler login` (opens browser).
3. Create private database: `npx wrangler d1 create genius-bookings-db`.
4. Copy the `database_id` (UUID) it returns into `wrangler.toml` (replace `REPLACE_WITH_YOUR_D1_DATABASE_ID`). Keep the binding named `DB`.
5. Initialize the database: `npm run db:remote`.
6. Generate a random strong admin password (do **not** place it in GitHub or `wrangler.toml`) and run `npm run password:hash` locally. The helper prints a PBKDF2 hash, **not** the password.
7. Store the hash as a Cloudflare secret: `npx wrangler secret put ADMIN_PASSWORD_HASH`. Paste the generated hash when prompted. No need for Google OAuth credentials.
8. Publish: `npm run deploy`. Cloudflare shows your `https://...workers.dev` URL. Open it and sign in with your admin password.

### Optional: deploy from GitHub
Cloudflare dashboard → Workers & Pages → Create → Connect to Git → choose `easybotapp366/genius-bookings`. Deploy command `npx wrangler deploy`. Set up D1 binding `DB` and the `ADMIN_PASSWORD_HASH` secret before going live. Database migrations are a separate controlled step (`npx wrangler d1 migrations apply genius-bookings-db --remote`), not part of every deployment.

**The D1 database and password hash secret cannot be created from a source-code-only GitHub connection.** They must be configured on the Cloudflare account that owns the deployment.

## Migrating past bookings
The app has a **Import old bookings** button in the archive view that accepts a local JSON file with two arrays:
```json
{"bookings":[{"id":"BKG-2027-0001","date":"2027-01-01","name":"Example","phone":"01000000000","address":"","brushing":"","start":"15:00","end":"16:00","deposit":1000,"remaining":2500,"status":"Confirmed"}],"archive":[]}
```
Create the private JSON from your existing sheet, or enter bookings manually. The server validates it first (`dryRun`) and skips repeated IDs upon re-import. Do not commit the real JSON to GitHub. Existing Google Sheets data remains unchanged unless you choose to migrate it. Protect private backups.

## Development/testing
```bash
npm test
npm run db:local
npm run dev
```
For local login testing, store the PBKDF2 hash in `.dev.vars` as `ADMIN_PASSWORD_HASH=...`. `.dev.vars` is ignored by Git and must never be committed. Unit tests use Node 22's built-in `node:sqlite` and do not require live Cloudflare credentials.

## Deployment cautions
- Never place a password, API key, database export, or client contacts in the public repository.
- Use the Cloudflare Worker URL (or an HTTPS custom domain), **not** `https://easybotapp366.github.io/genius-bookings/` for the DB-enabled app.
- Each admin has the same password in this initial single-owner setup; add individual accounts and 2FA if you later need a team.
- Schedule regular private D1 backups. Deletion archive is a convenience, not a substitute for backups.
