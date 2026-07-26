'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { encodeLeadListQuery, type LeadListFilters } from '@/lib/crm-lead-query';
import { createLeadStatusRecord } from '@/lib/lead-status';
import { industryTypeSchema, leadStatusSchema } from '@/lib/validations';
import type { Lead, LeadStatus, PipelineStats } from '@/types';

const LEADS_ENDPOINT = '/api/leads';
const STATS_ENDPOINT = '/api/leads/stats';

const nullableStringSchema = z.string().nullable();
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(),
});

const leadSchema = z.object({
  id: z.string(),
  placeId: z.string(),
  name: z.string(),
  address: nullableStringSchema,
  phone: nullableStringSchema,
  website: nullableStringSchema,
  rating: z.number().finite().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  industryType: industryTypeSchema,
  photoUrl: nullableStringSchema,
  mapsUrl: nullableStringSchema,
  leadScore: z.number().int().min(0).max(100),
  scoreBreakdown: z.record(z.string(), z.unknown()).nullable(),
  status: leadStatusSchema,
  notes: nullableStringSchema,
  opportunities: z.array(z.string()),
  lastContactedAt: nullableStringSchema,
  nextFollowUpAt: nullableStringSchema,
  savedAt: z.string(),
  updatedAt: z.string(),
  tags: z.array(tagSchema),
  popularTimesData: nullableStringSchema,
  popularTimesScrapedAt: nullableStringSchema,
});

const leadsResponseSchema = z.object({
  leads: z.array(leadSchema),
});

const statusCountsSchema = z.object({
  new: nonNegativeIntegerSchema.optional(),
  contacted: nonNegativeIntegerSchema.optional(),
  called: nonNegativeIntegerSchema.optional(),
  proposal_sent: nonNegativeIntegerSchema.optional(),
  negotiating: nonNegativeIntegerSchema.optional(),
  won: nonNegativeIntegerSchema.optional(),
  lost: nonNegativeIntegerSchema.optional(),
  not_interested: nonNegativeIntegerSchema.optional(),
});

const statsResponseSchema = z.object({
  stats: z.object({
    total: nonNegativeIntegerSchema,
    byStatus: statusCountsSchema,
    conversionRate: z.number().finite().nonnegative(),
    avgLeadScore: z.number().finite().nonnegative().optional().default(0),
    hotLeads: nonNegativeIntegerSchema.optional().default(0),
    coldLeads: nonNegativeIntegerSchema.optional().default(0),
  }),
});

export type CrmReadResource = 'leads' | 'stats';

export class CrmLeadsRequestError extends Error {
  constructor(
    public readonly resource: CrmReadResource,
    public readonly status: number
  ) {
    super(`Failed to load CRM ${resource} (${status})`);
    this.name = 'CrmLeadsRequestError';
  }
}

export class CrmLeadsResponseError extends Error {
  constructor(
    public readonly resource: CrmReadResource,
    message: string
  ) {
    super(message);
    this.name = 'CrmLeadsResponseError';
  }
}

