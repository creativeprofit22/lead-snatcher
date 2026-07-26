import { z } from 'zod';
import { zoneArchetypeSchema, zoneLevelSchema } from './zone-contract';

export const regionDirectionSchema = z.enum([
  'nw',
  'n',
  'ne',
  'w',
  'central',
  'e',
  'sw',
  's',
  'se',
]);

export type RegionDirection = z.infer<typeof regionDirectionSchema>;

export const regionSummarySchema = z.object({
  direction: regionDirectionSchema,
  label: z.string(),
  score: z.number(),
  zoneCount: z.number(),
  topLabel: z.string().nullable(),
});

export type RegionSummary = z.infer<typeof regionSummarySchema>;

export const neighborhoodSuggestionSchema = z.object({
  label: z.string(),
  score: z.number(),
  wealthScore: z.number(),
  businessScore: z.number(),
  archetype: zoneArchetypeSchema,
  level: zoneLevelSchema,
  latitude: z.number(),
  longitude: z.number(),
  region: regionDirectionSchema,
});

export type NeighborhoodSuggestion = z.infer<typeof neighborhoodSuggestionSchema>;

export const neighborhoodLookupResponseSchema = z.object({
  regions: z.array(regionSummarySchema),
  zones: z.array(neighborhoodSuggestionSchema),
  singleZone: z.boolean(),
  city: z.string().optional(),
});

export type NeighborhoodLookupResponse = z.infer<typeof neighborhoodLookupResponseSchema>;
