'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, Lightbulb } from 'lucide-react';

interface OpportunitiesListProps {
  opportunities: string[];
  maxVisible?: number;
}

export function OpportunitiesList({ opportunities, maxVisible = 3 }: OpportunitiesListProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!opportunities || opportunities.length === 0) {
    return <p className="text-sm text-gray-500 italic">No opportunities identified</p>;
  }

  const visibleOpportunities = isExpanded ? opportunities : opportunities.slice(0, maxVisible);
  const hasMore = opportunities.length > maxVisible;

  return (
    <div className="opps space-y-2">
      <div className="opps-header flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.14em]">
        <span className="relative inline-flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-emerald-400/20 blur-[6px]" />
          <Lightbulb className="relative w-3.5 h-3.5 text-emerald-300" />
        </span>
        <span className="text-white/75">Opportunities</span>
        <span className="tabular-nums text-emerald-300/80">({opportunities.length})</span>
      </div>
      <ul className="space-y-1.5">
        {visibleOpportunities.map((opportunity, index) => (
          <li key={index} className="opps-row flex items-start gap-2 text-sm text-gray-200">
            <ChevronRight className="opps-wedge w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-400" />
            <span className="leading-snug">{opportunity}</span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Show {opportunities.length - maxVisible} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
