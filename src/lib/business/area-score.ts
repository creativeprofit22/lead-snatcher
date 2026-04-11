/**
 * Area Quality Scoring via OpenStreetMap Overpass API
 *
 * Queries OSM for premium amenities (banks, hotels, hospitals, etc.)
 * within a radius of the search coordinates. High density of these
 * amenities = commercially validated zone = businesses with money.
 *
 * Free, no auth, works globally (Tulsa, Guadalajara, Tokyo, Lagos).
 */

const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Premium amenities that indicate money flows through an area
const PREMIUM_AMENITIES = [
  'bank',
  'atm',
  'hotel',
  'hospital',
  'pharmacy',
  'supermarket',
  'fuel',
  'car_rental',
] as const;

// Tourism/leisure that indicate affluence
const AFFLUENCE_AMENITIES = ['gym', 'spa', 'cinema', 'theatre'] as const;

export interface AreaScore {
  /** 0-100 commercial quality score */
  score: number;
  /** Human-readable level */
  level: 'premium' | 'commercial' | 'moderate' | 'developing';
  /** Label for display */
  label: string;
  /** Explanation */
  description: string;
  /** Raw amenity counts */
  amenities: {
    banks: number;
    hotels: number;
    hospitals: number;
    pharmacies: number;
    supermarkets: number;
    fuelStations: number;
    affluenceSpots: number;
    total: number;
  };
  /** Search radius used in meters */
  radiusMeters: number;
}

/**
 * Query Overpass API for premium amenities near coordinates
 */
export async function scoreArea(
  latitude: number,
  longitude: number,
  radiusMeters: number = 1500
): Promise<AreaScore> {
  const defaultScore: AreaScore = {
    score: 50,
    level: 'moderate',
    label: 'Moderate Area',
    description: 'Could not assess area — using neutral score',
    amenities: {
      banks: 0,
      hotels: 0,
      hospitals: 0,
      pharmacies: 0,
      supermarkets: 0,
      fuelStations: 0,
      affluenceSpots: 0,
      total: 0,
    },
    radiusMeters,
  };

  try {
    // Build Overpass QL query — count premium amenities within radius
    const allAmenities = [...PREMIUM_AMENITIES, ...AFFLUENCE_AMENITIES];

    // Query to get per-amenity counts
    const detailQuery = `
      [out:json][timeout:10];
      (
        node["amenity"~"^(${allAmenities.join('|')})$"](around:${radiusMeters},${latitude},${longitude});
        way["amenity"~"^(${allAmenities.join('|')})$"](around:${radiusMeters},${latitude},${longitude});
        node["tourism"="hotel"](around:${radiusMeters},${latitude},${longitude});
        way["tourism"="hotel"](around:${radiusMeters},${latitude},${longitude});
      );
      out tags;
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(detailQuery)}`,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error('Overpass API error:', response.status);
      return defaultScore;
    }

    const data = await response.json();
    const elements = data.elements || [];

    // Count amenities by type
    const counts = {
      banks: 0,
      hotels: 0,
      hospitals: 0,
      pharmacies: 0,
      supermarkets: 0,
      fuelStations: 0,
      affluenceSpots: 0,
      total: elements.length,
    };

    for (const el of elements) {
      const amenity = el.tags?.amenity || '';
      const tourism = el.tags?.tourism || '';

      if (amenity === 'bank' || amenity === 'atm') counts.banks++;
      else if (amenity === 'hotel' || tourism === 'hotel') counts.hotels++;
      else if (amenity === 'hospital') counts.hospitals++;
      else if (amenity === 'pharmacy') counts.pharmacies++;
      else if (amenity === 'supermarket') counts.supermarkets++;
      else if (amenity === 'fuel' || amenity === 'car_rental') counts.fuelStations++;
      else if (['gym', 'spa', 'cinema', 'theatre'].includes(amenity)) counts.affluenceSpots++;
    }

    // Calculate score (0-100)
    // Banks are the strongest signal (financial services = money)
    // Hotels = commercial/tourist activity
    // Hospitals/pharmacies = infrastructure investment
    const score = Math.min(
      100,
      Math.round(
        counts.banks * 6 +
          counts.hotels * 5 +
          counts.hospitals * 8 +
          counts.pharmacies * 3 +
          counts.supermarkets * 2 +
          counts.fuelStations * 2 +
          counts.affluenceSpots * 4
      )
    );

    // Determine level
    let level: AreaScore['level'];
    let label: string;
    let description: string;

    if (score >= 75) {
      level = 'premium';
      label = 'Premium Zone';
      description = `${counts.banks} banks, ${counts.hotels} hotels nearby — high-value commercial area`;
    } else if (score >= 50) {
      level = 'commercial';
      label = 'Commercial Zone';
      description = `Active commercial area with ${counts.total} key amenities nearby`;
    } else if (score >= 25) {
      level = 'moderate';
      label = 'Moderate Zone';
      description = `Some commercial activity (${counts.total} amenities) — growing area`;
    } else {
      level = 'developing';
      label = 'Developing Zone';
      description = `Limited commercial infrastructure (${counts.total} amenities) — emerging market`;
    }

    return { score, level, label, description, amenities: counts, radiusMeters };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Overpass API timeout');
    } else {
      console.error('Area scoring error:', error);
    }
    return defaultScore;
  }
}
