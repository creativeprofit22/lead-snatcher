'use client';

import { RotateCcw, X, MapPin } from 'lucide-react';
import { getBusinessTypeLabel } from '@/lib/constants';

interface Props {
  businessType: string;
  city: string;
  resultCount: number;
  updatedAt: string; // ISO string from the API
  onResume: () => void;
  onDismiss: () => void;
}

/**
 * Small banner shown on the home screen when the user has a persisted
 * last search. Dismissing hides only this snapshot in the current browser
 * tab; the durable snapshot remains available in other tabs and devices.
 */
export function ResumeSearchCard({
  businessType,
  city,
  resultCount,
  updatedAt,
  onResume,
  onDismiss,
}: Props) {
  const businessTypeLabel = getBusinessTypeLabel(businessType);
  const timeAgo = formatTimeAgo(updatedAt);

  return (
    <div
      role="region"
      aria-label="Resume your last search"
      className="w-full max-w-2xl mx-auto mb-6 rounded-2xl border border-sky-500/30 bg-sky-500/5 backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-sky-500/15 text-sky-300 flex items-center justify-center">
          <RotateCcw className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">
            Resume: {businessTypeLabel} in {city}
          </div>
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            {resultCount} lead{resultCount === 1 ? '' : 's'}
            <span className="text-gray-600">·</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onResume}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-medium transition-colors"
        >
          Resume
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide this search for this browser tab"
          title="Hide this search for this browser tab; it stays available"
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
