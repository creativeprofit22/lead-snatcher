'use client';

import { useEffect, useState } from 'react';
import {
  BookmarkCheck,
  CircleAlert,
  Library,
  Loader2,
  MapPin,
  Play,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SavedSessionMember, SavedSessionSummary } from '@/lib/business/saved-sessions-store';
import { getBusinessTypeLabel } from '@/lib/constants';
import type { PersistedSearchPayload } from '@/lib/business/search-snapshot';

interface Props {
  /** Called with the durable search payload once a session is loaded. */
  onLoad: (payload: PersistedSearchPayload) => void;
}

/**
 * "Saved Sessions" button + modal. Lives on the home screen top-right chrome.
 * Fetches the user's saved sessions on open, lists them with quick actions
 * (Load, Delete). Closes after a Load; doesn't invalidate the cache.
 */
export function SavedSessionsPanel({ onLoad }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SavedSessionSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/business/saved-sessions');
        if (!res.ok) {
          if (!cancelled) setItems([]);
          return;
        }
        const data = (await res.json()) as { sessions?: SavedSessionSummary[] };
        if (!cancelled) setItems(data.sessions ?? []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleLoad = async (id: string, name: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/business/saved-sessions/${id}`);
      if (!res.ok) {
        toast.error(`Couldn't load "${name}"`);
        return;
      }
      const data = (await res.json()) as { session?: SavedSessionMember };
      const session = data.session;
      if (!session) {
        toast.error(`Couldn't load "${name}"`);
        return;
      }
      if (session.status === 'corrupt') {
        setItems((previous) => previous.map((item) => (item.id === id ? session : item)));
        toast.error(`"${name}" is unavailable because its saved data is corrupted`);
        return;
      }
      onLoad(session.payload);
      setOpen(false);
      toast.success(`Loaded "${name}"`);
    } catch {
      toast.error('Network error while loading');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/business/saved-sessions/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error(`Couldn't delete "${name}"`);
        return;
      }
      setItems((prev) => prev.filter((s) => s.id !== id));
      toast.success(`Deleted "${name}"`);
    } catch {
      toast.error('Network error while deleting');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-border-bright/50 bg-surface/60 px-3 py-1.5 text-xs font-medium text-white/75 backdrop-blur-sm transition-colors hover:border-sky-400/50 hover:bg-surface-hover/60 hover:text-white"
        title="Open your saved sessions library"
      >
        <Library className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Saved</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="hud-panel w-full max-w-2xl rounded-xl border border-border-bright/60 bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border-bright/40 px-5 py-4">
              <div className="flex items-center gap-2">
                <BookmarkCheck className="h-4 w-4 text-sky-400/80" />
                <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/75">
                  Saved Sessions
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-white/55">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading sessions…
                </div>
              ) : items.length === 0 ? (
                <div className="py-12 text-center text-sm text-white/55">
                  <Library className="mx-auto mb-3 h-8 w-8 opacity-40" />
                  <p>No saved sessions yet.</p>
                  <p className="mt-1 text-[11px] text-white/40">
                    Run a search, then hit &ldquo;Save Session&rdquo; from the results view to pin
                    it here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border-bright/30">
                  {items.map((session) => {
                    const isBusy = busyId === session.id;
                    const isCorrupt = session.status === 'corrupt';
                    return (
                      <li
                        key={session.id}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-hover/30"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 truncate text-sm font-semibold text-white">
                            {session.name}
                          </div>
                          {isCorrupt ? (
                            <div className="space-y-1 text-[11px] text-amber-200/80">
                              <div className="inline-flex items-center gap-1.5 font-medium">
                                <CircleAlert className="h-3 w-3" aria-hidden="true" />
                                Unavailable
                              </div>
                              <p className="text-white/55">
                                {session.message} Delete it, then run and save the search again.
                              </p>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-white/55">
                              <span className="inline-flex items-center gap-1">
                                <MapPin className="h-3 w-3" aria-hidden="true" />
                                {getBusinessTypeLabel(session.businessType)} · {session.city}
                              </span>
                              <span className="text-white/30">·</span>
                              <span>
                                {session.resultCount} lead{session.resultCount === 1 ? '' : 's'}
                              </span>
                              <span className="text-white/30">·</span>
                              <span>{formatTimeAgo(session.updatedAt)}</span>
                            </div>
                          )}
                        </div>
                        {!isCorrupt && (
                          <button
                            type="button"
                            onClick={() => handleLoad(session.id, session.name)}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-100 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Load
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(session.id, session.name)}
                          disabled={isBusy}
                          className="inline-flex items-center rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-2 text-rose-300/80 transition-colors hover:border-rose-500/50 hover:bg-rose-500/[0.12] disabled:opacity-50"
                          aria-label={`Delete "${session.name}"`}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
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
