import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { BusinessSearchResult, ScoreBreakdown } from '@/types';

import { LeadResultCard, type LeadResultTier } from './LeadResultCard';

vi.mock('./LeadScoreBadge', () => ({
  LeadScoreBadge: ({ score }: { score: number }) => (
    <button title="Click for details">{score}</button>
  ),
}));
vi.mock('@/components/motion-primitives/glow-effect', () => ({ GlowEffect: () => null }));

const scoreBreakdown: ScoreBreakdown = {
  noWebsite: 0,
  socialOnlyWebsite: 0,
  noPhone: 0,
  fewPhotos: 0,
  lowReviews: 0,
  hiddenGem: 0,
  poorPerformance: 0,
  notMobileFriendly: 0,
  noHttps: 0,
  outdatedWebsite: 0,
  noOnlineBooking: 0,
  noSocialLinks: 0,
  basicTechStack: 0,
  noViewport: 0,
  tableLayout: 0,
  thinContent: 0,
  deprecatedTags: 0,
  templateFingerprint: 0,
  noForm: 0,
  fixedPixelWidth: 0,
  outdatedJquery: 0,
  noSchemaOrg: 0,
  noOpenGraph: 0,
  noLangAttribute: 0,
  lowAccessibility: 0,
  lowSeo: 0,
  lowBestPractices: 0,
  slowLcp: 0,
  highCls: 0,
  qualityChips: [],
  hasMarketingBudget: false,
  marketingPlatforms: [],
  revenueSignal: 'medium',
  revenueLabel: 'Established local demand',
  total: 65,
};

const baseLead: BusinessSearchResult = {
  placeId: 'lead-1',
  name: 'Northstar Retail Studio',
  address: '12 Market Street, London',
  phone: '+44 20 7946 0100',
  email: 'hello@northstar.test',
  website: 'https://northstar.test',
  mapsUrl: 'https://maps.example/northstar',
  rating: 4.7,
  reviewCount: 38,
  photoCount: 3,
  types: ['store'],
  socialLinks: {
    facebook: 'https://facebook.com/northstar',
    instagram: 'https://instagram.com/northstar',
    twitter: 'https://x.com/northstar',
    linkedin: 'https://linkedin.com/company/northstar',
    youtube: 'https://youtube.com/@northstar',
    tiktok: 'https://tiktok.com/@northstar',
  },
  contactPoints: 9,
  priceLevel: 3,
  budgetEstimate: {
    min: 1000,
    max: 3000,
    label: '$1K - $3K',
    confidence: 'high',
    reasons: ['Strong review volume', 'Premium location'],
    points: 72,
  },
  leadScore: 65,
  scoreBreakdown,
  opportunities: ['Add online booking', 'Improve local search visibility', 'Launch paid ads'],
  industryType: 'retail',
};

interface RenderOptions {
  lead?: Partial<BusinessSearchResult>;
  index?: number;
  rank?: number;
  tier?: LeadResultTier;
  selected?: boolean;
  enrichmentStatus?: 'idle' | 'enriching' | 'enriched' | 'rate_limited' | 'error';
  enrichmentResult?: { website?: string; socials?: BusinessSearchResult['socialLinks'] };
  saveBusy?: boolean;
  onToggleSelection?: () => void;
  onSave?: () => void;
}

function renderCard(options: RenderOptions = {}) {
  return render(
    <LeadResultCard
      lead={{ ...baseLead, ...options.lead }}
      index={options.index ?? 0}
      rank={options.rank ?? 1}
      tier={options.tier ?? 'hot'}
      selected={options.selected ?? false}
      onToggleSelection={options.onToggleSelection ?? vi.fn()}
      enrichmentStatus={options.enrichmentStatus ?? 'idle'}
      enrichmentResult={options.enrichmentResult}
      onEnrich={vi.fn()}
      onRequestEnrichmentExplainer={() => false}
      saveBusy={options.saveBusy ?? false}
      onSave={options.onSave ?? vi.fn()}
    />
  );
}

function expectSafeNewTabLink(link: HTMLElement) {
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
}

afterEach(cleanup);

