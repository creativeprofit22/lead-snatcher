import { LEAD_STATUS_OPTIONS } from '@/lib/lead-status';
import type {
  IndustryTypeConfig,
  LeadStatusConfig,
  IndustryType,
  TaskTypeConfig,
  TaskPriorityConfig,
} from '@/types';

// Industry types for business categorization
export const INDUSTRY_TYPES: IndustryTypeConfig[] = [
  { id: 'restaurant', label: 'Restaurant & Cafe', icon: 'utensils', color: '#f97316' },
  { id: 'salon', label: 'Salon & Spa', icon: 'scissors', color: '#ec4899' },
  { id: 'fitness', label: 'Fitness & Gym', icon: 'dumbbell', color: '#22c55e' },
  { id: 'medical', label: 'Medical & Dental', icon: 'stethoscope', color: '#3b82f6' },
  { id: 'retail', label: 'Retail Store', icon: 'store', color: '#a855f7' },
  { id: 'automotive', label: 'Automotive', icon: 'car', color: '#6b7280' },
  { id: 'real_estate', label: 'Real Estate', icon: 'home', color: '#14b8a6' },
  {
    id: 'professional_services',
    label: 'Professional Services',
    icon: 'briefcase',
    color: '#64748b',
  },
  { id: 'other', label: 'Other', icon: 'building', color: '#78716c' },
];

/** Human-readable label for a persisted query while preserving custom business types verbatim. */
export function getBusinessTypeLabel(businessType: string): string {
  return INDUSTRY_TYPES.find((type) => type.id === businessType)?.label ?? businessType;
}

/**
 * Search queries for each industry type by country
 * Maps API works best with specific, localized search terms
 * Multiple queries are combined for better coverage
 */
export const INDUSTRY_SEARCH_QUERIES: Record<string, Record<IndustryType, string[]>> = {
  // German search terms
  de: {
    restaurant: ['Restaurant', 'Café', 'Gaststätte', 'Bistro'],
    salon: ['Friseur', 'Friseursalon', 'Kosmetikstudio', 'Nagelstudio', 'Spa'],
    fitness: ['Fitnessstudio', 'Gym', 'Sportstudio', 'Yoga Studio'],
    medical: ['Arztpraxis', 'Zahnarzt', 'Physiotherapie', 'Heilpraktiker'],
    retail: ['Einzelhandel', 'Geschäft', 'Boutique', 'Laden'],
    automotive: ['Autowerkstatt', 'KFZ Werkstatt', 'Autohaus', 'Reifenservice'],
    real_estate: ['Immobilienmakler', 'Hausverwaltung', 'Immobilien', 'Makler'],
    professional_services: ['Steuerberater', 'Rechtsanwalt', 'Unternehmensberatung', 'Architekt'],
    other: ['Dienstleistung', 'Service'],
  },
  // English search terms (US, AU, GB, CA, NZ)
  en: {
    restaurant: ['Restaurant', 'Cafe', 'Bistro', 'Eatery'],
    salon: ['Hair Salon', 'Beauty Salon', 'Nail Salon', 'Spa', 'Barber'],
    fitness: ['Gym', 'Fitness Center', 'Yoga Studio', 'Personal Trainer'],
    medical: ['Doctor', 'Dentist', 'Physiotherapy', 'Medical Clinic', 'Chiropractor'],
    retail: ['Retail Store', 'Shop', 'Boutique'],
    automotive: ['Auto Repair', 'Car Mechanic', 'Auto Service', 'Car Dealership'],
    real_estate: ['Real Estate Agent', 'Property Manager', 'Realtor', 'Real Estate Agency'],
    professional_services: ['Accountant', 'Lawyer', 'Consultant', 'Architect'],
    other: ['Business', 'Service'],
  },
};

/**
 * Get the best search query for an industry type and country
 * Returns the primary (most specific) search term
 */
export function getSearchQuery(industryType: IndustryType, countryCode: string): string {
  const lang = countryCode === 'de' ? 'de' : 'en';
  const queries = INDUSTRY_SEARCH_QUERIES[lang]?.[industryType];
  return queries?.[0] || industryType.replace('_', ' ');
}

/**
 * Get all search queries for an industry type and country
 * Used for broader searches
 */
export function getAllSearchQueries(industryType: IndustryType, countryCode: string): string[] {
  const lang = countryCode === 'de' ? 'de' : 'en';
  return INDUSTRY_SEARCH_QUERIES[lang]?.[industryType] || [industryType.replace('_', ' ')];
}

// Lead status configuration is projected from the canonical status metadata.
export const LEAD_STATUSES = LEAD_STATUS_OPTIONS satisfies readonly LeadStatusConfig[];

