import type { RenderSummaryEmailInput } from "../tools/schemas.js";

type SummaryListing = RenderSummaryEmailInput["listings"][number];

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const GREEN = "#16a34a";
const RED = "#dc2626";
const ORANGE = "#ea580c";
const PURPLE = "#7c3aed";
const GREY = "#cbd5e1";
const NAVY = "#1e3a8a";
const GOLD = "#ca8a04";

function escapeHtml(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function eur(value: number | null | undefined): string {
  if (!value) return "n.d.";
  return `${Math.round(value).toLocaleString("it-IT")} €`;
}

function energyColor(code: string): string {
  const c = code.toUpperCase();
  if (c.startsWith("A") || c === "B") return GREEN;
  if (c === "C" || c === "D") return GOLD;
  if (c === "E") return ORANGE;
  if (c === "F" || c === "G") return RED;
  return "#94a3b8";
}

function badge(text: string, color: string): string {
  return `<span style="display:inline-block;background-color:${color};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.5px;padding:3px 8px;border-radius:4px;margin:0 4px 4px 0">${text}</span>`;
}

function button(url: string, text: string, color = NAVY): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;margin:0 6px 6px 0"><tr><td bgcolor="${color}" style="background-color:${color};border-radius:6px"><a href="${escapeHtml(url)}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:8px 14px">${text}</a></td></tr></table>`;
}

const STATUS_LABELS: Record<string, [string, string]> = {
  nuovo: ["NUOVO", GREEN],
  ribassato: ["RIBASSATO", RED],
  aumentato: ["AUMENTATO", ORANGE],
  rimosso: ["RIMOSSO", "#78350f"],
  invariato: ["INVARIATO", "#94a3b8"],
};

function card(item: SummaryListing, isFavoriteSection: boolean): string {
  const [label, statusColor] = STATUS_LABELS[item.status] ?? STATUS_LABELS.invariato;
  const strip = item.status !== "invariato" ? statusColor : item.seller === "privato" ? PURPLE : GREY;

  let badges = item.status !== "invariato" || isFavoriteSection ? badge(label, statusColor) : "";
  badges += item.seller === "privato" ? badge("PRIVATO", PURPLE) : badge("AGENZIA", "#64748b");
  badges += badge(`CLASSE ${escapeHtml(item.energy || "n.d.").toUpperCase()}`, energyColor(item.energy || "nd"));
  if (item.rating) badges += badge(`★ ${escapeHtml(item.rating).toUpperCase()}`, NAVY);
  if (item.dataWarning) badges += badge("⚠ VERIFICA DATI", "#b45309");

  let priceHtml = `<span style="font-size:22px;font-weight:800;color:#111827">${eur(item.price)}</span>`;
  if (item.oldPrice && item.oldPrice !== item.price) {
    const diff = item.price - item.oldPrice;
    const diffColor = diff < 0 ? GREEN : ORANGE;
    const sign = diff < 0 ? "−" : "+";
    priceHtml += ` <span style="font-size:14px;color:#9ca3af;text-decoration:line-through">${eur(item.oldPrice)}</span> <span style="font-size:13px;font-weight:700;color:${diffColor}">${sign}${eur(Math.abs(diff))}</span>`;
  }

  const eurMq = item.price && item.mq ? Math.round(item.price / item.mq) : null;
  const facts = [
    item.mq ? `${item.mq} m²` : "",
    item.locali ? `${item.locali} locali` : "",
    escapeHtml(item.box),
    eurMq ? `${eur(eurMq)}/m²` : "",
  ].filter(Boolean).join(" · ");

  const hist = item.history
    ? `<div style="font-size:12px;color:#6b7280;margin:2px 0">Storico prezzi: ${escapeHtml(item.history)}</div>`
    : "";

  const extra: string[] = [];
  if (item.daysOnline) extra.push(`in galleria da ${item.daysOnline} giorni`);
  if (item.status === "rimosso") extra.push("annuncio non più online (probabilmente venduto o ritirato)");
  const meta = [escapeHtml(item.portal), escapeHtml(item.dateInfo), ...extra].filter(Boolean).join(" · ");

  let buttons = button(item.url, `Vedi su ${escapeHtml(item.portal)}`, "#475569");
  buttons += item.photos.slice(0, 5).map((url, i) => button(url, `Foto ${i + 1}`, "#64748b")).join("");
  if (item.floorplanUrl) buttons += button(item.floorplanUrl, "Planimetria", "#64748b");

  const others = item.otherLinks.length
    ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">Anche su: ${item.otherLinks.map((o) => `<a href="${escapeHtml(o.url)}" style="color:#2563eb">${escapeHtml(o.portal)}</a>`).join(", ")}</div>`
    : "";

  return `
<tr><td style="padding:0 16px 16px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td height="6" bgcolor="${strip}" style="background-color:${strip};height:6px;line-height:6px;font-size:0;border-radius:8px 8px 0 0">&nbsp;</td></tr>
<tr><td style="padding:12px 16px 10px 16px;font-family:${FONT}">
<div>${badges}</div>
<div style="font-size:17px;font-weight:700;color:#111827;margin:2px 0">${escapeHtml(item.comune)}${item.zona ? " – " + escapeHtml(item.zona) : ""}</div>
<div style="font-size:13px;color:#6b7280;margin-bottom:6px">${escapeHtml(item.title)}</div>
<div>${priceHtml}</div>
<div style="font-size:14px;color:#374151;margin:4px 0">${facts}</div>
<div style="font-size:13px;color:#4b5563">${escapeHtml(item.notes)}</div>
${hist}
<div style="font-size:12px;color:#9ca3af;margin:4px 0 8px 0">${meta}</div>
${buttons}${others}
</td></tr></table></td></tr>`;
}