describe('LeadResultCard characterization', () => {
  test('preserves rank, heat, stagger, and HOT LEAD treatment', () => {
    const { container } = renderCard({ index: 4, rank: 1, tier: 'hot' });

    const wrapper = container.querySelector<HTMLElement>('[data-heat="hot"]');
    expect(wrapper?.getAttribute('data-rank')).toBe('1');
    expect(wrapper?.style.getPropertyValue('--i')).toBe('4');
    expect(screen.getByText(/#1 HOT LEAD/).classList).toContain('lead-rank-pip');
    expect(screen.getByText(/#1 HOT LEAD/).classList).toContain('lead-rank-1');
    expect(container.querySelector('.lead-card')?.classList).toContain('lead-tier-hot');
  });

  test('renders contact links and suppresses junk email through the shared policy', () => {
    const { rerender } = renderCard();

    expect(screen.getByRole('link', { name: '+44 20 7946 0100' }).getAttribute('href')).toBe(
      'tel:+44 20 7946 0100'
    );
    expect(screen.getByRole('link', { name: 'hello@northstar.test' }).getAttribute('href')).toBe(
      'mailto:hello@northstar.test'
    );

    rerender(
      <LeadResultCard
        lead={{ ...baseLead, email: 'noreply@example.com' }}
        index={0}
        rank={1}
        tier="hot"
        selected={false}
        onToggleSelection={vi.fn()}
        enrichmentStatus="idle"
        onEnrich={vi.fn()}
        onRequestEnrichmentExplainer={() => false}
        saveBusy={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByText('noreply@example.com')).toBeNull();
  });

  test('describes positive and no-data enrichment results', () => {
    const { rerender } = renderCard({
      enrichmentStatus: 'enriched',
      enrichmentResult: {
        website: 'https://found.test',
        socials: {
          instagram: 'https://instagram.com/found',
          facebook: 'https://facebook.com/found',
        },
      },
    });

    expect(screen.getByRole('status').textContent).toContain('+ website, 2 socials');

    rerender(
      <LeadResultCard
        lead={baseLead}
        index={0}
        rank={1}
        tier="hot"
        selected={false}
        onToggleSelection={vi.fn()}
        enrichmentStatus="enriched"
        enrichmentResult={{}}
        onEnrich={vi.fn()}
        onRequestEnrichmentExplainer={() => false}
        saveBusy={false}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByRole('status').textContent).toContain('No public contact data found');
  });

  test('forwards batch selection and save actions and exposes the save busy state', () => {
    const onToggleSelection = vi.fn();
    const onSave = vi.fn();
    const { rerender } = renderCard({ onToggleSelection, onSave });

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Northstar Retail Studio for batch enrichment' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Lead' }));
    expect(onToggleSelection).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();

    rerender(
      <LeadResultCard
        lead={baseLead}
        index={0}
        rank={1}
        tier="hot"
        selected
        onToggleSelection={onToggleSelection}
        enrichmentStatus="idle"
        onEnrich={vi.fn()}
        onRequestEnrichmentExplainer={() => false}
        saveBusy
        onSave={onSave}
      />
    );
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  test('expands budget reasons and additional opportunities', () => {
    renderCard();

    expect(screen.queryByText('Strong review volume')).toBeNull();
    expect(screen.queryByText('Launch paid ads')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /\$1K - \$3K.*high conf\./ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }));

    expect(screen.getByText('Strong review volume')).not.toBeNull();
    expect(screen.getByText('Premium location')).not.toBeNull();
    expect(screen.getByText('Launch paid ads')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show less' })).not.toBeNull();
  });

  test('keeps website, social, and Maps links isolated in new tabs', () => {
    renderCard();

    expectSafeNewTabLink(screen.getByRole('link', { name: 'Website' }));
    expectSafeNewTabLink(screen.getByRole('link', { name: 'Maps' }));
    for (const title of ['Facebook', 'Instagram', 'X / Twitter', 'LinkedIn', 'YouTube', 'TikTok']) {
      expectSafeNewTabLink(screen.getByTitle(title));
    }
  });
});
