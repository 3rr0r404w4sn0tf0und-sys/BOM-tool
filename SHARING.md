# BOM Sharing

## What it does

Each BOM now has three ways someone other than its owner can get access:

1. **Per-email invites** (`bom_shares` table) — the owner shares a BOM with
   a specific email as a **viewer** or **editor**. Works even if that email
   doesn't have an account yet: the invite is claimed automatically (linked
   to their `user_id`) the first time they log in and open it.
2. **"Anyone with the link"** (`boms.public_access`) — `private` (default),
   `view`, or `edit`. No invite needed; anyone who has the BOM's URL and is
   logged in gets that role.
3. **Ownership** — unchanged. The owner (`boms.user_id`) always has full
   control, including things shares/public-link can never grant: deleting
   the BOM, managing shares, and regenerating/deleting the integration API
   key.

Role ranking: `viewer < editor < owner`. Every route checks "at least"
a role via `lib/access.js`'s `getBomRole(bomId, userId)`.

| Action | viewer | editor | owner |
|---|---|---|---|
| View BOM, export sheet | ✅ | ✅ | ✅ |
| Add/edit/delete sections & items, import sheet, refresh scrape | ❌ | ✅ | ✅ |
| Rename BOM, set tax rate, sheet columns | ❌ | ✅ | ✅ |
| Manage shares, set public-link access | ❌ | ❌ | ✅ |
| Regenerate/delete integration API key | ❌ | ❌ | ✅ |
| Delete the BOM | ❌ | ❌ | ✅ |

## Migration

`api/db/migrations/014_sharing.sql` — run once against the existing DB.
Adds `boms.public_access` (defaults `'private'`, so existing BOMs are
unaffected) and the `bom_shares` table.

## Security notes

- `GET /api/boms/:id` returns **404** for both "doesn't exist" and "exists
  but you have no access" — deliberately not distinguished, so probing
  random/guessed BOM ids can't be used to confirm one is real.
- Share-email matching happens server-side against the *caller's own*
  account row (`SELECT email FROM users WHERE id = $callerId`) — a request
  can never assert someone else's email to claim their invite.
- The integration API key (`public_api_key_*`) is owner-only to read or
  rotate, even for editors — it's a credential, not BOM content.
- Invite creation is rate-limited (30 per 10 minutes per session) to keep
  it from being usable to spam arbitrary email addresses.
- New endpoints (`POST/PATCH/DELETE /:id/shares*`, `PATCH /:id/visibility`)
  all go through `requireCsrf` + `requireAuth` like every other mutation
  route already did.

## Frontend

- `ShareModal.jsx` — invite by email + role picker, list/edit/remove
  existing shares, public-link toggle with a copy-link button. Only
  rendered when `bom.role === "owner"` (the backend enforces this
  independently regardless).
- The BOM's `role` is returned alongside its content on every `GET`, and
  the frontend uses it to: show a "Shared · role" badge in the BOM list,
  hide/disable write affordances (add table, import, undo/redo, rename,
  tax rate, inline row edits) for viewers, and hide the delete button in
  the list for anyone who isn't the owner.
- Deep-linking to a BOM you don't have access to (`/sheet/:id`) — if
  you're not logged in, you're sent to the login screen (unchanged
  existing behavior). If you *are* logged in but lack access, you land
  back on your BOM list with a clear "you don't have access to this BOM"
  banner and a one-click "Log in as someone else" option, rather than
  being silently signed out.

## Known follow-ups (not done)

- Inline cell editing in `SectionTable.jsx` isn't itself role-aware — for
  viewers the whole table region is wrapped in `pointer-events: none`
  instead, which is effective but not as clean as threading a `readOnly`
  prop through every input. Backend enforcement doesn't depend on this
  either way.
- No email is actually sent when someone is invited — they only see it
  next time they log in and load their BOM list. Wiring the invite into
  the existing Brevo transactional-email setup (see `routes/auth.js`'s
  verification email) would close that gap.
