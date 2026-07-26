'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Check, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  API_KEY_MAX_LENGTH,
  API_KEY_SERVICE_REGISTRY,
  type ApiKeyService,
} from '@/lib/api-key-services';
import { useApiKeySettings } from '@/lib/hooks/useApiKeySettings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    apiKeys,
    isLoading,
    loadError,
    savingService,
    deletingService,
    retry,
    saveApiKey,
    deleteApiKey,
  } = useApiKeySettings(isOpen);
  // Edit/save/delete state is scoped to a single active service so two
  // cards can't fight over the same input.
  const [editingService, setEditingService] = useState<ApiKeyService | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const animationFrame = requestAnimationFrame(() => {
      setIsVisible(isOpen);
      setEditingService(null);
      setInputValue('');
      setShowKey(false);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [isOpen]);

  const handleSave = async (service: ApiKeyService) => {
    if (!inputValue.trim()) return;

    try {
      await saveApiKey(service, inputValue);
      setEditingService(null);
      setInputValue('');
      setShowKey(false);
      toast.success('API key saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save key');
    }
  };

  const handleDelete = async (service: ApiKeyService) => {
    try {
      await deleteApiKey(service);
      toast.success('API key removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove key');
    }
  };

  const handleStartEdit = (service: ApiKeyService) => {
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className={`relative w-[calc(100vw-1.5rem)] sm:w-full max-w-md mx-3 sm:mx-0 rounded-xl sm:rounded-2xl border border-white/10 bg-black/90 p-4 sm:p-6 shadow-2xl transition-all duration-300 ease-out ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <h2 id="settings-modal-title" className="text-base sm:text-lg font-medium text-white">
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
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
            <div className="flex items-center justify-center py-8" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-white/40" />
              <span className="sr-only">Loading API configuration</span>
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-white/15 px-4 py-5 text-center" role="alert">
              <p className="text-sm font-medium text-white/80">Unable to load API configuration</p>
              <p className="mt-1 text-xs text-white/60">{loadError.message}</p>
              <button
                type="button"
                onClick={() => void retry()}
                className="mt-4 rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {API_KEY_SERVICE_REGISTRY.map((meta) => {
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
                            aria-label={`Remove ${meta.label}`}
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
                            maxLength={API_KEY_MAX_LENGTH}
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
                            aria-label={showKey ? 'Hide API key' : 'Show API key'}
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
