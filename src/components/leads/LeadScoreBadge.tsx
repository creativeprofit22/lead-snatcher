'use client';

import { useEffect, useState } from 'react';
import {
  Flame,
  Snowflake,
  Sparkles,
  DollarSign,
  CircleSlash,
  TrendingUp,
  Minus,
  TrendingDown,
} from 'lucide-react';
import { SlidingNumber } from '@/components/motion-primitives/sliding-number';
import { TextEffect } from '@/components/motion-primitives/text-effect';
import { GlowEffect } from '@/components/motion-primitives/glow-effect';
import {
  getLeadScoreBand,
  LEAD_SCORE_BAND_LABELS,
  type LeadScoreBand,
} from '@/lib/business/lead-score-band';
import type { ScoreBreakdown, WebsiteAnalysis } from '@/types';

interface LeadScoreBadgeProps {
  score: number;
  breakdown?: ScoreBreakdown;
  websiteAnalysis?: WebsiteAnalysis;
}

const LEAD_SCORE_BADGE_STYLES = {
  hot: {
    text: 'text-orange-300',
    border: 'border-orange-500/30',
    bg: 'bg-orange-500/10',
    glow: 'shadow-[0_0_10px_rgba(249,115,22,0.15)]',
    glowColors: ['#f97316', '#fb923c', '#fbbf24', '#f97316'],
  },
  mid: {
    text: 'text-gray-300',
    border: 'border-white/10',
    bg: 'bg-white/5',
    glow: '',
    glowColors: ['#fbbf24', '#f59e0b', '#facc15', '#fbbf24'],
  },
  cold: {
    text: 'text-blue-300',
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/5',
    glow: '',
    glowColors: ['#60a5fa', '#3b82f6', '#38bdf8', '#60a5fa'],
  },
} satisfies Record<
  LeadScoreBand,
  {
    text: string;
    border: string;
    bg: string;
    glow: string;
    glowColors: string[];
  }
>;

// Hot Lead Icon - flame with glow
function HotLeadIcon() {
  return (
    <div className="relative">
      <div className="absolute inset-0 blur-sm bg-orange-500/30 rounded-full" />
      <Flame className="relative w-4 h-4 text-orange-400" />
    </div>
  );
}

// Cold Lead Icon - snowflake with subtle blue
function ColdLeadIcon() {
  return (
    <div className="relative">
      <div className="absolute inset-0 blur-sm bg-blue-500/20 rounded-full" />
      <Snowflake className="relative w-4 h-4 text-blue-400" />
    </div>
  );
}

// Warm Lead Icon - sparkles with amber glow
function WarmLeadIcon() {
  return (
    <div className="relative">
      <div className="absolute inset-0 blur-sm bg-amber-500/20 rounded-full" />
      <Sparkles className="relative w-4 h-4 text-amber-400" />
    </div>
  );
}

