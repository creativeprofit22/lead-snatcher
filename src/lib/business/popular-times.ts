/**
 * Popular Times scraper.
 *
 * Hits Google's internal map search endpoint (the same one that serves the
 * "Busy times" widget on Maps), extracts the populartimes histogram and
 * current popularity from the embedded JSON-shaped response.
 *
 * Ported from the Python reference implementation at
 * https://github.com/GrocerCheck/LivePopularTimes (LGPL — only the URL +
 * pb-encoding pattern + array-traversal indices are reused; this is a
 * clean-room TypeScript implementation, no copied code).
 *
 * Fragility warning: the response shape is undocumented Google internals.
 * Array indices may shift if Google changes their renderer. All parsing
 * is defensive — we return null on any unexpected shape rather than
 * crash the caller.
 *
 * Usage is opt-in per-lead from the CRM detail view. Cache the result on
 * the Lead row; do NOT auto-refresh.
 */

const SEARCH_URL_BASE = 'https://www.google.com/search';

// Generic pb parameter — encodes viewport + tile sizing for Google's map
// search renderer. Lifted from the upstream populartimes lib because the
// values that work are entirely magic-number; constructing this from
// scratch requires reverse-engineering Google's protobuf schema.
const PB_PARAM =
  '!4m12!1m3!1d4005.9771522653964!2d-122.42072974863942!3d37.8077459796541!2m3!1f0!2f0!3f0!3m2!1i1125!2i976!4f13.1!7i20!10b1!12m6!2m3!5m1!6e2!20e3!10b1!16b1!19m3!2m2!1i392!2i106!20m61!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i200!7m46!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e3!2b0!3e3!1m3!1e4!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e3!2b1!3e2!1m3!1e9!2b1!3e2!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!2b1!4b1!9b0!22m6!1sa9fVWea_MsX8adX8j8AE%3A1!2zMWk6Mix0OjExODg3LGU6MSxwOmE5ZlZXZWFfTXNYOGFkWDhqOEFFOjE!7e81!12e3!17sa9fVWea_MsX8adX8j8AE%3A564!18e15!24m15!2b1!5m4!2b1!3b1!5b1!6b1!10m1!8e3!17b1!24b1!25b1!26b1!30m1!2b1!36b1!26m3!2m2!1i80!2i92!30m28!1m6!1m2!1i0!2i0!2m2!1i458!2i976!1m6!1m2!1i1075!2i0!2m2!1i1125!2i976!1m6!1m2!1i0!2i0!2m2!1i1125!2i20!1m6!1m2!1i0!2i956!2m2!1i1125!2i976!37m1!1e81!42b1!47m0!49m1!3b1';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const REQUEST_TIMEOUT_MS = 15000;

export type DayOfWeek =
  | 'Mon'
  | 'Tue'
  | 'Wed'
  | 'Thu'
  | 'Fri'
  | 'Sat'
  | 'Sun';

const DAY_LABELS: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface PopularTimesData {
  /**
   * 7 × 24 grid of busyness percentages (0-100). `weekly[0]` = Monday,
   * `weekly[6]` = Sunday. `weekly[d][h]` is the percentage for hour h
   * (0-23) on day d. Hours with no data are 0.
   */
  weekly: number[][];
  /** Current real-time popularity 0-100. Undefined when business is closed. */
  currentPopularity?: number;
  /** Human-readable typical visit duration, e.g. "1-2 hours". */
  timeSpent?: string;
  /** Day labels in the order weekly[] is indexed. */
  dayLabels: DayOfWeek[];
}

export interface ScrapeFailure {
  reason:
    | 'fetch_failed'
    | 'response_unparseable'
    | 'no_data_found'
    | 'timeout';
  message: string;
}

export type PopularTimesResult =
  | { ok: true; data: PopularTimesData }
  | { ok: false; failure: ScrapeFailure };

/**
 * Defensively walk a nested array/object with a sequence of indices.
 * Returns undefined at the first hop that misses.
 */
