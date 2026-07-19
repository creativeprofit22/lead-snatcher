/**
 * Custom API error class with user-friendly messages
 */
export class ApiError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Parse RapidAPI error response and return user-friendly message
 */
export function parseRapidApiError(status: number, responseText: string): ApiError {
  // Try to parse JSON error
  let errorMessage = '';
  try {
    const json = JSON.parse(responseText);
    errorMessage = json.message || json.error || json.detail || '';
  } catch {
    errorMessage = responseText;
  }

  switch (status) {
    case 401:
      return new ApiError('Invalid RapidAPI key', 'RAPIDAPI_INVALID_KEY', 401);
    case 403:
      if (errorMessage.toLowerCase().includes('not subscribed')) {
        return new ApiError('Not subscribed to this API', 'RAPIDAPI_NOT_SUBSCRIBED', 403);
      }
      return new ApiError('API access forbidden', 'RAPIDAPI_FORBIDDEN', 403);
    case 404:
      return new ApiError('API endpoint not found', 'RAPIDAPI_NOT_FOUND', 404);
    case 429:
      return new ApiError('Rate limit exceeded', 'RAPIDAPI_RATE_LIMIT', 429);
    case 500:
    case 502:
    case 503:
      return new ApiError('API temporarily unavailable', 'RAPIDAPI_SERVER_ERROR', status);
    default:
      // Return a shortened version of the error
      const shortMsg = errorMessage.slice(0, 100) || 'Request failed';
      return new ApiError(shortMsg, 'RAPIDAPI_ERROR', status);
  }
}

/**
 * Check if error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * Get user-friendly error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    // Check for common patterns and shorten
    const msg = error.message;
    if (msg.includes('API key not configured')) {
      return msg.split('.')[0] ?? msg; // Just first sentence
    }
    return msg.slice(0, 100);
  }
  return 'An unexpected error occurred';
}

/**
 * Safely parse JSON from request body
 * Returns null if parsing fails (invalid JSON)
 */
export async function parseRequestBody<T = unknown>(request: Request): Promise<T | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
