export const API_KEY_SERVICES = ['rapidapi', 'pagespeed'] as const;

export type ApiKeyService = (typeof API_KEY_SERVICES)[number];

export const API_KEY_MAX_LENGTH = 500;

export interface ApiKeyServiceMetadata {
  label: string;
  description: string;
  helpHref: string;
  helpLabel: string;
}

export const API_KEY_SERVICE_METADATA = {
  rapidapi: {
    label: 'RapidAPI Key',
    description: 'Required for business search (Maps Data API)',
    helpHref: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/google-maps-data',
    helpLabel: 'Get a free RapidAPI key',
  },
  pagespeed: {
    label: 'PageSpeed Insights Key',
    description: 'Optional — enables Deep Analysis (website performance scoring)',
    helpHref: 'https://developers.google.com/speed/docs/insights/v5/get-started',
    helpLabel: 'Get a free PageSpeed key',
  },
} as const satisfies Record<ApiKeyService, ApiKeyServiceMetadata>;

export const API_KEY_SERVICE_REGISTRY = API_KEY_SERVICES.map((service) => ({
  service,
  ...API_KEY_SERVICE_METADATA[service],
}));