function indexGet(target: unknown, ...path: (number | string)[]): unknown {
  let cur: unknown = target;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key as string | number];
  }
  return cur;
}

/**
 * Scrape Popular Times for a business. Pass the full search query Google
 * Maps would use — typically `name + address`. Returns null-shaped result
 * on any failure; never throws.
 */
export async function scrapePopularTimes(
  query: string
): Promise<PopularTimesResult> {
  const params = new URLSearchParams({
    tbm: 'map',
    tch: '1',
    hl: 'en',
    q: query,
    pb: PB_PARAM,
  });

  const url = `${SEARCH_URL_BASE}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let raw: string;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        failure: {
          reason: 'fetch_failed',
          message: `Google returned HTTP ${res.status}`,
        },
      };
    }
    raw = await res.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        failure: {
          reason: 'timeout',
          message: `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        },
      };
    }
    return {
      ok: false,
      failure: {
        reason: 'fetch_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timeout);
  }

  // Google's response wraps the JSON in a `/*""*/` prefix marker; trim it
  // and clip to the last closing brace so JSON.parse sees clean input.
  const marker = '/*""*/';
  const head = raw.split(marker)[0] ?? raw;
  const lastBrace = head.lastIndexOf('}');
  if (lastBrace < 0) {
    return {
      ok: false,
      failure: {
        reason: 'response_unparseable',
        message: 'No JSON closing brace in response (Google may have changed the format)',
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(head.slice(0, lastBrace + 1));
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: 'response_unparseable',
        message: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  // Place metadata blob — populartimes lives at [0][1][0][14] in the
  // upstream lib's reverse-engineered indexing.
  const info = indexGet(parsed, 0, 1, 0, 14);
  if (!info) {
    return {
      ok: false,
      failure: {
        reason: 'no_data_found',
        message: 'Could not find place metadata in response',
      },
    };
  }

  // Histogram — array of [day_number, [[hour, busy_percent, ...], ...]]
  const rawWeekly = indexGet(info, 84, 0);
  // Current real-time popularity — number 0-100 or undefined when closed
  const currentPopularity = indexGet(info, 84, 7, 1);
  // Typical visit duration string
  const timeSpentRaw = indexGet(info, 117, 0);

  if (!Array.isArray(rawWeekly) || rawWeekly.length === 0) {
    return {
      ok: false,
      failure: {
        reason: 'no_data_found',
        message: 'No popular times data — Google may not have enough visit data for this business',
      },
    };
  }

  // Initialise 7×24 grid of zeros
  const weekly: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );

  for (const day of rawWeekly) {
    if (!Array.isArray(day)) continue;
    const dayNum = day[0];
    const hours = day[1];
    if (typeof dayNum !== 'number' || !Array.isArray(hours)) continue;
    // Google indexes Sunday=1 in some responses, Monday=1 in others.
    // Empirically the upstream lib treats day_no - 1 as Mon-Sun.
    const idx = ((dayNum - 1) % 7 + 7) % 7;
    for (const hourEntry of hours) {
      if (!Array.isArray(hourEntry)) continue;
      const hour = hourEntry[0];
      const busy = hourEntry[1];
      if (
        typeof hour === 'number' &&
        hour >= 0 &&
        hour < 24 &&
        typeof busy === 'number'
      ) {
        const day = weekly[idx];
        if (day) day[hour] = busy;
      }
    }
  }

  // Pull a clean string out of timeSpentRaw — it's typically a single-element
  // array or a plain string. Fall back to undefined if shape unexpected.
  const timeSpent =
    typeof timeSpentRaw === 'string'
      ? timeSpentRaw
      : Array.isArray(timeSpentRaw) && typeof timeSpentRaw[0] === 'string'
        ? timeSpentRaw[0]
        : undefined;

  return {
    ok: true,
    data: {
      weekly,
      currentPopularity:
        typeof currentPopularity === 'number' ? currentPopularity : undefined,
      timeSpent,
      dayLabels: DAY_LABELS,
    },
  };
}
