import type Database from "better-sqlite3";
import type { ListingStatus, Seller } from "../constants.js";

export interface ListingRow {
  id: string;
  title: string;
  comune: string;
  zona: string | null;
  price: number;
  previous_price: number | null;
  mq: number;
  locali: number;
  box: string | null;
  seller: Seller;
  status: ListingStatus;
  portal: string;
  url: string;
  other_links: string;
  energy_class: string;
  details: string | null;
  date_info: string | null;
  photos: string;
  floorplan_url: string | null;
  data_warning: number;
  rating: string | null;
  found_at: string;
  last_checked: string;
  removed_at: string | null;
  updated_at: string;
}

export function getListingById(db: Database.Database, id: string): ListingRow | undefined {
  return db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as ListingRow | undefined;
}

export interface NewListingInput {
  id: string; title: string; comune: string; zona: string | null;
  price: number; mq: number; locali: number; box: string | null;
  seller: Seller; portal: string; url: string; energyClass: string;
  details: string | null; dateInfo: string | null; photos: string[];
  floorplanUrl: string | null; dataWarning: boolean;
}

export function insertNewListing(db: Database.Database, input: NewListingInput, today: string): void {
  db.prepare(`
    INSERT INTO listings (
      id, title, comune, zona, price, previous_price, mq, locali, box, seller,
      status, portal, url, other_links, energy_class, details, date_info,
      photos, floorplan_url, data_warning, rating, found_at, last_checked, removed_at, updated_at
    ) VALUES (
      @id, @title, @comune, @zona, @price, NULL, @mq, @locali, @box, @seller,
      'nuovo', @portal, @url, '[]', @energyClass, @details, @dateInfo,
      @photos, @floorplanUrl, @dataWarning, NULL, @today, @today, NULL, @today
    )
  `).run({
    id: input.id, title: input.title, comune: input.comune, zona: input.zona,
    price: input.price, mq: input.mq, locali: input.locali, box: input.box,
    seller: input.seller, portal: input.portal, url: input.url, energyClass: input.energyClass,
    details: input.details, dateInfo: input.dateInfo, photos: JSON.stringify(input.photos),
    floorplanUrl: input.floorplanUrl, dataWarning: input.dataWarning ? 1 : 0, today,
  });
  db.prepare("INSERT INTO price_history (listing_id, date, price) VALUES (?, ?, ?)")
    .run(input.id, today, input.price);
}

export interface UpdateListingPriceInput {
  id: string; newPrice: number; status: ListingStatus; previousPrice: number | null;
  dataWarning: boolean; energyClass?: string;
}

export function updateListingOnRecheck(
  db: Database.Database, input: UpdateListingPriceInput, today: string,
): void {
  db.prepare(`
    UPDATE listings SET
      price = @newPrice,
      previous_price = @previousPrice,
      status = @status,
      data_warning = @dataWarning,
      energy_class = COALESCE(@energyClass, energy_class),
      removed_at = NULL,
      last_checked = @today,
      updated_at = @today
    WHERE id = @id
  `).run({
    id: input.id, newPrice: input.newPrice, status: input.status,
    previousPrice: input.previousPrice, dataWarning: input.dataWarning ? 1 : 0,
    energyClass: input.energyClass ?? null, today,
  });
  if (input.previousPrice !== null) {
    db.prepare("INSERT INTO price_history (listing_id, date, price) VALUES (?, ?, ?)")
      .run(input.id, today, input.newPrice);
  }
}

export function touchLastChecked(db: Database.Database, id: string, today: string): void {
  db.prepare("UPDATE listings SET last_checked = ? WHERE id = ?").run(today, id);
}

export function touchRecheck(db: Database.Database, id: string, today: string, status: ListingStatus): void {
  db.prepare(`
    UPDATE listings SET status = ?, removed_at = NULL, last_checked = ?, updated_at = ?
    WHERE id = ?
  `).run(status, today, today, id);
}

export function markRemoved(db: Database.Database, id: string, today: string): ListingRow | undefined {
  db.prepare("UPDATE listings SET status = 'rimosso', removed_at = ? WHERE id = ?").run(today, id);
  return getListingById(db, id);
}

export function setRating(db: Database.Database, id: string, rating: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const result = db.prepare("UPDATE listings SET rating = ?, updated_at = ? WHERE id = ?").run(rating, today, id);
  return result.changes > 0;
}

export function beginDailyRun(db: Database.Database): void {
  db.prepare(`
    UPDATE listings SET status = 'già_visto'
    WHERE status IN ('nuovo', 'ribassato', 'aumentato')
  `).run();
}

export function addOtherLink(db: Database.Database, id: string, link: { portal: string; url: string }): void {
  const row = getListingById(db, id);
  if (!row) return;
  const links = JSON.parse(row.other_links) as Array<{ portal: string; url: string }>;
  if (!links.some((l) => l.url === link.url)) {
    links.push(link);
    db.prepare("UPDATE listings SET other_links = ? WHERE id = ?").run(JSON.stringify(links), id);
  }
}

export function promoteToMain(
  db: Database.Database, newMain: NewListingInput, demoted: ListingRow, today: string,
): void {
  // The demoted row is the same real property under a different (agenzia) listing:
  // insert the new row first, re-parent its price history and carry over rating/found_at,
  // then delete the demoted row last so nothing references it when it goes away.
  const links = JSON.parse(demoted.other_links) as Array<{ portal: string; url: string }>;
  links.push({ portal: demoted.portal, url: demoted.url });

  insertNewListing(db, newMain, today);
  db.prepare("UPDATE price_history SET listing_id = ? WHERE listing_id = ?").run(newMain.id, demoted.id);
  db.prepare("UPDATE listings SET other_links = ?, rating = ?, found_at = ? WHERE id = ?")
    .run(JSON.stringify(links), demoted.rating, demoted.found_at, newMain.id);
  db.prepare("DELETE FROM listings WHERE id = ?").run(demoted.id);
}

export interface TrackingStateRow {
  id: string; price: number; status: ListingStatus; rating: string | null; found_at: string;
}

export function getTrackingState(db: Database.Database): TrackingStateRow[] {
  return db.prepare(`
    SELECT id, price, status, rating, found_at FROM listings WHERE status != 'rimosso'
  `).all() as TrackingStateRow[];
}

export interface DuplicateCandidate {
  id: string; comune: string; zona: string | null; price: number; mq: number; portal: string; url: string;
  title: string; details: string | null; seller: Seller; status: ListingStatus; other_links: string;
}

const MAX_DUPLICATE_CANDIDATES = 5;

export function findDuplicateCandidates(
  db: Database.Database, comune: string, price: number, mq: number,
): DuplicateCandidate[] {
  const priceLow = price * 0.98;
  const priceHigh = price * 1.02;
  return db.prepare(`
    SELECT id, comune, zona, price, mq, portal, url, title, details, seller, status, other_links
    FROM listings
    WHERE comune = ? AND status != 'rimosso'
      AND (price BETWEEN ? AND ? OR mq BETWEEN ? AND ?)
    ORDER BY ABS(price - ?) + ABS(mq - ?) * 1000 ASC
    LIMIT ${MAX_DUPLICATE_CANDIDATES}
  `).all(comune, priceLow, priceHigh, mq - 3, mq + 3, price, mq) as DuplicateCandidate[];
}
