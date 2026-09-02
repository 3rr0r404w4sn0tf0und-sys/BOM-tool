-- BOM sharing: per-email/user shares with viewer/editor roles, plus an
-- optional "anyone with the link" mode. Ownership (boms.user_id) is
-- untouched -- shares are strictly additive access grants on top of it.

-- 'private' (default): only the owner and explicit shares below can see it.
-- 'view'/'edit': anyone with the link gets that role, no share row needed.
ALTER TABLE boms ADD COLUMN public_access TEXT NOT NULL DEFAULT 'private'
  CHECK (public_access IN ('private', 'view', 'edit'));

CREATE TABLE bom_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    email TEXT NOT NULL, -- lowercased invite target; may predate the invitee's account
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- backfilled once a matching account exists/logs in
    role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ -- set the first time the invited user actually loads the BOM
);

-- One share row per (bom, email) -- re-inviting the same address updates
-- the existing row's role instead of creating a duplicate.
CREATE UNIQUE INDEX idx_bom_shares_bom_email ON bom_shares(bom_id, email);
CREATE INDEX idx_bom_shares_bom_id ON bom_shares(bom_id);
CREATE INDEX idx_bom_shares_user_id ON bom_shares(user_id) WHERE user_id IS NOT NULL;