export function LeadScoreBadge({ score, breakdown, websiteAnalysis }: LeadScoreBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Keep digit count stable during count-up so SlidingNumber doesn't remount
  const targetLen = String(score).length;
  const startValue = targetLen > 1 ? Math.pow(10, targetLen - 1) : 0;
  const [displayScore, setDisplayScore] = useState(startValue);

  useEffect(() => {
    const t = setTimeout(() => setDisplayScore(score), 120);
    return () => clearTimeout(t);
  }, [score]);

  const leadScoreBand = getLeadScoreBand(score);
  const label = LEAD_SCORE_BAND_LABELS[leadScoreBand];
  const style = LEAD_SCORE_BADGE_STYLES[leadScoreBand];

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2" data-lead-score-band={leadScoreBand}>
        {leadScoreBand === 'hot' && <HotLeadIcon />}
        {leadScoreBand === 'mid' && <WarmLeadIcon />}
        {leadScoreBand === 'cold' && <ColdLeadIcon />}

        <div className="relative">
          <GlowEffect
            colors={style.glowColors}
            mode="pulse"
            blur="soft"
            scale={0.9}
            duration={3}
            className="rounded-lg opacity-50"
          />
          <button
            onClick={() => breakdown && setIsExpanded(!isExpanded)}
            className={`relative flex items-center justify-center min-w-[44px] h-10 px-1 rounded-lg font-mono text-lg transition-colors hover:bg-white/10 ${style.text} ${style.border} ${style.bg} ${style.glow}`}
            title={breakdown ? 'Click for details' : undefined}
            aria-label={`${label} lead score: ${score}`}
            aria-expanded={breakdown ? isExpanded : undefined}
          >
            <SlidingNumber value={displayScore} />
          </button>
        </div>
        <span className={`text-xs font-medium ${style.text}`}>{label}</span>
      </div>

      {/* Signal Badges */}
      {breakdown && (
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Marketing Budget */}
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
              breakdown.hasMarketingBudget
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-white/5 border border-white/10 text-gray-500'
            }`}
            title={
              breakdown.hasMarketingBudget
                ? `Runs: ${breakdown.marketingPlatforms.join(', ')}`
                : 'No paid ads detected'
            }
          >
            {breakdown.hasMarketingBudget ? (
              <>
                <DollarSign className="w-3 h-3" />
                <TextEffect as="span" per="char" preset="fade-in-blur" speedReveal={2} delay={0.4}>
                  Ad Spend
                </TextEffect>
              </>
            ) : (
              <>
                <CircleSlash className="w-3 h-3" />
                <TextEffect as="span" per="char" preset="fade-in-blur" speedReveal={2} delay={0.4}>
                  No Ads
                </TextEffect>
              </>
            )}
          </div>

          {/* Demand / Traffic Signal */}
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium ${
              breakdown.demandSignal === 'high'
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : breakdown.demandSignal === 'medium'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  : 'bg-white/5 border border-white/10 text-gray-500'
            }`}
            title={breakdown.demandLabel}
          >
            {breakdown.demandSignal === 'high' ? (
              <TrendingUp className="w-3 h-3" />
            ) : breakdown.demandSignal === 'medium' ? (
              <Minus className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <TextEffect as="span" per="char" preset="fade-in-blur" speedReveal={2} delay={0.55}>
              {breakdown.demandSignal === 'high'
                ? 'Strong Demand'
                : breakdown.demandSignal === 'medium'
                  ? 'Moderate Demand'
                  : 'Limited Demand'}
            </TextEffect>
          </div>
        </div>
      )}

      {isExpanded && breakdown && (
        <div className="mt-2 p-3 bg-white/5 border border-white/10 rounded-lg text-xs w-full min-w-[280px]">
          <div className="font-medium mb-2 text-gray-300">Score Breakdown</div>

          {/* Layer 1: Basic Presence */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Basic Presence
            </div>
            <div className="space-y-0.5">
              <ScoreRow label="No website" value={breakdown.noWebsite} />
              <ScoreRow label="Social-only site" value={breakdown.socialOnlyWebsite} />
              <ScoreRow label="No phone" value={breakdown.noPhone} />
            </div>
          </div>

          {/* Layer 2: Google Profile */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Google Profile
            </div>
            <div className="space-y-0.5">
              <ScoreRow label="Few photos" value={breakdown.fewPhotos} />
              <ScoreRow label="Low reviews" value={breakdown.lowReviews} />
              <ScoreRow label="Hidden gem" value={breakdown.hiddenGem} />
            </div>
          </div>

          {/* Layer 3: Website Technical */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Website Technical
            </div>
            <div className="space-y-0.5">
              <ScoreRow label="Poor performance" value={breakdown.poorPerformance} />
              <ScoreRow label="Not mobile-friendly" value={breakdown.notMobileFriendly} />
              <ScoreRow label="No HTTPS" value={breakdown.noHttps} />
            </div>
          </div>

          {/* Layer 4: Website Opportunities */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Website Opportunities
            </div>
            <div className="space-y-0.5">
              <ScoreRow label="Outdated website" value={breakdown.outdatedWebsite} />
              <ScoreRow label="No online booking" value={breakdown.noOnlineBooking} />
              <ScoreRow label="No social links" value={breakdown.noSocialLinks} />
              <ScoreRow label="Basic tech stack" value={breakdown.basicTechStack} />
            </div>
          </div>

          {/* Layer 5: Website Quality — deterministic HTML + PageSpeed signals */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Website Quality
            </div>
            <div className="space-y-0.5">
              <ScoreRow label="No mobile viewport" value={breakdown.noViewport} />
              <ScoreRow label="Table-based layout" value={breakdown.tableLayout} />
              <ScoreRow label="Thin content (<150 words)" value={breakdown.thinContent} />
              <ScoreRow label="Deprecated HTML tags" value={breakdown.deprecatedTags} />
              <ScoreRow label="Template fingerprint" value={breakdown.templateFingerprint} />
              <ScoreRow label="No contact form" value={breakdown.noForm} />
              <ScoreRow label="Fixed pixel widths" value={breakdown.fixedPixelWidth} />
              <ScoreRow label="Outdated jQuery" value={breakdown.outdatedJquery} />
              <ScoreRow label="No schema.org" value={breakdown.noSchemaOrg} />
              <ScoreRow label="No Open Graph" value={breakdown.noOpenGraph} />
              <ScoreRow label="No <html lang>" value={breakdown.noLangAttribute} />
              <ScoreRow label="Accessibility <70" value={breakdown.lowAccessibility} />
              <ScoreRow label="SEO <70" value={breakdown.lowSeo} />
              <ScoreRow label="Best practices <80" value={breakdown.lowBestPractices} />
              <ScoreRow label="LCP >4s" value={breakdown.slowLcp} />
              <ScoreRow label="High CLS (>0.25)" value={breakdown.highCls} />
            </div>
          </div>

          {/* Marketing Intelligence */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Marketing Intelligence
            </div>
            {breakdown.hasMarketingBudget ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <DollarSign className="w-3 h-3" />
                  <span>Active marketing budget detected</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {breakdown.marketingPlatforms.map((platform) => (
                    <span
                      key={platform}
                      className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] text-emerald-400"
                    >
                      {platform}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-gray-600 flex items-center gap-1.5">
                <CircleSlash className="w-3 h-3" />
                <span>No paid advertising detected</span>
              </div>
            )}
          </div>

          {/* Demand / Traffic Signal */}
          <div className="mb-2">
            <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
              Demand / Traffic Signal
            </div>
            <div
              className={`flex items-center gap-1.5 ${
                breakdown.demandSignal === 'high'
                  ? 'text-emerald-400'
                  : breakdown.demandSignal === 'medium'
                    ? 'text-amber-400'
                    : 'text-gray-600'
              }`}
            >
              {breakdown.demandSignal === 'high' ? (
                <TrendingUp className="w-3 h-3" />
              ) : breakdown.demandSignal === 'medium' ? (
                <Minus className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{breakdown.demandLabel}</span>
            </div>
          </div>

          {/* Website Analysis Details */}
          {websiteAnalysis && !websiteAnalysis.hasErrors && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <div className="text-gray-500 text-[10px] uppercase tracking-wide mb-1">
                PageSpeed Analysis
              </div>
              <div className="grid grid-cols-2 gap-1 text-[11px] text-gray-400">
                <div>
                  Performance:{' '}
                  <span className="text-gray-300">{websiteAnalysis.performanceScore}/100</span>
                </div>
                <div>
                  Mobile:{' '}
                  <span className="text-gray-300">
                    {websiteAnalysis.isMobileFriendly ? 'Yes' : 'No'}
                  </span>
                </div>
                <div>
                  HTTPS:{' '}
                  <span className="text-gray-300">{websiteAnalysis.isHttps ? 'Yes' : 'No'}</span>
                </div>
                <div>
                  Response:{' '}
                  <span className="text-gray-300">
                    {Math.round(websiteAnalysis.responseTime)}ms
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Public and raw totals */}
          <div className="mt-2 pt-2 border-t border-white/10 space-y-1">
            <div className="flex justify-between text-gray-500">
              <span>Signal points (uncapped)</span>
              <span className="text-gray-300">{breakdown.rawTotal}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-gray-400">Lead Score (max 100)</span>
              <span className="text-white">{breakdown.total}/100</span>
            </div>
            {breakdown.rawTotal > breakdown.total && (
              <p className="text-[10px] leading-4 text-gray-500">
                All signal points remain visible; the public Lead Score is capped at 100.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  return (
    <div className="flex justify-between text-gray-500">
      <span>{label}</span>
      <span className="text-gray-300">+{value}</span>
    </div>
  );
}
