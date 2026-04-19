'use client';

import { AlertCircle, X } from 'lucide-react';
import Link from 'next/link';

export interface BannerAction {
  label: string;
  /** External navigation. Takes priority over onClick. */
  href?: string;
  onClick?: () => void;
}

interface Props {
  message: string;
  /** 'error' = rose; 'warning' = amber. */
  severity?: 'error' | 'warning';
  action?: BannerAction;
  onDismiss: () => void;
}

/**
 * Inline error banner shown above the results grid when something
 * goes wrong that the user needs to act on — e.g. session expired,
 * missing RapidAPI key, sustained rate limit. Toasts handle the
 * transient case (network blips, per-lead errors); this component is
 * for errors that won't fix themselves.
 *
 * Dismissing hides it, but the caller also clears it automatically
 * when the next successful action lands — so users don't see stale
 * errors after fixing the root cause.
 */
export function ErrorBanner({
  message,
  severity = 'error',
  action,
  onDismiss,
}: Props) {
  const palette =
    severity === 'warning'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-200';
  const iconPalette =
    severity === 'warning' ? 'text-amber-300' : 'text-rose-300';

  return (
    <div
      role="alert"
      className={`w-full max-w-4xl mx-auto mb-4 rounded-xl border backdrop-blur-sm ${palette}`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <AlertCircle className={`flex-shrink-0 w-5 h-5 ${iconPalette}`} />
        <div className="flex-1 min-w-0 text-sm">{message}</div>

        {action &&
          (action.href ? (
            <Link
              href={action.href}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
            >
              {action.label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
            >
              {action.label}
            </button>
          ))}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
