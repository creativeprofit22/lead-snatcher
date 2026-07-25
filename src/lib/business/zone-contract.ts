import { z } from 'zod';

export const zoneScanStatusSchema = z.enum(['ok', 'unavailable']);

export type ZoneScanStatus = z.infer<typeof zoneScanStatusSchema>;

export const zoneLevelSchema = z.enum(['premium', 'commercial', 'moderate', 'developing']);

export type ZoneLevel = z.infer<typeof zoneLevelSchema>;

/** Two-axis archetype derived from consumer wealth and business density. */
export const zoneArchetypeSchema = z.enum(['luxury', 'corporate', 'mixed', 'developing']);

export type ZoneArchetype = z.infer<typeof zoneArchetypeSchema>;

export const zoneAmenitiesSchema = z.object({
  // Legacy buckets remain required for pre-v2 UI and scoring continuity.
  banks: z.number(),
  hotels: z.number(),
  hospitals: z.number(),
  pharmacies: z.number(),
  supermarkets: z.number(),
  fuelStations: z.number(),
  affluenceSpots: z.number(),
  /** Unique OSM source features inside the scan radius, regardless of category overlap. */
  total: z.number(),

  // Optional so cached payloads created before v2 remain compatible.
  luxuryRetail: z.number().optional(),
  professionalServices: z.number().optional(),
  premiumHotels: z.number().optional(),
  casinos: z.number().optional(),
  corporateOffices: z.number().optional(),
  pawnshops: z.number().optional(),
  moneyLenders: z.number().optional(),
  socialFacilities: z.number().optional(),
  charityShops: z.number().optional(),
});

export type ZoneAmenities = z.infer<typeof zoneAmenitiesSchema>;

export const zoneSchema = z.object({
  id: z.string(),
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  score: z.number(),
  wealthScore: z.number(),
  businessScore: z.number(),
  archetype: zoneArchetypeSchema,
  level: zoneLevelSchema,
  amenities: zoneAmenitiesSchema,
  radiusMeters: z.number(),
  distanceFromCenterMeters: z.number(),
});

export type Zone = z.infer<typeof zoneSchema>;

/** City bounds in [south, north, west, east] order. */
export const zoneBboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export type ZoneBbox = z.infer<typeof zoneBboxSchema>;

export const zoneCentroidSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

export type ZoneCentroid = z.infer<typeof zoneCentroidSchema>;

export const zoneGridResultSchema = z.object({
  status: zoneScanStatusSchema,
  zones: z.array(zoneSchema),
  centroid: zoneCentroidSchema,
  bbox: zoneBboxSchema,
  singleZone: z.boolean(),
});

export type ZoneGridResult = z.infer<typeof zoneGridResultSchema>;
