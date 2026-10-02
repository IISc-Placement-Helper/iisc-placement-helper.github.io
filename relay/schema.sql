CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,      -- hex(HKDF(sync code, "hq-sync-id")), 64 chars
  ver INTEGER NOT NULL,     -- bumped on every write; clients send it back as base
  data TEXT NOT NULL,       -- base64url(iv || AES-GCM ciphertext), at most 256 KB
  wcount INTEGER NOT NULL,  -- writes in the current one-hour window
  wstart INTEGER NOT NULL   -- start of that window, ms
);
