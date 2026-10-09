# Genius Bookings security boundaries

- GitHub contains source code only. Customer bookings are private Cloudflare D1 records; do not commit data exports or migration JSON.
- Cloudflare Worker checks a PBKDF2-SHA256 admin password hash stored as a Cloudflare **Secret**, not in HTML, JavaScript, or GitHub.
- Admin session cookie is HttpOnly, Secure (HTTPS), SameSite=Strict, expires after 8 hours, checked by the Worker for every data request.
- State-changing requests require same-origin Origin and session CSRF token; SQL calls are parameterized. Login attempts are rate-limited.
- Deleting a booking archives it transactionally. Optimistic version checks avoid overwriting edits from another device.
- One shared administrator password is supported initially. Do not share it with a team; add individual accounts and 2FA if multiple users are needed.
- Keep independent D1 backups. Booking archive is not a replacement for encrypted off-site backups.
- This repository is not a substitute for a production penetration test or security audit.
