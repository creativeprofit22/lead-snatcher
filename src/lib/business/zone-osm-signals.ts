import type { ZoneAmenityFeature, ZoneAmenityKey } from './zone-scoring';

type TagToAmenityKey = Readonly<Record<string, ZoneAmenityKey>>;

// Single source of truth for both the Overpass query and element classification.
export const ZONE_TAG_TO_AMENITY_KEY = {
  amenity: {
    bank: 'banks',
    atm: 'banks',
    hotel: 'hotels',
    hospital: 'hospitals',
    pharmacy: 'pharmacies',
    supermarket: 'supermarkets',
    fuel: 'fuelStations',
    car_rental: 'fuelStations',
    gym: 'affluenceSpots',
    spa: 'affluenceSpots',
    cinema: 'affluenceSpots',
    theatre: 'affluenceSpots',
    casino: 'casinos',
    pawnshop: 'pawnshops',
    money_lender: 'moneyLenders',
    social_facility: 'socialFacilities',
  } satisfies TagToAmenityKey,
  shop: {
    jewelry: 'luxuryRetail',
    watches: 'luxuryRetail',
    boutique: 'luxuryRetail',
    art: 'luxuryRetail',
    antiques: 'luxuryRetail',
    wine: 'luxuryRetail',
    gallery: 'luxuryRetail',
    pawnbroker: 'pawnshops',
    charity: 'charityShops',
    second_hand: 'charityShops',
  } satisfies TagToAmenityKey,
  office: {
    financial: 'professionalServices',
    financial_advisor: 'professionalServices',
    lawyer: 'professionalServices',
    accountant: 'professionalServices',
    insurance: 'professionalServices',
    notary: 'professionalServices',
    tax_advisor: 'professionalServices',
    company: 'corporateOffices',
    consulting: 'corporateOffices',
    it: 'corporateOffices',
    advertising_agency: 'corporateOffices',
    coworking: 'corporateOffices',
    research: 'corporateOffices',
    estate_agent: 'corporateOffices',
    government: 'corporateOffices',
  } satisfies TagToAmenityKey,
} as const;

type ZoneTagName = keyof typeof ZONE_TAG_TO_AMENITY_KEY;
export type ZoneQueryTagSets = {
  readonly [TagName in ZoneTagName]: readonly (keyof (typeof ZONE_TAG_TO_AMENITY_KEY)[TagName])[];
};

function tagValues<Mapping extends TagToAmenityKey>(
  mapping: Mapping
): readonly Extract<keyof Mapping, string>[] {
  return Object.keys(mapping) as Extract<keyof Mapping, string>[];
}

export const ZONE_QUERY_TAG_SETS = {
  amenity: tagValues(ZONE_TAG_TO_AMENITY_KEY.amenity),
  shop: tagValues(ZONE_TAG_TO_AMENITY_KEY.shop),
  office: tagValues(ZONE_TAG_TO_AMENITY_KEY.office),
} satisfies ZoneQueryTagSets;

export const ZONE_NAMED_PLACE_VALUES = [
  'suburb',
  'neighbourhood',
  'quarter',
  'city_district',
  'borough',
  'locality',
] as const;
export const ZONE_NAMED_LANDUSE_VALUES = ['commercial', 'retail'] as const;
export const ZONE_NAMED_ADMIN_LEVELS = ['9', '10'] as const;

const NAMED_PLACE_VALUES = new Set<string>(ZONE_NAMED_PLACE_VALUES);
const NAMED_LANDUSE_VALUES = new Set<string>(ZONE_NAMED_LANDUSE_VALUES);
const NAMED_ADMIN_LEVELS = new Set<string>(ZONE_NAMED_ADMIN_LEVELS);

const TAG_CLASSIFIER_LOOKUPS = {
  amenity: new Map(Object.entries(ZONE_TAG_TO_AMENITY_KEY.amenity)),
  shop: new Map(Object.entries(ZONE_TAG_TO_AMENITY_KEY.shop)),
  office: new Map(Object.entries(ZONE_TAG_TO_AMENITY_KEY.office)),
} as const;

