import * as z from "zod/v4";

export const UpsertListingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  comune: z.string().min(1),
  zona: z.string().nullable(),
  price: z.number().int().positive(),
  mq: z.number().int().positive(),
  locali: z.number().int().positive(),
  box: z.string().nullable(),
  sellerText: z.string().nullable(),
  energyClassCode: z.string().nullable().optional(),
  energyText: z.string().nullable(),
  descriptionRaw: z.string(),
  photos: z.array(z.string()).max(5),
  floorplanUrl: z.string().nullable(),
  portal: z.string().min(1),
  url: z.string().min(1),
  details: z.string().nullable(),
  dateInfo: z.string().nullable(),
});
export type UpsertListingInput = z.infer<typeof UpsertListingSchema>;

export const MarkRemovedSchema = z.object({ id: z.string().min(1) });

export const SetRatingSchema = z.object({
  id: z.string().min(1),
  rating: z.enum(["interessante", "visita_fissata", "scartata"]),
});

const DailySummaryListingSchema = z.object({
  id: z.string(), portal: z.string(), url: z.string(), title: z.string(),
  comune: z.string(), zona: z.string().nullable(), price: z.number(),
  oldPrice: z.number().nullable(), mq: z.number(), locali: z.number(),
  box: z.string().nullable(), energy: z.string(), history: z.string(),
  daysOnline: z.number(), notes: z.string().nullable(), seller: z.string(),
  status: z.enum(["nuovo", "ribassato", "aumentato", "rimosso", "invariato"]),
  rating: z.string().nullable(), dateInfo: z.string().nullable(),
  otherLinks: z.array(z.object({ portal: z.string(), url: z.string() })),
  dataWarning: z.boolean(),
  photos: z.array(z.string()).default([]),
  floorplanUrl: z.string().nullable().default(null),
});

export const RenderSummaryEmailSchema = z.object({
  date: z.string(),
  galleryTotal: z.number(),
  favorites: z.array(DailySummaryListingSchema),
  listings: z.array(DailySummaryListingSchema),
  rechecked: z.number().nullable(),
  sources: z.array(z.object({ name: z.string(), status: z.string(), count: z.number() })),
  skippedZone: z.array(z.string()),
});
export type RenderSummaryEmailInput = z.infer<typeof RenderSummaryEmailSchema>;
