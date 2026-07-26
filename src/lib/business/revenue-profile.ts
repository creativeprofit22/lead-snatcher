const DEMAND_PROFILE_POLICY = {
  establishedReviewCount: 50,
  highReviewCount: 200,
  sustainedReviewCount: 500,
  solidRating: 4,
  strongRating: 4.5,
  premiumRating: 4.6,
} as const;

export const DEMAND_REASON_CODES = [
  'no_review_evidence',
  'emerging_traffic',
  'established_traffic',
  'established_traffic_unrated',
  'established_traffic_rating_drag',
  'boutique_demand',
  'high_traffic',
  'high_traffic_unrated',
  'high_traffic_rating_drag',
  'sustained_traffic',
  'sustained_traffic_unrated',
  'sustained_traffic_rating_drag',
  'sustained_premium_demand',
] as const;

export type DemandVolumeBand = 'none' | 'emerging' | 'established' | 'high' | 'sustained';
export type RatingQualityBand = 'unrated' | 'drag' | 'solid' | 'strong' | 'premium';
export type DemandDisplaySignal = 'low' | 'medium' | 'high';
export type DemandReasonCode = (typeof DEMAND_REASON_CODES)[number];

export interface DemandEvidenceProfile {
  reviewCount: number;
  rating: number;
  volumeBand: DemandVolumeBand;
  ratingQualityBand: RatingQualityBand;
  displaySignal: DemandDisplaySignal;
  reasonCode: DemandReasonCode;
}

function getVolumeBand(reviewCount: number): DemandVolumeBand {
  if (reviewCount === 0) return 'none';
  if (reviewCount < DEMAND_PROFILE_POLICY.establishedReviewCount) return 'emerging';
  if (reviewCount < DEMAND_PROFILE_POLICY.highReviewCount) return 'established';
  if (reviewCount < DEMAND_PROFILE_POLICY.sustainedReviewCount) return 'high';
  return 'sustained';
}

function getRatingQualityBand(rating: number): RatingQualityBand {
  if (rating === 0) return 'unrated';
  if (rating < DEMAND_PROFILE_POLICY.solidRating) return 'drag';
  if (rating < DEMAND_PROFILE_POLICY.strongRating) return 'solid';
  if (rating < DEMAND_PROFILE_POLICY.premiumRating) return 'strong';
  return 'premium';
}

function getDisplayEvidence(
  volumeBand: DemandVolumeBand,
  ratingQualityBand: RatingQualityBand
): Pick<DemandEvidenceProfile, 'displaySignal' | 'reasonCode'> {
  if (volumeBand === 'none') {
    return { displaySignal: 'low', reasonCode: 'no_review_evidence' };
  }

  if (volumeBand === 'emerging') {
    return { displaySignal: 'low', reasonCode: 'emerging_traffic' };
  }

  if (volumeBand === 'established') {
    if (ratingQualityBand === 'premium') {
      return { displaySignal: 'medium', reasonCode: 'boutique_demand' };
    }
    if (ratingQualityBand === 'drag') {
      return { displaySignal: 'medium', reasonCode: 'established_traffic_rating_drag' };
    }
    if (ratingQualityBand === 'unrated') {
      return { displaySignal: 'medium', reasonCode: 'established_traffic_unrated' };
    }
    return { displaySignal: 'medium', reasonCode: 'established_traffic' };
  }

  if (volumeBand === 'high') {
    if (ratingQualityBand === 'drag') {
      return { displaySignal: 'medium', reasonCode: 'high_traffic_rating_drag' };
    }
    if (ratingQualityBand === 'unrated') {
      return { displaySignal: 'medium', reasonCode: 'high_traffic_unrated' };
    }
    return { displaySignal: 'high', reasonCode: 'high_traffic' };
  }

  if (ratingQualityBand === 'drag') {
    return { displaySignal: 'medium', reasonCode: 'sustained_traffic_rating_drag' };
  }
  if (ratingQualityBand === 'unrated') {
    return { displaySignal: 'medium', reasonCode: 'sustained_traffic_unrated' };
  }
  if (ratingQualityBand === 'strong' || ratingQualityBand === 'premium') {
    return { displaySignal: 'high', reasonCode: 'sustained_premium_demand' };
  }
  return { displaySignal: 'high', reasonCode: 'sustained_traffic' };
}

/**
 * Classify review volume and rating quality as demand evidence, not measured revenue.
 * Consumers may use the shared bands while retaining their own point formulas.
 */
export function createDemandEvidenceProfile(
  reviewCountInput: number,
  ratingInput?: number | null
): DemandEvidenceProfile {
  const reviewCount = Number.isFinite(reviewCountInput)
    ? Math.max(0, Math.floor(reviewCountInput))
    : 0;
  const suppliedRating = ratingInput ?? 0;
  const rating = Number.isFinite(suppliedRating) ? Math.max(0, Math.min(5, suppliedRating)) : 0;
  const volumeBand = getVolumeBand(reviewCount);
  const ratingQualityBand = getRatingQualityBand(rating);

  return {
    reviewCount,
    rating,
    volumeBand,
    ratingQualityBand,
    ...getDisplayEvidence(volumeBand, ratingQualityBand),
  };
}

export function formatDemandEvidenceLabel(profile: DemandEvidenceProfile): string {
  const ratingLabel = profile.rating > 0 ? ` · ${profile.rating.toFixed(1)}★` : '';
  const evidence = `${profile.reviewCount} reviews${ratingLabel}`;

  switch (profile.reasonCode) {
    case 'no_review_evidence':
      return 'No review-based demand evidence';
    case 'emerging_traffic':
      return `${evidence}: early traffic evidence`;
    case 'established_traffic':
      return `${evidence}: established traffic`;
    case 'established_traffic_unrated':
      return `${evidence}: established traffic; rating unavailable`;
    case 'established_traffic_rating_drag':
      return `${evidence}: established traffic with rating drag`;
    case 'boutique_demand':
      return `${evidence}: boutique demand signal`;
    case 'high_traffic':
      return `${evidence}: high traffic signal`;
    case 'high_traffic_unrated':
      return `${evidence}: high traffic; rating unavailable`;
    case 'high_traffic_rating_drag':
      return `${evidence}: high traffic with rating drag`;
    case 'sustained_traffic':
      return `${evidence}: sustained traffic`;
    case 'sustained_traffic_unrated':
      return `${evidence}: sustained traffic; rating unavailable`;
    case 'sustained_traffic_rating_drag':
      return `${evidence}: sustained traffic with rating drag`;
    case 'sustained_premium_demand':
      return `${evidence}: sustained premium demand`;
  }
}
