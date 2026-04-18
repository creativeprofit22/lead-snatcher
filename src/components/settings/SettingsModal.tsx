'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Eye, EyeOff, Check, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface ApiKeyState {
  service: string;
  maskedKey: string | null;
  hasKey: boolean;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Per-service display metadata. Adding a new key only requires adding a row
// here plus wiring the service name into the validations enum + settings
// route — the modal renders one card per entry without further code changes.
interface ServiceMeta {
  service: string;
  label: string;
  description: string;
  helpHref: string;
  helpLabel: string;
}

const SERVICES: ServiceMeta[] = [
  {
    service: 'rapidapi',
    label: 'RapidAPI Key',
    description: 'Required for business search (Maps Data API)',
    helpHref: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/google-maps-data',
    helpLabel: 'Get a free RapidAPI key',
  },
  {
    service: 'pagespeed',
    label: 'PageSpeed Insights Key',
    description: 'Optional — enables Deep Analysis (website performance scoring)',
    helpHref: 'https://developers.google.com/speed/docs/insights/v5/get-started',
    helpLabel: 'Get a free PageSpeed key',
  },
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [apiKeys, setApiKeys] = useState<ApiKeyState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Edit/save/delete state is scoped to a single active service so two
  // cards can't fight over the same input.
  const [editingService, setEditingService] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingService, setSavingService] = useState<string | null>(null);
  const [deletingService, setDeletingService] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchApiKeys = useCallback(async () => {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const data = await response.json();
        setApiKeys(data);
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchApiKeys();
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else {
      setIsVisible(false);
      setEditingService(null);
      setInputValue('');
      setShowKey(false);
    }
  }, [isOpen, fetchApiKeys]);

  const handleSave = async (service: string) => {
    if (!inputValue.trim()) return;

    setSavingService(service);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, key: inputValue.trim() }),
      });

      if (response.ok) {
        await fetchApiKeys();
        setEditingService(null);
        setInputValue('');
        setShowKey(false);
        toast.success('API key saved');
      } else {
        toast.error('Failed to save key');
      }
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error('Failed to save key');
    } finally {
      setSavingService(null);
    }
  };

  const handleDelete = async (service: string) => {
    setDeletingService(service);
    try {
      const response = await fetch(`/api/settings?service=${encodeURIComponent(service)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchApiKeys();
        toast.success('API key removed');
      } else {
        toast.error('Failed to remove key');
      }
    } catch (error) {
      console.error('Failed to delete API key:', error);
      toast.error('Failed to remove key');
    } finally {
      setDeletingService(null);
    }
  };

  const handleStartEdit = (service: string) => {
    setEditingService(service);
    setInputValue('');
    setShowKey(false);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 150);
  };

  const handleCancelEdit = () => {
    setEditingService(null);
    setInputValue('');
    setShowKey(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative w-[calc(100vw-1.5rem)] sm:w-full max-w-md mx-3 sm:mx-0 rounded-xl sm:rounded-2xl border border-white/10 bg-black/90 p-4 sm:p-6 shadow-2xl transition-all duration-300 ease-out ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-medium text-white">Settings</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* API Keys */}
        <div className="space-y-4">
          <h3 className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.15em] text-white/50">
            API Configuration
          </h3>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
            </div>
          ) : (
            <div className="space-y-3">
              {SERVICES.map((meta) => {
                const state = apiKeys.find((k) => k.service === meta.service);
                const isEditingThis = editingService === meta.service;
                const isSavingThis = savingService === meta.service;
                const isDeletingThis = deletingService === meta.service;
                return (
                  <div
                    key={meta.service}
                    className="rounded-lg sm:rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:p-4"
                  >
                    <div className="mb-2">
                      <label className="text-xs sm:text-sm font-medium text-white/80">
                        {meta.label}
                      </label>
                      <p className="text-[10px] text-white/40 mt-0.5">{meta.description}</p>
                      {state?.hasKey && !isEditingThis && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="text-[10px] sm:text-xs text-white/40">
                            {state.maskedKey}
                          </span>
                          <button
                            onClick={() => handleDelete(meta.service)}
                            disabled={isDeletingThis}
                            className="rounded-md p-1 min-h-[28px] min-w-[28px] flex items-center justify-center text-white/30 transition-colors hover:bg-red-500/20 hover:text-red-400"
                          >
                            {isDeletingThis ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Edit form */}
                    {isEditingThis && (
                      <div className="space-y-3 pt-1">
                        <div className="relative">
                          <input
                            ref={inputRef}
                            type={showKey ? 'text' : 'password'}
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && inputValue.trim()) handleSave(meta.service);
                              else if (e.key === 'Escape') handleCancelEdit();
                            }}
                            placeholder={`Enter your ${meta.label}`}
                            className="w-full rounded-lg border border-white/20 bg-white/[0.05] px-3 py-2 pr-10 text-sm text-white placeholder:text-white/30 transition-colors focus:border-white/40 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white/60"
                          >
                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={handleCancelEdit}
                            className="rounded-lg border border-white/20 px-3 py-1.5 min-h-[36px] text-xs font-medium text-white/60 transition-all hover:border-white/30 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSave(meta.service)}
                            disabled={!inputValue.trim() || isSavingThis}
                            className="flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 min-h-[36px] text-xs font-medium text-white transition-all hover:bg-white/20 disabled:opacity-50"
                          >
                            {isSavingThis ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            Save
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Add/Update button */}
                    {!isEditingThis && (
                      <button
                        onClick={() => handleStartEdit(meta.service)}
                        className="w-full rounded-lg border border-dashed border-white/20 py-2 min-h-[40px] text-xs text-white/40 transition-all hover:border-white/30 hover:text-white/60"
                      >
                        {state?.hasKey ? 'Update key' : 'Add key'}
                      </button>
                    )}

                    {/* Help link */}
                    <a
                      href={meta.helpHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-white/40 hover:text-white/60 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {meta.helpLabel}
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-4 sm:mt-6 text-center text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-white/25">
          API keys are encrypted and stored securely
        </p>
      </div>
    </div>
  );
}
