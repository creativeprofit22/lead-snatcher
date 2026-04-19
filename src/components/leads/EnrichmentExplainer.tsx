'use client';

import { useEffect, useRef } from 'react';
import { Zap, Search, Share2, Clock } from 'lucide-react';

const STORAGE_KEY = 'enrichment-explainer-seen';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Fired when the user confirms — parent resumes the pending enrichment. */
  onContinue: () => void;
}

/**
 * First-time modal. Shown the first time a user clicks any Enrich
 * button. Tells them what/why/cost in three bullets, then lets them
 * continue. The "seen" flag is stored in localStorage — subsequent
 * clicks skip straight to the enrichment.
 *
 * Accessibility: proper dialog semantics, focus trap, Escape closes,
 * initial focus lands on the Continue button (primary action).
 */
export function EnrichmentExplainer({ isOpen, onClose, onContinue }: Props) {
  const continueRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Focus the primary action when the modal opens.
    const t = setTimeout(() => continueRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleContinue = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Private-mode / storage-disabled: the modal will re-appear, not fatal.
    }
    onContinue();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enrichment-explainer-title"
      aria-describedby="enrichment-explainer-body"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-w-md w-full rounded-2xl bg-surface-elevated border border-border-bright p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-sky-500/15 text-sky-300">
            <Zap className="w-5 h-5" />
          </div>
          <h2
            id="enrichment-explainer-title"
            className="text-lg font-semibold text-white"
          >
            What enrichment does
          </h2>
        </div>

        <div id="enrichment-explainer-body" className="space-y-3 mb-5">
          <Bullet
            icon={<Search className="w-4 h-4" />}
            title="Finds missing contact data"
            body="We search the open web for this lead's website and social profiles that Google Maps didn't return."
          />
          <Bullet
            icon={<Share2 className="w-4 h-4" />}
            title="What you'll get"
            body="Website URL · Instagram / Facebook / LinkedIn / X / YouTube / TikTok handles when publicly listed."
          />
          <Bullet
            icon={<Clock className="w-4 h-4" />}
            title="Cost & caching"
            body="About 1–2 API calls per lead from your RapidAPI quota. Results cached 7 days — repeat clicks are free."
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            ref={continueRef}
            type="button"
            onClick={handleContinue}
            className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-sm font-semibold text-white transition-colors"
          >
            Got it, enrich
          </button>
        </div>
      </div>
    </div>
  );
}

function Bullet({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5 text-sky-300">{icon}</div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="text-xs text-gray-400 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

/** Call before firing enrichment. Returns true when the explainer
 *  must be shown first (caller should open it and defer the action). */
export function shouldShowExplainer(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '1';
  } catch {
    return false;
  }
}
