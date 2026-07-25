import type { ZoneBbox } from './zone-contract';
import {
  ZONE_NAMED_ADMIN_LEVELS,
  ZONE_NAMED_LANDUSE_VALUES,
  ZONE_NAMED_PLACE_VALUES,
  ZONE_QUERY_TAG_SETS,
} from './zone-osm-signals';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements?: OverpassElement[];
}

export type OverpassFetchResult =
  | { status: 'ok'; elements: OverpassElement[] }
  | { status: 'unavailable'; elements: [] };

export type OverpassFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface FetchZoneElementsOptions {
  fetch?: OverpassFetch;
  mirrors?: readonly string[];
  serverTimeoutSeconds?: number;
  clientTimeoutMs?: number;
  logger?: Pick<Console, 'error'>;
}

// OSM-FR and OSM-CH lead because they have recently been the most reliable.
export const OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
] as const;

export const OVERPASS_SERVER_TIMEOUT_SECONDS = 30;
// Keep the client budget above the server budget so completed dense-city scans can return.
export const OVERPASS_CLIENT_TIMEOUT_MS = 35_000;

export function buildZoneOverpassQuery(
  bbox: ZoneBbox,
  serverTimeoutSeconds = OVERPASS_SERVER_TIMEOUT_SECONDS
): string {
  const [south, north, west, east] = bbox;
  const bboxClause = `${south},${west},${north},${east}`;
  const amenityRegex = ZONE_QUERY_TAG_SETS.amenity.join('|');
  const shopRegex = ZONE_QUERY_TAG_SETS.shop.join('|');
  const officeRegex = ZONE_QUERY_TAG_SETS.office.join('|');
  const placeRegex = ZONE_NAMED_PLACE_VALUES.join('|');
  const landuseRegex = ZONE_NAMED_LANDUSE_VALUES.join('|');
  const adminLevelRegex = ZONE_NAMED_ADMIN_LEVELS.join('|');

  return `
    [out:json][timeout:${serverTimeoutSeconds}];
    (
      node["amenity"~"^(${amenityRegex})$"](${bboxClause});
      way["amenity"~"^(${amenityRegex})$"](${bboxClause});
      node["tourism"="hotel"](${bboxClause});
      way["tourism"="hotel"](${bboxClause});
      node["shop"~"^(${shopRegex})$"](${bboxClause});
      way["shop"~"^(${shopRegex})$"](${bboxClause});
      node["office"~"^(${officeRegex})$"](${bboxClause});
      way["office"~"^(${officeRegex})$"](${bboxClause});
      way["building"="office"]["name"](${bboxClause});
      way["building"="office"]["operator"](${bboxClause});
      node["place"~"^(${placeRegex})$"](${bboxClause});
      way["place"~"^(${placeRegex})$"](${bboxClause});
      relation["place"~"^(${placeRegex})$"](${bboxClause});
      way["landuse"~"^(${landuseRegex})$"]["name"](${bboxClause});
      relation["landuse"~"^(${landuseRegex})$"]["name"](${bboxClause});
      relation["boundary"="administrative"]["admin_level"~"^(${adminLevelRegex})$"]["name"](${bboxClause});
    );
    out center tags;
  `;
}

/** Race mirrors and return the first non-empty element set, aborting slower siblings. */
export async function fetchZoneElements(
  bbox: ZoneBbox,
  options: FetchZoneElementsOptions = {}
): Promise<OverpassFetchResult> {
  const fetchRequest = options.fetch ?? globalThis.fetch;
  const mirrors = options.mirrors ?? OVERPASS_MIRRORS;
  const clientTimeoutMs = options.clientTimeoutMs ?? OVERPASS_CLIENT_TIMEOUT_MS;
  const logger = options.logger ?? console;
  const query = buildZoneOverpassQuery(
    bbox,
    options.serverTimeoutSeconds ?? OVERPASS_SERVER_TIMEOUT_SECONDS
  );
  const siblingAbort = new AbortController();

  const attempts = mirrors.map(async (endpoint): Promise<OverpassElement[]> => {
    const attemptAbort = new AbortController();
    const abortForWinner = () => attemptAbort.abort();
    siblingAbort.signal.addEventListener('abort', abortForWinner, { once: true });
    const timeout = setTimeout(() => attemptAbort.abort(), clientTimeoutMs);

    try {
      const response = await fetchRequest(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent':
            'LeadSnatcher/1.0 (+https://github.com/creativeprofit22/aloo; Next.js app, low-volume dev use)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: attemptAbort.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = (await response.json()) as OverpassResponse;
      if (!Array.isArray(data.elements) || data.elements.length === 0) {
        throw new Error('empty response');
      }
      return data.elements;
    } finally {
      clearTimeout(timeout);
      siblingAbort.signal.removeEventListener('abort', abortForWinner);
    }
  });

  try {
    const elements = await Promise.any(attempts);
    siblingAbort.abort();
    return { status: 'ok', elements };
  } catch (error) {
    if (error instanceof AggregateError) {
      error.errors.forEach((attemptError, index) => {
        const endpoint = mirrors[index];
        if (attemptError instanceof Error && attemptError.name === 'AbortError') {
          logger.error(
            `Overpass (zone grid) ${endpoint} -> client timeout after ${clientTimeoutMs}ms`
          );
        } else {
          logger.error(
            `Overpass (zone grid) ${endpoint} -> ${
              attemptError instanceof Error ? attemptError.message : String(attemptError)
            }`
          );
        }
      });
      logger.error('Overpass (zone grid) all mirrors exhausted');
    } else {
      logger.error('Overpass (zone grid) unexpected error:', error);
    }
    return { status: 'unavailable', elements: [] };
  }
}
