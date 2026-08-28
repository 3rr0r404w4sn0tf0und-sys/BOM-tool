"""
Python port of api/lib/secretCrypto.js's decryptSecret -- needed here
because the nightly/weekly cron scrapers talk to Postgres directly
(they're not going through the Node API), but still need to decrypt
each BOM owner's stored Apify token to use per-owner "bring your own
token" credits instead of a single shared APIFY_TOKEN secret.

Must stay in sync with secretCrypto.js: AES-256-GCM, key is
SECRET_ENCRYPTION_KEY (32 raw bytes, base64), stored ciphertext is
"<iv>:<authTag>:<ciphertext>", each base64.
"""

import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _load_key() -> bytes:
    raw = os.environ.get("SECRET_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError("SECRET_ENCRYPTION_KEY is not configured")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError("SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)")
    return key


def decrypt_secret(stored: str):
    """Mirrors secretCrypto.js decryptSecret: returns the plaintext
    string, or None on any failure (missing key, wrong key, corrupted
    row, tampered ciphertext) -- same "treat as absent" behavior so a
    bad token for one user doesn't blow up the whole cron run.
    """
    if not stored:
        return None
    parts = stored.split(":")
    if len(parts) != 3:
        return None
    iv_b64, tag_b64, ct_b64 = parts
    try:
        key = _load_key()
        iv = base64.b64decode(iv_b64)
        tag = base64.b64decode(tag_b64)
        ciphertext = base64.b64decode(ct_b64)
        aesgcm = AESGCM(key)
        # Node's crypto keeps the GCM auth tag separate; the `cryptography`
        # lib expects it appended to the ciphertext.
        plaintext = aesgcm.decrypt(iv, ciphertext + tag, None)
        return plaintext.decode("utf-8")
    except Exception:
        return None
