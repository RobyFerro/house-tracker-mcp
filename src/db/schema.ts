export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  comune TEXT NOT NULL,
  zona TEXT,
  price INTEGER NOT NULL,
  previous_price INTEGER,
  mq INTEGER NOT NULL,
  locali INTEGER NOT NULL,
  box TEXT,
  seller TEXT NOT NULL CHECK (seller IN ('privato','agenzia')),
  status TEXT NOT NULL CHECK (status IN ('nuovo','ribassato','aumentato','già_visto','rimosso')),
  portal TEXT NOT NULL,
  url TEXT NOT NULL,
  other_links TEXT NOT NULL DEFAULT '[]',
  energy_class TEXT NOT NULL DEFAULT 'nd',
  details TEXT,
  date_info TEXT,
  photos TEXT NOT NULL DEFAULT '[]',
  floorplan_url TEXT,
  data_warning INTEGER NOT NULL DEFAULT 0,
  rating TEXT CHECK (rating IS NULL OR rating IN ('interessante','visita_fissata','scartata')),
  found_at TEXT NOT NULL,
  last_checked TEXT NOT NULL,
  removed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  price INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id);
CREATE INDEX IF NOT EXISTS idx_listings_comune_price_mq ON listings(comune, price, mq);
`;