// Canonical product default used by UI and request validation.
export const DEFAULT_COUNTRY_CODE = 'us';

// Country codes for search with example cities; the default remains first.
export const COUNTRIES = [
  { code: 'us', name: 'United States', examples: ['New York, Los Angeles, Chicago'] },
  { code: 'ca', name: 'Canada', examples: ['Toronto, Vancouver, Montreal'] },
  { code: 'mx', name: 'Mexico', examples: ['Mexico City, Guadalajara, Monterrey'] },
  { code: 'gb', name: 'United Kingdom', examples: ['London, Manchester, Birmingham'] },
  { code: 'au', name: 'Australia', examples: ['Sydney, Melbourne, Brisbane'] },
  { code: 'nz', name: 'New Zealand', examples: ['Auckland, Wellington, Christchurch'] },
  { code: 'de', name: 'Germany', examples: ['Berlin, Munich, Hamburg'] },
  { code: 'at', name: 'Austria', examples: ['Vienna, Salzburg, Graz'] },
  { code: 'ch', name: 'Switzerland', examples: ['Zurich, Basel, Bern'] },
  { code: 'fr', name: 'France', examples: ['Paris, Lyon, Marseille'] },
  { code: 'es', name: 'Spain', examples: ['Madrid, Barcelona, Valencia'] },
  { code: 'it', name: 'Italy', examples: ['Rome, Milan, Naples'] },
  { code: 'nl', name: 'Netherlands', examples: ['Amsterdam, Rotterdam, The Hague'] },
  { code: 'be', name: 'Belgium', examples: ['Brussels, Antwerp, Ghent'] },
  { code: 'pl', name: 'Poland', examples: ['Warsaw, Krakow, Gdansk'] },
  { code: 'se', name: 'Sweden', examples: ['Stockholm, Gothenburg, Malmo'] },
  { code: 'dk', name: 'Denmark', examples: ['Copenhagen, Aarhus, Odense'] },
  { code: 'no', name: 'Norway', examples: ['Oslo, Bergen, Trondheim'] },
  { code: 'fi', name: 'Finland', examples: ['Helsinki, Tampere, Turku'] },
  { code: 'pt', name: 'Portugal', examples: ['Lisbon, Porto, Faro'] },
  { code: 'ie', name: 'Ireland', examples: ['Dublin, Cork, Galway'] },
  { code: 'br', name: 'Brazil', examples: ['Sao Paulo, Rio de Janeiro, Brasilia'] },
  { code: 'ar', name: 'Argentina', examples: ['Buenos Aires, Cordoba, Rosario'] },
  { code: 'co', name: 'Colombia', examples: ['Bogota, Medellin, Cali'] },
  { code: 'cl', name: 'Chile', examples: ['Santiago, Valparaiso, Concepcion'] },
  { code: 'jp', name: 'Japan', examples: ['Tokyo, Osaka, Kyoto'] },
  { code: 'kr', name: 'South Korea', examples: ['Seoul, Busan, Incheon'] },
  { code: 'sg', name: 'Singapore', examples: ['Singapore'] },
  { code: 'in', name: 'India', examples: ['Mumbai, Delhi, Bangalore'] },
  { code: 'za', name: 'South Africa', examples: ['Johannesburg, Cape Town, Durban'] },
];

// Contact log types
export const CONTACT_TYPES = [
  { id: 'call', label: 'Phone Call', icon: 'phone' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'meeting', label: 'Meeting', icon: 'calendar' },
  { id: 'note', label: 'Note', icon: 'sticky-note' },
];

// Outcome types
export const OUTCOMES = [
  { id: 'positive', label: 'Positive', color: '#22c55e' },
  { id: 'neutral', label: 'Neutral', color: '#6b7280' },
  { id: 'negative', label: 'Negative', color: '#ef4444' },
];

// Task types
export const TASK_TYPES: TaskTypeConfig[] = [
  { id: 'call', label: 'Phone Call', icon: 'phone' },
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'meeting', label: 'Meeting', icon: 'calendar' },
  { id: 'follow_up', label: 'Follow Up', icon: 'clock' },
  { id: 'other', label: 'Other', icon: 'check-circle' },
];

// Task priorities
export const TASK_PRIORITY_RANK = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
} as const satisfies Record<TaskPriorityConfig['id'], number>;

export const TASK_PRIORITIES: TaskPriorityConfig[] = [
  { id: 'low', label: 'Low', color: '#6b7280' },
  { id: 'medium', label: 'Medium', color: '#3b82f6' },
  { id: 'high', label: 'High', color: '#f97316' },
  { id: 'urgent', label: 'Urgent', color: '#ef4444' },
];
