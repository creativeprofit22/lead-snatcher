'use client';

import { useEffect, useState } from 'react';
import {
  Utensils,
  Scissors,
  Dumbbell,
  Stethoscope,
  Store,
  Car,
  Home,
  Briefcase,
  Building,
  Sparkles,
} from 'lucide-react';
import { INDUSTRY_TYPES } from '@/lib/constants';
import { useCyclingPlaceholder } from '@/lib/hooks/useCyclingPlaceholder';
import type { IndustryType } from '@/types';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  utensils: Utensils,
  scissors: Scissors,
  dumbbell: Dumbbell,
  stethoscope: Stethoscope,
  store: Store,
  car: Car,
  home: Home,
  briefcase: Briefcase,
  building: Building,
};

const CUSTOM_PLACEHOLDER_PHRASES = [
  'HVAC contractors',
  'Med spas',
  'Commercial roofers',
  'Law firms',
  'Boutique gyms',
  'SaaS founders',
  'Real estate brokerages',
  'Pest control',
  'Luxury car detailers',
  'Wedding photographers',
];

// One spotlight sweep across all 9 tiles completes in 4.8s — the same
// cadence as .gauge-halo-breathe so every rhythm on the home screen stays
// phase-locked.
const SPOTLIGHT_TOTAL_MS = 4800;
const SPOTLIGHT_STEP_MS = SPOTLIGHT_TOTAL_MS / 9;

interface BusinessTypeSelectorProps {
  selected: IndustryType | null;
  onSelect: (type: IndustryType | null) => void;
  customIndustry: string;
  onCustomIndustryChange: (value: string) => void;
}

export function BusinessTypeSelector({
  selected,
  onSelect,
  customIndustry,
  onCustomIndustryChange,
}: BusinessTypeSelectorProps) {
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [customFocused, setCustomFocused] = useState(false);

  // Rotating spotlight — always on, always looping.
  useEffect(() => {
    const id = setInterval(
      () => setSpotlightIndex((i) => (i + 1) % INDUSTRY_TYPES.length),
      SPOTLIGHT_STEP_MS
    );
    return () => clearInterval(id);
  }, []);

  const customPlaceholder = useCyclingPlaceholder({
    phrases: CUSTOM_PLACEHOLDER_PHRASES,
    paused: customFocused || customIndustry.length > 0,
  });

  const handlePresetClick = (id: IndustryType) => {
    onCustomIndustryChange('');
    onSelect(id);
  };

  const handleCustomChange = (value: string) => {
    if (value.length > 0 && selected !== null) {
      onSelect(null);
    }
    onCustomIndustryChange(value);
  };

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div>
        <p className="mb-3 text-center font-mono text-xs uppercase tracking-[0.24em] text-white/45">
          Select business type
        </p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {INDUSTRY_TYPES.map((type, index) => {
            const Icon = ICONS[type.icon] || Building;
            const isSelected = selected === type.id;
            const isSpotlit =
              !isSelected &&
              selected === null &&
              customIndustry.length === 0 &&
              spotlightIndex === index;

            return (
              <button
                key={type.id}
                onClick={() => handlePresetClick(type.id)}
                className={`
                  relative flex flex-col items-center gap-2 rounded-xl border p-4 backdrop-blur-sm transition-all duration-300 sm:p-5
                  ${
                    isSelected
                      ? 'border-sky-400/70 bg-sky-400/10 text-white shadow-[0_0_22px_rgba(56,189,248,0.3)]'
                      : isSpotlit
                        ? 'border-sky-400/55 bg-surface-elevated/80 text-white scale-[1.04] shadow-[0_0_18px_rgba(56,189,248,0.24)]'
                        : 'border-border-bright/50 bg-surface-elevated/60 text-white/65 hover:border-sky-400/40 hover:text-white'
                  }
                `}
              >
                <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
                <span className="w-full truncate text-center text-sm font-medium">
                  {type.label.split(' ')[0]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hud-panel relative overflow-hidden rounded-xl border border-border-bright/50 bg-surface/60 p-4 backdrop-blur-sm">
        <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.24em] text-white/45">
          Or custom vertical
        </p>
        <div
          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
            customFocused
              ? 'border-sky-400/60 bg-surface-elevated/80'
              : 'border-border-bright/50 bg-surface-elevated/40'
          }`}
        >
          <Sparkles className="h-5 w-5 flex-shrink-0 text-sky-400/75" />
          <input
            type="text"
            value={customIndustry}
            onChange={(e) => handleCustomChange(e.target.value)}
            onFocus={() => setCustomFocused(true)}
            onBlur={() => setCustomFocused(false)}
            placeholder={customPlaceholder || 'or type a custom industry...'}
            className="flex-1 bg-transparent text-base text-white outline-none placeholder:text-white/35"
          />
        </div>
      </div>
    </div>
  );
}
