'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, ChevronDown, Check, Search } from 'lucide-react';
import { COUNTRIES } from '@/lib/constants';
import { useCyclingPlaceholder } from '@/lib/hooks/useCyclingPlaceholder';
import { GlowEffect } from '@/components/motion-primitives/glow-effect';
import { RegionPicker } from './RegionPicker';

const CITY_PLACEHOLDER_PHRASES = [
  'Phoenix, AZ',
  'Austin, TX',
  'Miami, FL',
  'Toronto',
  'Manchester',
  'Barcelona',
  'Melbourne',
  'Berlin',
  'Tokyo',
  'Dublin',
];

interface CityInputProps {
  city: string;
  country: string;
  onCityChange: (city: string) => void;
  onCountryChange: (country: string) => void;
  onSearch: () => void;
  isLoading?: boolean;
}

const DROPDOWN_WIDTH = 192; // w-48

export function CityInput({
  city,
  country,
  onCityChange,
  onCountryChange,
  onSearch,
  isLoading,
}: CityInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const cyclingPlaceholder = useCyclingPlaceholder({
    phrases: CITY_PLACEHOLDER_PHRASES,
    paused: isFocused || city.length > 0,
  });

  const placeholder = useMemo(() => {
    if (isFocused || city.length > 0) {
      return 'Enter city...';
    }
    return cyclingPlaceholder;
  }, [isFocused, city.length, cyclingPlaceholder]);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 8,
      left: rect.right - DROPDOWN_WIDTH,
    });
  }, []);

  // Recompute position whenever the dropdown opens or the viewport changes.
  useEffect(() => {
    if (!isDropdownOpen) return;
    updatePosition();
    const onScroll = () => setIsDropdownOpen(false);
    const onResize = () => updatePosition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isDropdownOpen, updatePosition]);

  // Outside-click close — must check BOTH the trigger and the portaled
  // dropdown, since they live in different parts of the DOM tree.
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setIsDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && city.trim()) {
      onSearch();
    }
  };

  const handleCountrySelect = (code: string) => {
    onCountryChange(code);
    setIsDropdownOpen(false);
  };

  const canSearch = city.trim().length > 0 && !isLoading;

  // Portal gate: `document` is undefined during SSR, and `isDropdownOpen`
  // is always false on initial client render (so hydration matches server).
  // The portal only ever mounts after a user interaction, which is safely
  // client-only — no state-based mount flag needed.
  const dropdown =
    typeof document !== 'undefined' && isDropdownOpen && dropdownPos
      ? createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: DROPDOWN_WIDTH,
              zIndex: 9999,
            }}
            className="max-h-64 overflow-y-auto rounded-lg border border-border-bright/70 bg-surface-inset shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
          >
            {COUNTRIES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => handleCountrySelect(c.code)}
                className={`
                  flex w-full items-center justify-between bg-surface-inset px-3 py-2 text-left text-sm transition-colors
                  ${country === c.code ? 'bg-sky-400/15 text-white' : 'text-white/75 hover:bg-surface-hover hover:text-white'}
                `}
              >
                <span className="flex items-center gap-2">
                  <span className="w-6 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                    {c.code.toUpperCase()}
                  </span>
                  <span>{c.name}</span>
                </span>
                {country === c.code && <Check className="h-4 w-4 text-sky-400" />}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="w-full max-w-md">
      <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.24em] text-white/45">
        Select country and city
      </p>
      <div
        className={`
          hud-panel flex items-center gap-3 rounded-xl border p-4 backdrop-blur-sm transition-all
          ${
            isFocused
              ? 'border-sky-400/60 bg-surface-elevated/80'
              : 'border-border-bright/50 bg-surface/60'
          }
        `}
      >
        <MapPin className="h-5 w-5 flex-shrink-0 text-sky-400/75" />
        <input
          type="text"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/35"
        />

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsDropdownOpen((v) => !v)}
          className="flex items-center gap-1 rounded-lg border border-border-bright/60 bg-surface-elevated/80 px-2.5 py-1.5 text-xs text-white/85 transition-colors hover:border-sky-400/50 hover:bg-surface-hover/80"
        >
          <span className="font-medium">{country.toUpperCase()}</span>
          <ChevronDown
            className={`h-3 w-3 text-white/50 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {dropdown}

      <RegionPicker
        city={city}
        country={country}
        onNeighborhoodSelect={onCityChange}
        disabled={isLoading}
      />

      <div className="relative mt-4">
        {canSearch && (
          <GlowEffect
            colors={['#38bdf8', '#a78bfa', '#fdba74', '#38bdf8']}
            mode="rotate"
            blur="medium"
            duration={7}
            scale={1.02}
            className="rounded-xl opacity-80"
          />
        )}
        <button
          onClick={onSearch}
          disabled={!canSearch}
          className={`
            relative flex w-full items-center justify-center gap-2 rounded-xl border py-3.5 text-base font-semibold tracking-wide transition-all
            ${
              canSearch
                ? 'border-sky-400/70 bg-white text-black shadow-[0_0_24px_rgba(56,189,248,0.3)] hover:bg-white/90'
                : 'cursor-not-allowed border-border-bright/40 bg-surface-elevated/50 text-white/35'
            }
          `}
        >
          {isLoading ? (
            <>
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" />
              Searching...
            </>
          ) : (
            <>
              <Search className="h-4 w-4" />
              Search Businesses
            </>
          )}
        </button>
      </div>
    </div>
  );
}
