import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { discoverWebsite, discoverSocials } from '@/lib/business/enrichment';
import {
  getEnrichmentMany,
  putEnrichment,
  type EnrichmentPayload,
} from '@/lib/business/enrichment-cache';
import { checkRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';
import { businessEnrichSchema } from '@/lib/validations';

/**
 * POST /api/business/enrich
 *
 * Streams NDJSON — one line per lead as its enrichment completes.
 * Each line: { businessId, status: 'ok'|'cached'|'rate_limited'|'error',
 *              website?, socials?, error? }
 *
 * Concurrency-capped at 5 businesses in flight. Cache-first: any hit
 * in BusinessEnrichmentCache is emitted instantly with status:'cached'
 * and costs 0 RapidAPI calls. Cache misses fire discoverWebsite and
 * discoverSocials in parallel per business (only for the targets the
 * client flagged as needed).
 *
 * Stream shape lets the UI update each card the moment its row lands,
 * which is the whole point — user sees progress instead of a 30s wait.
 */

const ENRICH_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ip = getClientIp(request);
  const rateKey = `enrich:${session.user.id}:${ip}`;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const parsed = businessEnrichSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: parsed.error.issues[0]?.message ?? 'Invalid request body',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { leads, city } = parsed.data;
  const userId = session.user.id;

  // Pre-warm: bulk cache lookup. Any hit is emitted immediately.
  const cached = await getEnrichmentMany(leads.map((l) => l.businessId));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      // Emit cached hits first — they cost nothing and the UI can render
      // them the moment the stream opens.
      const toFetch: typeof leads = [];
      for (const lead of leads) {
        const hit = cached.get(lead.businessId);
        if (!hit) {
          toFetch.push(lead);
          continue;
        }
        // Cached hit still honors the client's "needs" flags — if the
        // client already has socials but not a website, only return
        // whatever's useful. Full payload is persisted regardless.
        send({
          businessId: lead.businessId,
          status: 'cached',
          website: lead.needsWebsite ? hit.website : undefined,
          socials: lead.needsSocials ? hit.socials : undefined,
        });
      }

      if (toFetch.length === 0) {
        controller.close();
        return;
      }

      // Concurrency-capped worker pool. Each task does a rate-limit
      // check + website+socials in parallel, then writes cache + streams.
      let cursor = 0;
      const worker = async () => {
        while (cursor < toFetch.length) {
          const i = cursor++;
          const lead = toFetch[i];

          const rl = checkRateLimit(rateKey, RATE_LIMITS.enrich);
          if (!rl.success) {
            send({
              businessId: lead.businessId,
              status: 'rate_limited',
              resetIn: Math.max(0, rl.resetTime - Date.now()),
            });
            continue;
          }

          try {
            const [website, socials] = await Promise.all([
              lead.needsWebsite
                ? discoverWebsite(userId, lead.name, city)
                : Promise.resolve(null),
              lead.needsSocials
                ? discoverSocials(userId, lead.name, city)
                : Promise.resolve({}),
            ]);

            const payload: EnrichmentPayload = {};
            if (website) payload.website = website;
            if (socials && Object.keys(socials).length > 0) {
              payload.socials = socials;
            }

            // Write cache even when empty — a confirmed miss is still
            // worth remembering for 7d so we don't re-query a truly
            // invisible lead.
            await putEnrichment(lead.businessId, payload);

            send({
              businessId: lead.businessId,
              status: 'ok',
              website: payload.website,
              socials: payload.socials,
            });
          } catch (err) {
            send({
              businessId: lead.businessId,
              status: 'error',
              error: err instanceof Error ? err.message : 'Enrichment failed',
            });
          }
        }
      };

      const workers = Array.from(
        { length: Math.min(ENRICH_CONCURRENCY, toFetch.length) },
        worker
      );
      await Promise.all(workers);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
