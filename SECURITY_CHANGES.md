# Security changes in this build

## Authentication cookies

The frontend no longer stores the JWT in `localStorage` and does not receive the JWT in JavaScript.
The API sets an HttpOnly session cookie instead.

Production uses:

- `__Host-bom-session`
- `Secure`
- `SameSite=None` (required because the frontend is on Vercel and the API is on Render)
- 30-day lifetime

Local development uses a normal `bom-session` cookie over HTTP.

## CSRF protection

Because the production session cookie is cross-site (`SameSite=None`), state-changing requests also require a CSRF token.
The API sets a non-HttpOnly `bom-csrf` cookie and the frontend copies that value into `X-CSRF-Token` on non-safe requests.

## Resource ownership

Authenticated section/item endpoints now verify the resource's ownership chain:

`item -> section -> BOM -> user`

and:

`section -> BOM -> user`

This prevents one authenticated account from modifying another account's resources just by obtaining a UUID.

## CORS

CORS is restricted to the comma-separated origins in `FRONTEND_URL` and uses credentialed requests.

Example on Render:

`FRONTEND_URL=https://your-app.vercel.app`

## Frontend bundle

Production source maps are disabled. Vite still produces a normal minified production bundle. Client-side JavaScript cannot be made secret: anyone using the site can inspect or download the browser bundle. Server-side Render code is never shipped to the browser.

## Public API keys

The existing public BOM API-key URLs were intentionally left intact. They are designed as read-only integration credentials for external tools and are separate from user session authentication.


## Additional hardening

- Session JWTs now carry a server-side session id and are checked against revocable sessions in Postgres. Logout revokes the session.
- Authentication no longer accepts Bearer tokens; the session is HttpOnly-cookie-only.
- Mutating browser requests are checked against the configured frontend Origin and a CSRF token.
- Helmet/security headers are enabled on the API.
- Auth and BOM/scrape routes are rate limited.
- JSON request bodies are capped at 1 MB; spreadsheet uploads remain capped at 10 MB.
- BOM/item numeric and text fields have server-side validation and database constraints.
- Mutating authenticated requests are written to an audit log.
- Public API keys keep query-string compatibility for integrations, and their last-use timestamp is tracked. Owners can revoke or regenerate a key.
- The Vercel frontend sends a restrictive CSP and related security headers. Update `connect-src` if you deploy the API under a non-Render custom domain.
- `api/test/security.test.js` contains an integration ownership test. Set `TEST_DATABASE_URL` to run it.

### Required production environment

`FRONTEND_URL` should be the exact Vercel origin, e.g. `https://bom-tool.vercel.app`.
`API_PUBLIC_URL` should be the exact public Render API origin.
`JWT_SECRET` and `INTERNAL_SCRAPE_SECRET` must be long random secrets.

If the API uses a custom domain instead of `*.onrender.com`, update `frontend/vercel.json` so its CSP `connect-src` includes that API origin.


## Account security and password policy

- Passwords require at least 8 characters, including 2 uppercase letters, 2 lowercase letters, 2 numbers, and 2 symbols.
- bcrypt's 72-byte UTF-8 input limit is enforced.
- Existing password accounts can change passwords from Account Settings; changing a password revokes all active sessions.
- OAuth-only accounts can set a password from Account Settings.
- Email changes require the current password for password accounts and a single-use verification link sent to the new address.
- Email-change links expire after 24 hours and their tokens are stored as SHA-256 hashes.
- Successful email changes revoke all active sessions.
- Account deletion requires typing `DELETE`; password accounts also require the current password. Owned BOMs and account-linked sessions/shares are removed through database foreign-key cascades.