function section(title: string, items: SummaryListing[], isFavoriteSection: boolean, subtitle = ""): string {
  if (!items.length) return "";
  const sorted = [...items].sort((a, b) => (a.seller === "privato" ? 0 : 1) - (b.seller === "privato" ? 0 : 1));
  const sub = subtitle
    ? `<div style="font-size:12px;font-weight:400;color:#6b7280;margin-top:2px">${escapeHtml(subtitle)}</div>`
    : "";
  return (
    `<tr><td style="padding:8px 16px 10px 16px;font-family:${FONT};font-size:19px;font-weight:800;color:${NAVY}">${escapeHtml(title)} (${items.length})${sub}</td></tr>`
    + sorted.map((item) => card(item, isFavoriteSection)).join("")
  );
}

function textSection(lines: string[], title: string, items: SummaryListing[]): void {
  if (!items.length) return;
  lines.push(`${title.toUpperCase()} (${items.length})`);
  items.forEach((item) => {
    const priceLine = item.oldPrice && item.oldPrice !== item.price
      ? `${eur(item.price)} (prima ${eur(item.oldPrice)})`
      : eur(item.price);
    lines.push(`- ${item.comune}: ${priceLine} · classe ${item.energy} · ${item.seller} · ${item.url}`);
  });
  lines.push("");
}