export interface ZoneSignalElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface NamedPlace {
  lat: number;
  lon: number;
  name: string;
  /** Small OSM prominence bonus used only to break near-ties between place zones. */
  prominence: number;
}

export interface DecodedZoneSignals {
  amenities: ZoneAmenityFeature[];
  places: NamedPlace[];
}

/** Classify one queried OSM tag using the same mapping that builds the query. */
export function classifyZoneTags(tags: Record<string, string>): ZoneAmenityKey | undefined {
  return (
    TAG_CLASSIFIER_LOOKUPS.shop.get(tags.shop ?? '') ??
    TAG_CLASSIFIER_LOOKUPS.office.get(tags.office ?? '') ??
    TAG_CLASSIFIER_LOOKUPS.amenity.get(tags.amenity ?? '')
  );
}

function prominenceBonus(tags: Record<string, string>): number {
  let bonus = 0;
  if (tags.wikidata) bonus += 3;
  if (tags.wikipedia) bonus += 3;
  if (tags.tourism) bonus += 2;
  if (tags.place === 'suburb') bonus += 2;
  else if (tags.place === 'city_district' || tags.place === 'borough') bonus += 1;
  return Math.min(10, bonus);
}

// Diacritics are allowed, while names whose base glyphs use another script are rejected.
function isLatinOnly(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

function pickEnglishName(tags: Record<string, string>): string | null {
  const englishName = tags['name:en']?.trim();
  if (englishName && isLatinOnly(englishName)) return englishName;

  const nativeName = tags.name?.trim();
  if (nativeName && isLatinOnly(nativeName)) return nativeName;

  return null;
}

function isPremiumHotel(tags: Record<string, string>): boolean {
  const firstCharacter = tags.stars?.trim()[0];
  if (!firstCharacter) return false;

  const stars = Number.parseInt(firstCharacter, 10);
  return Number.isFinite(stars) && stars >= 4;
}

function isNamedPlaceCandidate(tags: Record<string, string>): boolean {
  return (
    NAMED_PLACE_VALUES.has(tags.place ?? '') ||
    NAMED_LANDUSE_VALUES.has(tags.landuse ?? '') ||
    (tags.boundary === 'administrative' && NAMED_ADMIN_LEVELS.has(tags.admin_level ?? ''))
  );
}

function decodeNamedPlace(
  tags: Record<string, string>,
  latitude: number,
  longitude: number
): NamedPlace | null {
  // OSM locality is a named point rather than necessarily a settlement.
  if (tags.place === 'locality' && !tags.wikidata && !tags.wikipedia && !tags.tourism) {
    return null;
  }

  const name = pickEnglishName(tags);
  return name ? { lat: latitude, lon: longitude, name, prominence: prominenceBonus(tags) } : null;
}

export function decodeZoneElements(elements: readonly ZoneSignalElement[]): DecodedZoneSignals {
  const amenities: ZoneAmenityFeature[] = [];
  const places: NamedPlace[] = [];

  for (const element of elements) {
    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;

    const tags = element.tags ?? {};
    if (isNamedPlaceCandidate(tags)) {
      const place = decodeNamedPlace(tags, latitude, longitude);
      if (place) places.push(place);
      continue;
    }

    const amenityKeys: ZoneAmenityKey[] = [];
    if (tags.amenity === 'hotel' || tags.tourism === 'hotel') {
      amenityKeys.push('hotels');
      if (isPremiumHotel(tags)) amenityKeys.push('premiumHotels');
    } else {
      const classifiedKey = classifyZoneTags(tags);
      if (classifiedKey) amenityKeys.push(classifiedKey);
    }

    // Named office buildings have no office=* value and need an explicit rule.
    if (
      amenityKeys.length === 0 &&
      tags.building === 'office' &&
      (Boolean(tags.name) || Boolean(tags.operator))
    ) {
      amenityKeys.push('corporateOffices');
    }

    if (amenityKeys.length > 0) {
      amenities.push({
        sourceId: `${element.type}:${element.id}`,
        latitude,
        longitude,
        amenityKeys,
      });
    }
  }

  return { amenities, places };
}
