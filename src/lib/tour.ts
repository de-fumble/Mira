// The first-run tours, and which ones someone has already seen (kept in their
// Supabase user metadata as `tours`, so it follows them to every device).

export const TOUR_IDS = ["home", "document"] as const;
export type TourId = (typeof TOUR_IDS)[number];

export const isTourId = (v: unknown): v is TourId => TOUR_IDS.includes(v as TourId);

/** The tours listed in a user's metadata (anything unexpected is ignored). */
export const toursSeen = (meta: Record<string, unknown> | null | undefined): TourId[] =>
  Array.isArray(meta?.tours) ? meta.tours.filter(isTourId) : [];