export function renderSummaryEmail(summary: RenderSummaryEmailInput): { subject: string; html: string; text: string } {
  const favoriteIds = new Set(summary.favorites.map((f) => f.id));
  const listings = summary.listings.filter((l) => !favoriteIds.has(l.id));
  const byStatus = (status: string) => listings.filter((l) => l.status === status);
  const nuovi = byStatus("nuovo");
  const ribassati = byStatus("ribassato");
  const aumentati = byStatus("aumentato");
  const rimossi = byStatus("rimosso");
  const favChanged = summary.favorites.filter((f) => f.status !== "invariato").length;
  const nPrivatiNuovi = nuovi.filter((l) => l.seller === "privato").length;

  const parts: string[] = [
    section("I tuoi preferiti", summary.favorites, true, "Case segnate come Interessante o Visita fissata, ricontrollate oggi"),
  ];
  if (listings.length) {
    parts.push(
      section("Nuovi annunci", nuovi, false),
      section("Prezzo ribassato", ribassati, false),
      section("Prezzo aumentato", aumentati, false),
      section("Non più online", rimossi, false, "Annunci spariti dal portale: probabilmente venduti o ritirati"),
    );
  } else {
    parts.push(
      `<tr><td style="padding:4px 16px 16px 16px;font-family:${FONT};font-size:15px;color:#374151">Nessuna novità oggi. In galleria restano ${summary.galleryTotal} annunci attivi.</td></tr>`,
    );
  }
  const body = parts.join("");

  const sourcesHtml = summary.sources
    .map((s) => `<tr><td style="padding:2px 8px 2px 0">${escapeHtml(s.name)}</td><td style="padding:2px 8px">${escapeHtml(s.status)}</td><td style="padding:2px 0;text-align:right">${s.count}</td></tr>`)
    .join("");
  const skipHtml = summary.skippedZone.length
    ? `<p style="margin:8px 0 0 0">Scartati perché fuori zona: ${escapeHtml(summary.skippedZone.join(", "))}</p>`
    : "";
  const rechHtml = summary.rechecked != null
    ? `<p style="margin:8px 0 0 0">Annunci già in galleria ricontrollati oggi: ${summary.rechecked}</p>`
    : "";

  const headline = `${nuovi.length} nuove · ${ribassati.length} ribassate · ${aumentati.length} aumentate · ${rimossi.length} rimosse`;
  const subline = `${nPrivatiNuovi} nuove da privati${summary.favorites.length ? ` · ${favChanged} novità sui tuoi preferiti` : ""}`;

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6"><tr><td align="center" style="padding:16px 0">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
<tr><td bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:8px 8px 0 0;padding:20px 16px;font-family:${FONT}">
<div style="color:#bfdbfe;font-size:12px;letter-spacing:1px;text-transform:uppercase">Case Bergamo · ${escapeHtml(summary.date)}</div>
<div style="color:#ffffff;font-size:22px;font-weight:800;margin:4px 0">${headline}</div>
<div style="color:#dbeafe;font-size:13px;margin-bottom:4px">${subline}</div>
<div style="color:#dbeafe;font-size:13px;margin-bottom:12px">180–220 k€ · 3+ locali · box incluso · Bergamo e cintura</div>
</td></tr>
<tr><td style="height:16px;line-height:16px;font-size:0">&nbsp;</td></tr>
${body}
<tr><td style="padding:8px 16px 24px 16px;font-family:${FONT};font-size:12px;color:#6b7280">
<div style="font-weight:700;color:#374151;margin-bottom:4px">Fonti consultate</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12px;color:#6b7280">${sourcesHtml}</table>
${rechHtml}
${skipHtml}
<p style="margin:8px 0 0 0">Classe energetica: verde A–B, giallo C–D, arancio E, rosso F–G, grigio = non indicata o in attesa di certificazione.</p>
<p style="margin:12px 0 0 0">Dati letti in automatico da portali pubblici: verifica sempre prezzo, box e disponibilità sull'annuncio originale.</p>
</td></tr></table></td></tr></table>`;

  const subject = `Case Bergamo – ${summary.date}: ${nuovi.length} nuove, ${ribassati.length} ribassate, ${aumentati.length} aumentate, ${rimossi.length} rimosse`;

  const textLines: string[] = [`Case Bergamo – ${summary.date}`, headline, ""];
  textSection(textLines, "Preferiti", summary.favorites);
  textSection(textLines, "Nuovi", nuovi);
  textSection(textLines, "Ribassati", ribassati);
  textSection(textLines, "Aumentati", aumentati);
  textSection(textLines, "Rimossi", rimossi);
  if (!listings.length) textLines.push("Nessuna novità oggi.");
  const text = textLines.join("\n");

  return { subject, html, text };
}
