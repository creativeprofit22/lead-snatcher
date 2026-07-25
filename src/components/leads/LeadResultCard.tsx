'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  Globe,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { motion } from 'motion/react';

import { GlowEffect } from '@/components/motion-primitives/glow-effect';
import { HoloCard } from '@/components/ui/HoloCard';
import { isRealEmail, type SearchResultEnrichment } from '@/lib/business/derive-search-results';
import type { BusinessSearchResult } from '@/types';

import { EnrichButton, type EnrichmentStatus } from './EnrichButton';
import { LeadScoreBadge } from './LeadScoreBadge';
import { OpportunitiesList } from './OpportunitiesList';

export type LeadResultTier = 'hot' | 'mid' | 'cold';

interface LeadResultCardProps {
  lead: BusinessSearchResult;
  index: number;
  rank: number;
  tier: LeadResultTier;
  selected: boolean;
  onToggleSelection: () => void;
  enrichmentStatus: EnrichmentStatus;
  enrichmentResult?: SearchResultEnrichment;
  onEnrich: () => void;
  onRequestEnrichmentExplainer: () => boolean;
  saveBusy: boolean;
  onSave: () => void;
}

export function LeadResultCard({
  lead: business,
  index,
  rank,
  tier,
  selected,
  onToggleSelection,
  enrichmentStatus,
  enrichmentResult,
  onEnrich,
  onRequestEnrichmentExplainer,
  saveBusy,
  onSave,
}: LeadResultCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        type: 'spring',
        stiffness: 320,
        damping: 32,
        mass: 0.6,
        delay: Math.min(index, 16) * 0.04,
      }}
      data-heat={tier}
      data-rank={rank}
      style={{ ['--i' as string]: index }}
      className="relative"
    >
      {rank <= 3 && (
        <span className={`lead-rank-pip lead-rank-${rank}`}>
          {rank === 1 && <Flame className="w-3 h-3" />}#{rank}
          {rank === 1 && ' HOT LEAD'}
        </span>
      )}
      <HoloCard
        className={`lead-card lead-tier-${tier} bg-surface-elevated/60 border border-border-bright/60 rounded-xl p-4 sm:p-5 backdrop-blur-sm`}
        spotlightColor={
          tier === 'hot'
            ? 'rgba(253, 186, 116, 0.32)'
            : tier === 'mid'
              ? 'rgba(125, 211, 252, 0.28)'
              : 'rgba(148, 163, 184, 0.22)'
        }
        glareColor={tier === 'hot' ? '#fdba74' : tier === 'mid' ? '#9be8ff' : '#cbd5e1'}
        glareOpacity={tier === 'hot' ? 0.4 : 0.3}
      >
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-start gap-2 min-w-0">
                <label
                  className="flex-shrink-0 mt-1 cursor-pointer select-none"
                  title={`Select ${business.name} for batch enrichment`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={onToggleSelection}
                    aria-label={`Select ${business.name} for batch enrichment`}
                    className="w-4 h-4 rounded border-gray-600 bg-transparent text-sky-500 focus:ring-sky-500 focus:ring-offset-0 cursor-pointer"
                  />
                </label>
                <div className="min-w-0">
                  <h3 className="lead-card-name text-lg font-semibold truncate">{business.name}</h3>
                  {business.address && (
                    <p className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{business.address}</span>
                    </p>
                  )}
                </div>
              </div>
              <LeadScoreBadge
                score={business.leadScore}
                breakdown={business.scoreBreakdown}
                websiteAnalysis={business.websiteAnalysis}
              />
            </div>

            {/* Contact & Links */}
            <div className="flex flex-wrap gap-2 mb-3">
              {business.phone && (
                <a
                  href={`tel:${business.phone}`}
                  className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {business.phone}
                </a>
              )}
              {business.email && isRealEmail(business.email) && (
                <a
                  href={`mailto:${business.email}`}
                  className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {business.email}
                </a>
              )}
              {business.website && (
                <a
                  href={business.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                >
                  <Globe className="w-3.5 h-3.5" />
                  Website
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <EnrichButton
                lead={business}
                status={enrichmentStatus}
                onClick={onEnrich}
                onRequestExplainer={onRequestEnrichmentExplainer}
              />
              {enrichmentStatus === 'enriched' && <EnrichmentDelta result={enrichmentResult} />}
              {business.mapsUrl && (
                <a
                  href={business.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Maps
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Website Quality chips — top triggered Layer 5 signals.
                Every chip is a concrete, non-subjective fact usable in a sales email. */}
            {business.scoreBreakdown.qualityChips.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {business.scoreBreakdown.qualityChips.map((chip) => (
                  <span
                    key={chip}
                    className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-amber-500/15 text-amber-300"
                    title="Website-quality signal — deterministic, no subjective calls"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}

            {/* Social Media Links */}
            {business.socialLinks && Object.keys(business.socialLinks).length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-3.5 h-3.5 text-gray-500" />
                {business.socialLinks.facebook && (
                  <a
                    href={business.socialLinks.facebook}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-blue-400 transition-colors"
                    title="Facebook"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                  </a>
                )}
                {business.socialLinks.instagram && (
                  <a
                    href={business.socialLinks.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-pink-400 transition-colors"
                    title="Instagram"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                    </svg>
                  </a>
                )}
                {business.socialLinks.twitter && (
                  <a
                    href={business.socialLinks.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-white transition-colors"
                    title="X / Twitter"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </a>
                )}
                {business.socialLinks.linkedin && (
                  <a
                    href={business.socialLinks.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-blue-300 transition-colors"
                    title="LinkedIn"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </a>
                )}
                {business.socialLinks.youtube && (
                  <a
                    href={business.socialLinks.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-red-400 transition-colors"
                    title="YouTube"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                  </a>
                )}
                {business.socialLinks.tiktok && (
                  <a
                    href={business.socialLinks.tiktok}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-500 hover:text-white transition-colors"
                    title="TikTok"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
                    </svg>
                  </a>
                )}
              </div>
            )}

            {/* Stats */}
            <div className="lead-stats flex items-center gap-3 text-sm text-gray-400">
              {business.rating && (
                <span className="lead-stat flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.55)]" />
                  <span className="tabular-nums font-medium text-white/85">
                    {business.rating.toFixed(1)}
                  </span>
                </span>
              )}
              {typeof business.priceLevel === 'number' && business.priceLevel > 0 && (
                <PriceTier level={business.priceLevel} />
              )}
              {business.reviewCount !== undefined && (
                <span className="lead-stat flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-white/40" />
                  <span className="tabular-nums font-medium text-white/75">
                    {business.reviewCount}
                  </span>
                  <span className="text-white/40">reviews</span>
                </span>
              )}
              <span
                className="lead-stat flex items-center gap-1.5"
                title="Contact channels available"
              >
                <Users className="w-4 h-4 text-white/40" />
                <span className="tabular-nums font-medium text-white/75">
                  {business.contactPoints}
                </span>
                <span className="text-white/40">
                  contact {business.contactPoints === 1 ? 'point' : 'points'}
                </span>
              </span>
            </div>
          </div>

          {/* Budget & Opportunities */}
          <div className="lg:w-80 flex flex-col gap-3">
            {/* Budget Estimate */}
            {business.budgetEstimate && <BudgetCard estimate={business.budgetEstimate} />}

            <OpportunitiesList opportunities={business.opportunities} maxVisible={2} />
            <div className="group relative">
              <GlowEffect
                colors={['#10b981', '#14b8a6', '#06b6d4', '#10b981']}
                mode="colorShift"
                blur="soft"
                duration={3.5}
                className="rounded-lg opacity-0 transition-opacity duration-300 group-hover:opacity-65"
              />
              <button
                onClick={onSave}
                disabled={saveBusy}
                className="relative flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_rgba(16,185,129,0.25)] transition-all hover:from-emerald-400 hover:to-teal-500 hover:shadow-[0_6px_24px_rgba(16,185,129,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {saveBusy ? 'Saving...' : 'Save Lead'}
              </button>
            </div>
          </div>
        </div>
      </HoloCard>
    </motion.div>
  );
}

function EnrichmentDelta({ result }: { result?: SearchResultEnrichment }) {
  if (!result) return null;

  const deltas: string[] = [];
  if (result.website) deltas.push('website');
  const socialKeys = Object.keys(result.socials ?? {});
  if (socialKeys.length > 0) {
    deltas.push(
      socialKeys.length === 1 ? (socialKeys[0] ?? 'social') : `${socialKeys.length} socials`
    );
  }

  if (deltas.length === 0) {
    return (
      <span
        role="status"
        className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-gray-500/15 text-gray-300"
        title="Small businesses often run on phone + word-of-mouth — still a valid lead"
      >
        No public contact data found
      </span>
    );
  }

  return (
    <span
      role="status"
      className="lead-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm bg-emerald-500/15 text-emerald-300"
    >
      + {deltas.join(', ')}
    </span>
  );
}

function BudgetCard({
  estimate,
}: {
  estimate: NonNullable<BusinessSearchResult['budgetEstimate']>;
}) {
  const [expanded, setExpanded] = useState(false);

  const confidenceColor =
    estimate.confidence === 'high'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      : estimate.confidence === 'medium'
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
        : 'text-gray-400 bg-white/5 border-white/10';

  return (
    <div
      className={`budget-card relative overflow-hidden rounded-lg border p-3 ${confidenceColor}`}
    >
      <div className="budget-card-shine" aria-hidden />
      <button
        onClick={() => setExpanded(!expanded)}
        className="relative w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 drop-shadow-[0_0_6px_currentColor]" />
          <span className="text-sm font-semibold tracking-wide">{estimate.label}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-55">
            {estimate.confidence} conf.
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 opacity-50" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        )}
      </button>
      {expanded && (
        <div className="relative mt-2 pt-2 border-t border-current/10 space-y-1">
          {estimate.reasons.map((reason, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] opacity-80">
              <span className="mt-0.5 w-1 h-1 rounded-full bg-current flex-shrink-0" />
              <span>{reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceTier({ level }: { level: number }) {
  const capped = Math.max(1, Math.min(4, Math.round(level)));
  const tierConfig: Record<number, { label: string; color: string; glow: string; tip: string }> = {
    1: {
      label: '$',
      color: 'text-slate-400',
      glow: '',
      tip: 'Budget pricing — tight margins',
    },
    2: {
      label: '$$',
      color: 'text-emerald-300',
      glow: 'drop-shadow-[0_0_4px_rgba(52,211,153,0.5)]',
      tip: 'Mid-range pricing',
    },
    3: {
      label: '$$$',
      color: 'text-amber-300',
      glow: 'drop-shadow-[0_0_6px_rgba(252,211,77,0.6)]',
      tip: 'Upscale pricing — solid budget',
    },
    4: {
      label: '$$$$',
      color: 'text-yellow-200',
      glow: 'drop-shadow-[0_0_8px_rgba(253,224,71,0.85)]',
      tip: 'Premium pricing — deep pockets',
    },
  };
  const cfg = tierConfig[capped] ?? {
    label: '$',
    color: 'text-slate-400',
    glow: '',
    tip: 'Budget pricing — tight margins',
  };
  return (
    <span
      className={`lead-stat flex items-center gap-1 font-mono font-semibold tabular-nums ${cfg.color} ${cfg.glow}`}
      title={cfg.tip}
    >
      {cfg.label}
    </span>
  );
}
