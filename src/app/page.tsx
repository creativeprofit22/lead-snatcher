'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Settings,
  ArrowLeft,
  Plus,
  ExternalLink,
  Phone,
  Globe,
  Star,
  MessageSquare,
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  Mail,
  Users,
  Wallet,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { WelcomeHeader, BusinessTypeSelector, CityInput } from '@/components/search';
import { PreLoader } from '@/components/preloader';
import {
  LeadScoreBadge,
  OpportunitiesList,
  SaveLeadModal,
} from '@/components/leads';
import { SettingsModal } from '@/components/settings';
import { UserMenu } from '@/components/auth';
import { saveLastSearch, getLastSearch } from '@/lib/search-cache';
import type { IndustryType, BusinessSearchResult } from '@/types';

type ViewMode = 'search' | 'results';
type SortOption = 'score' | 'contactPoints' | 'reviews' | 'rating';

export default function Home() {
  const searchParams = useSearchParams();
  const [showPreLoader, setShowPreLoader] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('search');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Search state
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryType | null>(null);
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('us');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<BusinessSearchResult[]>([]);
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const [marketDensity, setMarketDensity] = useState<{
    count: number;
    level: string;
    label: string;
    description: string;
    areaScore?: number;
    competition?: string;
    amenities?: {
      banks: number;
      hotels: number;
      hospitals: number;
      pharmacies: number;
      supermarkets: number;
      fuelStations: number;
      affluenceSpots: number;
      total: number;
    };
  } | null>(null);

  // Filter & sort state
  const [sortBy, setSortBy] = useState<SortOption>('score');
  const [filterHasEmail, setFilterHasEmail] = useState(false);
  const [filterHasPhone, setFilterHasPhone] = useState(false);
  const [filterHasSocial, setFilterHasSocial] = useState(false);
  const [filterHasAds, setFilterHasAds] = useState(false);
  const [filterMinBudget, setFilterMinBudget] = useState(0);

  // Load cached search results if ?view=results
  useEffect(() => {
    if (searchParams.get('view') === 'results') {
      const cached = getLastSearch();
      if (cached) {
        setSearchResults(cached.results);
        setSelectedIndustry(cached.industry);
        setCity(cached.city);
        setCountry(cached.country);
        setViewMode('results');
        setShowPreLoader(false);
      }
    }
  }, [searchParams]);

  // Saving leads
  const [savingLeadIds, setSavingLeadIds] = useState<Set<string>>(new Set());
  const [savedLeadModal, setSavedLeadModal] = useState<{ isOpen: boolean; businessName: string }>({
    isOpen: false,
    businessName: '',
  });

  // Search businesses
  const handleSearch = async () => {
    if (!selectedIndustry || !city.trim() || isSearching) return;

    setIsSearching(true);
    try {
      const response = await fetch('/api/business/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessType: selectedIndustry,
          city: city.trim(),
          country,
          limit: 50,
          deepAnalysis,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || 'Search failed');
        return;
      }

      setSearchResults(data.results || []);
      setMarketDensity(data.marketDensity || null);
      setViewMode('results');

      // Cache search results for later access
      if (data.results?.length > 0) {
        saveLastSearch({
          results: data.results,
          industry: selectedIndustry,
          city: city.trim(),
          country,
        });
      }

      if (data.results?.length === 0) {
        toast.error('No businesses found');
      } else {
        toast.success(`Found ${data.results.length} businesses`);
      }
    } catch {
      toast.error('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  // Save lead
  const handleSaveLead = async (business: BusinessSearchResult) => {
    if (savingLeadIds.has(business.placeId)) return;

    setSavingLeadIds((prev) => new Set(prev).add(business.placeId));
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(business),
      });

      const data = await response.json();

      if (response.ok) {
        setSavedLeadModal({ isOpen: true, businessName: business.name });
      } else if (response.status === 409) {
        toast.info(`${business.name} already in CRM`);
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch {
      toast.error('Failed to save lead');
    } finally {
      setSavingLeadIds((prev) => {
        const next = new Set(prev);
        next.delete(business.placeId);
        return next;
      });
    }
  };

  // Filter and sort results
  const filteredResults = searchResults
    .filter((b) => {
      if (filterHasEmail && !(b.email && isRealEmail(b.email))) return false;
      if (filterHasPhone && !b.phone) return false;
      if (filterHasSocial && Object.keys(b.socialLinks || {}).length === 0) return false;
      if (filterHasAds && !b.scoreBreakdown.hasMarketingBudget) return false;
      if (filterMinBudget > 0 && (!b.budgetEstimate || b.budgetEstimate.min < filterMinBudget)) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'contactPoints':
          return b.contactPoints - a.contactPoints || b.leadScore - a.leadScore;
        case 'reviews':
          return (b.reviewCount || 0) - (a.reviewCount || 0);
        case 'rating':
          return (b.rating || 0) - (a.rating || 0);
        default:
          return b.leadScore - a.leadScore || b.contactPoints - a.contactPoints;
      }
    });

  const handleBackToSearch = () => {
    setViewMode('search');
    setSearchResults([]);
    setMarketDensity(null);
  };

  // Render results view
  if (viewMode === 'results') {
    return (
      <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <button
                onClick={handleBackToSearch}
                className="mb-3 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
              <h1 className="text-lg sm:text-2xl font-semibold text-white">
                {selectedIndustry} in {city}
              </h1>
              <p className="text-xs sm:text-sm text-white/60 mt-1">
                {searchResults.length} businesses found
              </p>
              {marketDensity && (
                <div className="mt-2 flex flex-col gap-2">
                  {/* Area Quality Badge */}
                  <div
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      marketDensity.level === 'high'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : marketDensity.level === 'medium'
                          ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                          : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                    }`}
                  >
                    {marketDensity.level === 'high' ? (
                      <TrendingUp className="w-3.5 h-3.5" />
                    ) : marketDensity.level === 'medium' ? (
                      <Minus className="w-3.5 h-3.5" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5" />
                    )}
                    {marketDensity.label}
                    {marketDensity.areaScore !== undefined && (
                      <span className="opacity-60">({marketDensity.areaScore}/100)</span>
                    )}
                    <span className="text-white/40">—</span>
                    <span className="font-normal opacity-80">{marketDensity.description}</span>
                  </div>

                  {/* Amenity breakdown chips */}
                  {marketDensity.amenities && marketDensity.amenities.total > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-gray-500">Nearby:</span>
                      {marketDensity.amenities.banks > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {marketDensity.amenities.banks} banks
                        </span>
                      )}
                      {marketDensity.amenities.hotels > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {marketDensity.amenities.hotels} hotels
                        </span>
                      )}
                      {marketDensity.amenities.hospitals > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {marketDensity.amenities.hospitals} hospitals
                        </span>
                      )}
                      {marketDensity.amenities.pharmacies > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {marketDensity.amenities.pharmacies} pharmacies
                        </span>
                      )}
                      {marketDensity.amenities.supermarkets > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {marketDensity.amenities.supermarkets} supermarkets
                        </span>
                      )}
                      {marketDensity.amenities.affluenceSpots > 0 && (
                        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {marketDensity.amenities.affluenceSpots} leisure
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <Link
              href="/crm"
              className="flex items-center gap-2 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              View My Leads
            </Link>
          </div>

          {/* Filters & Sort */}
          <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-gray-800/30 border border-gray-700/50 rounded-xl">
            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 outline-none focus:border-white/20"
              >
                <option value="score">Lead Score</option>
                <option value="contactPoints">Contact Points</option>
                <option value="reviews">Reviews</option>
                <option value="rating">Rating</option>
              </select>
            </div>

            <div className="h-4 w-px bg-gray-700 hidden sm:block" />

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">Filter:</span>
              <FilterToggle label="Has Email" active={filterHasEmail} onClick={() => setFilterHasEmail(!filterHasEmail)} />
              <FilterToggle label="Has Phone" active={filterHasPhone} onClick={() => setFilterHasPhone(!filterHasPhone)} />
              <FilterToggle label="Has Social" active={filterHasSocial} onClick={() => setFilterHasSocial(!filterHasSocial)} />
              <FilterToggle label="Runs Ads" active={filterHasAds} onClick={() => setFilterHasAds(!filterHasAds)} />
              <select
                value={filterMinBudget}
                onChange={(e) => setFilterMinBudget(Number(e.target.value))}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 outline-none focus:border-white/20"
              >
                <option value={0}>Any Budget</option>
                <option value={500}>$500+</option>
                <option value={1500}>$1.5K+</option>
                <option value={3000}>$3K+</option>
                <option value={5000}>$5K+</option>
              </select>
            </div>

            {/* Count */}
            <span className="text-xs text-gray-500 sm:ml-auto">
              {filteredResults.length}/{searchResults.length} shown
            </span>
          </div>

          <div className="grid gap-4">
            {filteredResults.map((business) => (
              <div
                key={business.placeId}
                className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 sm:p-5"
              >
                <div className="flex flex-col lg:flex-row gap-4">
                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold text-white truncate">
                          {business.name}
                        </h3>
                        {business.address && (
                          <p className="text-sm text-gray-400 flex items-center gap-1.5 mt-1">
                            <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="truncate">{business.address}</span>
                          </p>
                        )}
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-700/50 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          {business.phone}
                        </a>
                      )}
                      {business.email && isRealEmail(business.email) && (
                        <a
                          href={`mailto:${business.email}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-700/50 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-700/50 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                        >
                          <Globe className="w-3.5 h-3.5" />
                          Website
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {business.mapsUrl && (
                        <a
                          href={business.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-700/50 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          Maps
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {/* Social Media Links */}
                    {business.socialLinks && Object.keys(business.socialLinks).length > 0 && (
                      <div className="flex items-center gap-2 mb-3">
                        <Users className="w-3.5 h-3.5 text-gray-500" />
                        {business.socialLinks.facebook && (
                          <a href={business.socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-400 transition-colors" title="Facebook">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.instagram && (
                          <a href={business.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-pink-400 transition-colors" title="Instagram">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.twitter && (
                          <a href={business.socialLinks.twitter} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors" title="X / Twitter">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.linkedin && (
                          <a href={business.socialLinks.linkedin} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-300 transition-colors" title="LinkedIn">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.youtube && (
                          <a href={business.socialLinks.youtube} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-red-400 transition-colors" title="YouTube">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                          </a>
                        )}
                        {business.socialLinks.tiktok && (
                          <a href={business.socialLinks.tiktok} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors" title="TikTok">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      {business.rating && (
                        <span className="flex items-center gap-1">
                          <Star className="w-4 h-4 text-yellow-500" />
                          {business.rating.toFixed(1)}
                        </span>
                      )}
                      {business.reviewCount !== undefined && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-4 h-4" />
                          {business.reviewCount} reviews
                        </span>
                      )}
                      <span className="flex items-center gap-1" title="Contact channels available">
                        <Users className="w-4 h-4" />
                        {business.contactPoints} contact {business.contactPoints === 1 ? 'point' : 'points'}
                      </span>
                    </div>
                  </div>

                  {/* Budget & Opportunities */}
                  <div className="lg:w-80 flex flex-col gap-3">
                    {/* Budget Estimate */}
                    {business.budgetEstimate && (
                      <BudgetCard estimate={business.budgetEstimate} />
                    )}

                    <OpportunitiesList opportunities={business.opportunities} maxVisible={2} />
                    <button
                      onClick={() => handleSaveLead(business)}
                      disabled={savingLeadIds.has(business.placeId)}
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-green-600 text-white font-medium text-sm hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4" />
                      {savingLeadIds.has(business.placeId) ? 'Saving...' : 'Save Lead'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Save Lead Confirmation Modal */}
        <SaveLeadModal
          isOpen={savedLeadModal.isOpen}
          businessName={savedLeadModal.businessName}
          onClose={() => setSavedLeadModal({ isOpen: false, businessName: '' })}
          onViewCRM={() => {
            setSavedLeadModal({ isOpen: false, businessName: '' });
            window.location.href = '/crm';
          }}
        />
      </div>
    );
  }

  // Render search view (default)
  return (
    <>
      {showPreLoader && <PreLoader onComplete={() => setShowPreLoader(false)} />}
      <div className="relative flex min-h-screen flex-col items-center justify-center px-3 sm:px-4">
        {/* Top Right Controls */}
        <div className="fixed right-3 top-3 sm:right-6 sm:top-6 z-40 flex items-center gap-3">
          <Link
            href="/crm"
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            My Leads
          </Link>
          <UserMenu />
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>

        {/* Main content */}
        <div className="flex w-full max-w-3xl flex-col items-center gap-6 sm:gap-8 pt-16 sm:pt-0">
          <WelcomeHeader />

          <p className="text-sm text-gray-400 text-center max-w-md">
            Find local businesses that need your digital services.
            Search by industry and location to discover opportunities.
          </p>

          <BusinessTypeSelector selected={selectedIndustry} onSelect={setSelectedIndustry} />

          {selectedIndustry && (
            <>
              <CityInput
                city={city}
                country={country}
                onCityChange={setCity}
                onCountryChange={setCountry}
                onSearch={handleSearch}
                isLoading={isSearching}
              />

              {/* Deep Analysis Toggle */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={deepAnalysis}
                    onChange={(e) => setDeepAnalysis(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:bg-green-600 transition-colors" />
                  <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm text-white group-hover:text-white/90">
                    Deep Website Analysis
                  </span>
                  <span className="text-xs text-gray-500">
                    Analyze website performance via PageSpeed API (slower but more accurate scoring)
                  </span>
                </div>
              </label>
            </>
          )}
        </div>
      </div>
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
}

function BudgetCard({
  estimate,
}: {
  estimate: {
    min: number;
    max: number;
    label: string;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
  };
}) {
  const [expanded, setExpanded] = useState(false);

  const confidenceColor =
    estimate.confidence === 'high'
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
      : estimate.confidence === 'medium'
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
        : 'text-gray-400 bg-white/5 border-white/10';

  return (
    <div className={`rounded-lg border p-3 ${confidenceColor}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4" />
          <span className="text-sm font-semibold">{estimate.label}</span>
          <span className="text-[10px] uppercase opacity-60">{estimate.confidence} conf.</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 opacity-50" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        )}
      </button>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
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

function isRealEmail(email: string): boolean {
  const junk = [
    /user@/i, /name@/i, /someone@/i, /test@/i, /your/i,
    /example\.com/i, /domain\.com/i, /email\.com$/i,
    /noreply/i, /no-reply/i, /placeholder/i, /sample/i,
    /changeme/i, /wix\.com/i, /sentry/i, /wordpress/i,
  ];
  return !junk.some((p) => p.test(email));
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
        active
          ? 'bg-white/10 border-white/20 text-white'
          : 'bg-transparent border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
      }`}
    >
      {label}
    </button>
  );
}
