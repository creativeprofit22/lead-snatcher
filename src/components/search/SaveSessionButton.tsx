'use client';

import { useState } from 'react';
import { Bookmark, Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CachedSearch } from '@/lib/search-cache';

interface Props {
  /** Full CachedSearch-shaped payload from the current results view. */
  getPayload: () => Omit<CachedSearch, 'enrichStatusMap' | 'enrichResultMap' | 'selectedForEnrich'>;
  /** Default name suggestion — usually "Industry in City". */
  defaultName?: string;
  /** Optional compact variant for tight header rows. */
  compact?: boolean;
}

/**
 * "Save Session" button — opens a small inline modal that prompts for a
 * name and POSTs to /api/business/saved-sessions. Lives in the results
 * view header; separate from the auto-save resume card flow so users can
 * pin specific sweeps for long-term use or for filming demos.
 */
export function SaveSessionButton({ getPayload, defaultName, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const handleOpen = () => {
    setName(defaultName ?? '');
    setSavedOk(false);
    setOpen(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const payload = getPayload();
      const res = await fetch('/api/business/saved-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Save failed (${res.status})`);
        return;
      }
      setSavedOk(true);
      toast.success(`Saved "${trimmed}"`);
      setTimeout(() => setOpen(false), 700);
    } catch {
      toast.error('Network error while saving');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center gap-2 rounded-lg border border-border-bright/50 bg-surface/60 text-xs font-medium text-white/75 backdrop-blur-sm transition-all hover:border-sky-400/50 hover:bg-surface-hover/60 hover:text-white ${
          compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
        }`}
        title="Save this session to your library"
      >
        <Bookmark className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Save Session</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="hud-panel w-full max-w-md rounded-xl border border-border-bright/60 bg-surface p-5 shadow-[0_24px_80px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-sky-400/85">
                Save Session
              </h2>
              <button
                type="button"
                onClick={() => !saving && setOpen(false)}
                className="rounded-md p-1 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
              Session name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && !saving) handleSave();
              }}
              autoFocus
              maxLength={120}
              placeholder="e.g. HVAC Tucson Demo"
              className="w-full rounded-lg border border-border-bright/50 bg-surface-elevated/70 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-sky-400/60"
            />
            <p className="mt-2 text-[11px] text-white/45">
              Saved sessions persist until you delete them — good for long
              projects or demo takes.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-lg border border-border-bright/40 bg-surface-elevated/50 px-3 py-2 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!name.trim() || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/60 bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_0_14px_rgba(56,189,248,0.4)] transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : savedOk ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Saved
                  </>
                ) : (
                  <>
                    <Bookmark className="h-3.5 w-3.5" />
                    Save
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
