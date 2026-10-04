import type Database from "better-sqlite3";
import type { ListingRow } from "./listingsRepo.js";

export interface DailySummaryListing {
  id: string;
  portal: string;
  url: string;
  title: string;
  comune: string;
  zona: string | null;
  price: number;
  oldPrice: number | null;
  mq: number;
  locali: number;
  box: string | null;
  energy: string;
  history: string;
  daysOnline: number;
  notes: string | null;
  seller: string;
  status: "nuovo" | "ribassato" | "aumentato" | "rimosso" | "invariato";
  rating: string | null;
  dateInfo: string | null;
  otherLinks: Array<{ portal: string; url: string }>;
  dataWarning: boolean;
  photos: string[];
  floorplanUrl: string | null;
}

export interface DailySummary {
  date: string;
  galleryTotal: number;
  favorites: DailySummaryListing[];
  listings: DailySummaryListing[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function formatItalianDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatPriceHistory(db: Database.Database, listingId: string): string {
  const rows = db
    .prepare("SELECT date, price FROM price_history WHERE listing_id = ? ORDER BY date ASC, id ASC")
    .all(listingId) as Array<{ date: string; price: number }>;
  return rows.map((r) => `${formatItalianDate(r.date)}: ${r.price.toLocaleString("it-IT")} €`).join(" → ");
}

function toSummaryListing(
  db: Database.Database, row: ListingRow, today: string, status: DailySummaryListing["status"],
): DailySummaryListing {
  return {
    id: row.id, portal: row.portal, url: row.url, title: row.title, comune: row.comune, zona: row.zona,
    price: row.price, oldPrice: row.previous_price, mq: row.mq, locali: row.locali, box: row.box,
    energy: row.energy_class, history: formatPriceHistory(db, row.id),
    daysOnline: daysBetween(row.found_at, today), notes: row.details, seller: row.seller, status,
    rating: row.rating, dateInfo: row.date_info, otherLinks: JSON.parse(row.other_links),
    dataWarning: Boolean(row.data_warning), photos: JSON.parse(row.photos), floorplanUrl: row.floorplan_url,
  };
}

export function buildDailySummary(db: Database.Database, today: string): DailySummary {
  const todays = db
    .prepare("SELECT * FROM listings WHERE status IN ('nuovo','ribassato','aumentato')")
    .all() as ListingRow[];
  const removedToday = db
    .prepare("SELECT * FROM listings WHERE status = 'rimosso' AND removed_at = ?")
    .all(today) as ListingRow[];
  const favoriteRows = db
    .prepare(`
      SELECT * FROM listings
      WHERE rating IN ('interessante','visita_fissata')
        AND (status != 'rimosso' OR removed_at = ?)
    `)
    .all(today) as ListingRow[];
  const galleryTotal = (
    db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status != 'rimosso'").get() as { n: number }
  ).n;

  const listings: DailySummaryListing[] = [
    ...todays.map((row) => toSummaryListing(db, row, today, row.status as DailySummaryListing["status"])),
    ...removedToday.map((row) => toSummaryListing(db, row, today, "rimosso")),
  ];

  const favorites: DailySummaryListing[] = favoriteRows.map((row) => {
    const status: DailySummaryListing["status"] =
      row.status === "rimosso" && row.removed_at === today ? "rimosso"
      : row.status === "nuovo" || row.status === "ribassato" || row.status === "aumentato" ? row.status
      : "invariato";
    return toSummaryListing(db, row, today, status);
  });

  return { date: formatItalianDate(today), galleryTotal, favorites, listings };
}
