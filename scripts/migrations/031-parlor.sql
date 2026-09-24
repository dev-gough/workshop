-- The Parlor: house chat. Hidden chats are readable only by their owner.
-- Passwords are scrypt strings; session tokens are stored as sha256 hashes.

CREATE TABLE IF NOT EXISTS parlor_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parlor_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES parlor_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parlor_sessions_user ON parlor_sessions(user_id);

CREATE TABLE IF NOT EXISTS parlor_chats (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES parlor_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parlor_chats_updated ON parlor_chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS parlor_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES parlor_chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  content TEXT NOT NULL DEFAULT '',
  thinking TEXT,
  image_path TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_parlor_messages_chat ON parlor_messages(chat_id, id);