async function readJson(response: Response, resource: CrmReadResource): Promise<unknown> {
  if (!response.ok) {
    throw new CrmLeadsRequestError(resource, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new CrmLeadsResponseError(resource, `CRM ${resource} response is not valid JSON`);
  }
}

export async function fetchCrmLeads(
  query: LeadListFilters,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<Lead[]> {
  const params = encodeLeadListQuery(query);
  const response = await fetcher(`${LEADS_ENDPOINT}?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await readJson(response, 'leads');
  const result = leadsResponseSchema.safeParse(body);

  if (!result.success) {
    throw new CrmLeadsResponseError('leads', 'CRM leads response is malformed');
  }

  return result.data.leads as Lead[];
}

export async function fetchCrmStats(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<PipelineStats> {
  const response = await fetcher(STATS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await readJson(response, 'stats');
  const result = statsResponseSchema.safeParse(body);

  if (!result.success) {
    throw new CrmLeadsResponseError('stats', 'CRM stats response is malformed');
  }

  const byStatus = createLeadStatusRecord((status) => result.data.stats.byStatus[status] ?? 0);
  return { ...result.data.stats, byStatus };
}

export interface CrmLeadsController {
  leads: Lead[];
  leadsLoading: boolean;
  leadsError: Error | null;
  stats: PipelineStats | null;
  statsLoading: boolean;
  statsError: Error | null;
  refreshLeads: () => Promise<void>;
  refreshLeadsForQuery: (query: LeadListFilters) => Promise<void>;
  refreshStats: () => Promise<void>;
  replaceLead: (lead: Lead) => void;
  setLeadStatus: (leadId: string, status: LeadStatus) => void;
  removeLeadIds: (leadIds: readonly string[]) => void;
}

export function useCrmLeadsController(
  query: LeadListFilters,
  fetcher: typeof fetch = fetch
): CrmLeadsController {
  const [storedLeads, setStoredLeads] = useState<Lead[]>([]);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState<Error | null>(null);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<Error | null>(null);
  const leadsRequestVersion = useRef(0);
  const statsRequestVersion = useRef(0);
  const leadsAbortController = useRef<AbortController | null>(null);
  const statsAbortController = useRef<AbortController | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const queryKey = encodeLeadListQuery(query).toString();

  const refreshLeadsForQuery = useCallback(
    async (requestedQuery: LeadListFilters): Promise<void> => {
      const requestVersion = ++leadsRequestVersion.current;
      const requestedQueryKey = encodeLeadListQuery(requestedQuery).toString();
      leadsAbortController.current?.abort();
      const abortController = new AbortController();
      leadsAbortController.current = abortController;

      setStoredLeads([]);
      setLoadedQueryKey(null);
      setLeadsLoading(true);
      setLeadsError(null);

      try {
        const nextLeads = await fetchCrmLeads(requestedQuery, fetcher, abortController.signal);
        if (requestVersion === leadsRequestVersion.current) {
          setStoredLeads(nextLeads);
          setLoadedQueryKey(requestedQueryKey);
        }
      } catch (caughtError) {
        if (requestVersion === leadsRequestVersion.current && !abortController.signal.aborted) {
          setStoredLeads([]);
          setLoadedQueryKey(requestedQueryKey);
          setLeadsError(
            caughtError instanceof Error ? caughtError : new Error('Failed to load CRM leads')
          );
        }
      } finally {
        if (requestVersion === leadsRequestVersion.current) {
          setLeadsLoading(false);
        }
      }
    },
    [fetcher]
  );

  const refreshLeads = useCallback(
    () => refreshLeadsForQuery(queryRef.current),
    [refreshLeadsForQuery]
  );

  const refreshStats = useCallback(async (): Promise<void> => {
    const requestVersion = ++statsRequestVersion.current;
    statsAbortController.current?.abort();
    const abortController = new AbortController();
    statsAbortController.current = abortController;

    setStats(null);
    setStatsLoading(true);
    setStatsError(null);

    try {
      const nextStats = await fetchCrmStats(fetcher, abortController.signal);
      if (requestVersion === statsRequestVersion.current) {
        setStats(nextStats);
      }
    } catch (caughtError) {
      if (requestVersion === statsRequestVersion.current && !abortController.signal.aborted) {
        setStats(null);
        setStatsError(
          caughtError instanceof Error ? caughtError : new Error('Failed to load CRM stats')
        );
      }
    } finally {
      if (requestVersion === statsRequestVersion.current) {
        setStatsLoading(false);
      }
    }
  }, [fetcher]);

  useEffect(() => {
    void refreshLeadsForQuery(query);
  }, [query, refreshLeadsForQuery]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    return () => {
      leadsRequestVersion.current += 1;
      statsRequestVersion.current += 1;
      leadsAbortController.current?.abort();
      statsAbortController.current?.abort();
    };
  }, []);

  const replaceLead = useCallback((updatedLead: Lead) => {
    setStoredLeads((currentLeads) =>
      currentLeads.map((lead) => (lead.id === updatedLead.id ? updatedLead : lead))
    );
  }, []);

  const setLeadStatus = useCallback((leadId: string, status: LeadStatus) => {
    setStoredLeads((currentLeads) =>
      currentLeads.map((lead) => (lead.id === leadId ? { ...lead, status } : lead))
    );
  }, []);

  const removeLeadIds = useCallback((leadIds: readonly string[]) => {
    const removedIdSet = new Set(leadIds);
    setStoredLeads((currentLeads) => currentLeads.filter((lead) => !removedIdSet.has(lead.id)));
  }, []);

  return {
    leads: loadedQueryKey === queryKey ? storedLeads : [],
    leadsLoading: leadsLoading || loadedQueryKey !== queryKey,
    leadsError: loadedQueryKey === queryKey ? leadsError : null,
    stats,
    statsLoading,
    statsError,
    refreshLeads,
    refreshLeadsForQuery,
    refreshStats,
    replaceLead,
    setLeadStatus,
    removeLeadIds,
  };
}
