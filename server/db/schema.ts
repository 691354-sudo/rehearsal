export const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY CHECK (code IN ('en', 'lv')),
  name TEXT NOT NULL,
  locale TEXT NOT NULL,
  cue_locale TEXT NOT NULL DEFAULT 'ru-RU',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  raw_text TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  kind TEXT NOT NULL DEFAULT 'phrase',
  cue TEXT NOT NULL,
  target TEXT NOT NULL,
  accepted_answers TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'learning', 'strong')),
  preference TEXT NOT NULL DEFAULT 'neutral' CHECK (preference IN ('like', 'neutral', 'dislike')),
  naturalness INTEGER NOT NULL DEFAULT 5 CHECK (naturalness BETWEEN 1 AND 5),
  commonness INTEGER NOT NULL DEFAULT 5 CHECK (commonness BETWEEN 1 AND 5),
  register TEXT NOT NULL DEFAULT 'neutral' CHECK (register IN ('casual', 'neutral', 'formal')),
  tags TEXT NOT NULL DEFAULT '[]',
  focus_terms TEXT NOT NULL DEFAULT '[]',
  frequency_band TEXT NOT NULL DEFAULT 'common' CHECK (frequency_band IN ('core', 'common', 'specific', 'rare')),
  currency TEXT NOT NULL DEFAULT 'current' CHECK (currency IN ('current', 'contextual', 'dated', 'uncertain')),
  persona_fit INTEGER NOT NULL DEFAULT 5 CHECK (persona_fit BETWEEN 1 AND 5),
  relevance_checked_at TEXT,
  practice_enabled INTEGER NOT NULL DEFAULT 1 CHECK (practice_enabled IN (0, 1)),
  embedding BLOB,
  embedding_model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_items_language_status ON items(language_code, status);
CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  target,
  cue,
  note,
  tags,
  content='items',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, target, cue, note, tags)
  VALUES (new.id, new.target, new.cue, new.note, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, target, cue, note, tags)
  VALUES ('delete', old.id, old.target, old.cue, old.note, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, target, cue, note, tags)
  VALUES ('delete', old.id, old.target, old.cue, old.note, old.tags);
  INSERT INTO items_fts(rowid, target, cue, note, tags)
  VALUES (new.id, new.target, new.cue, new.note, new.tags);
END;

CREATE TABLE IF NOT EXISTS islands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS island_items (
  island_id INTEGER NOT NULL REFERENCES islands(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (island_id, item_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL,
  verdict TEXT NOT NULL,
  feedback TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_state (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  repetitions INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  last_score REAL,
  state INTEGER NOT NULL DEFAULT 0,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  last_review TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_due ON review_state(due_at);

CREATE TABLE IF NOT EXISTS chat_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  title TEXT NOT NULL DEFAULT 'Tutor chat',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat_messages(thread_id, id);

CREATE TABLE IF NOT EXISTS review_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  kind TEXT NOT NULL CHECK (kind IN ('chat_review', 'vocab', 'text_import', 'pattern_drill', 'capture')),
  title TEXT NOT NULL,
  source_text TEXT NOT NULL DEFAULT '',
  candidates TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'committed')),
  source_thread_public_id TEXT,
  committed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_batches_status ON review_batches(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS capture_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  language_code TEXT NOT NULL REFERENCES languages(code),
  transcript TEXT NOT NULL DEFAULT '',
  audio BLOB,
  audio_mime TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('transcribing', 'ready', 'batched', 'processed', 'failed')),
  error TEXT NOT NULL DEFAULT '',
  review_batch_id INTEGER REFERENCES review_batches(id) ON DELETE SET NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_capture_notes_language_status
ON capture_notes(language_code, status, created_at);

CREATE TABLE IF NOT EXISTS change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'llm', 'system')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_change_events_target ON change_events(target_type, target_id, id DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audio_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL UNIQUE,
  model TEXT NOT NULL,
  voice TEXT NOT NULL,
  format TEXT NOT NULL,
  audio BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;
