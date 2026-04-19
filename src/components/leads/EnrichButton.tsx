'use client';

import { Zap, Check, RotateCcw, Loader2 } from 'lucide-react';
import {
  previewEnrichment,
  tooltipCopy,
} from '@/lib/business/enrichment-preview';

export type EnrichmentStatus =
  | 'idle'
  | 'enriching'
  | 'enriched'
  | 'rate_limited'
  | 'error';

interface Props {
  lead: {
    website?: string;
    socialLinks?: Partial<Record<string, string | undefined>>;
  };
  status: EnrichmentStatus;
  onClick: () => void;
  /**
   * When true, shows first-time explainer modal before firing onClick.
   * Parent owns the explainer state — this just tells it we want to
   * show it if it hasn't been shown yet.
   */
  onRequestExplainer?: () => boolean;
}

/**
 * Per-card enrichment trigger. The tooltip, aria-label, and disabled
 * state are all derived from the lead's current data — so a user
 * hovering sees exactly what they'll get and what it will cost.
 *
 * States:
 *   idle          — ready, tooltip tells user what will be found
 *   enriching     — spinner, button disabled
 *   enriched      — success check (ephemeral; parent flips back to idle
 *                   once the found-data diff banner fades)
 *   rate_limited  — retry icon, tooltip explains the limit
 *   error         — retry icon, tooltip shows the error
 *
 * Returns null when the lead already has both website + socials. No
 * greyed-out noise — just removes the button.
 */
export function EnrichButton({ lead, status, onClick, onRequestExplainer }: Props) {
  const preview = previewEnrichment(lead);

  if (preview.alreadyEnriched && status === 'idle') {
    return null;
  }

  const handleClick = () => {
    if (status === 'enriching' || status === 'enriched') return;
    // If explainer is owed, give the parent a chance to intercept.
    // onRequestExplainer returns true when it intercepted (showed
    // the modal) and we should NOT fire the enrichment yet — the
    // modal's Continue handler will re-trigger it. When false, the
    // explainer was already acknowledged; proceed.
    if (onRequestExplainer?.()) return;
    onClick();
  };

  const { label, icon, tooltip, tone } = renderState(status, preview);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === 'enriching' || status === 'enriched'}
      title={tooltip}
      aria-label={tooltip}
      data-status={status}
      className={`lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm transition-colors ${tone}`}
    >
      {icon}
      {label}
    </button>
  );
}

function renderState(
  status: EnrichmentStatus,
  preview: ReturnType<typeof previewEnrichment>
): { label: string; icon: React.ReactNode; tooltip: string; tone: string } {
  const iconClass = 'w-3.5 h-3.5';
  switch (status) {
    case 'enriching':
      return {
        label: 'Enriching…',
        icon: <Loader2 className={`${iconClass} animate-spin`} />,
        tooltip: 'Searching the web for missing contact data',
        tone: 'opacity-70',
      };
    case 'enriched':
      return {
        label: 'Enriched',
        icon: <Check className={iconClass} />,
        tooltip: 'Enrichment complete',
        tone: 'bg-emerald-500/15 text-emerald-300',
      };
    case 'rate_limited':
      return {
        label: 'Retry',
        icon: <RotateCcw className={iconClass} />,
        tooltip:
          'Rate-limited — wait a moment, then click to retry this lead',
        tone: 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25',
      };
    case 'error':
      return {
        label: 'Retry',
        icon: <RotateCcw className={iconClass} />,
        tooltip: 'Enrichment failed — click to retry',
        tone: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
      };
    case 'idle':
    default:
      return {
        label: 'Enrich',
        icon: <Zap className={iconClass} />,
        tooltip: tooltipCopy(preview),
        tone: 'bg-sky-500/15 text-sky-300 hover:bg-sky-500/25',
      };
  }
}
