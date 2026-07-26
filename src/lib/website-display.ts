const INVALID_WEBSITE_LABEL = 'Invalid website';
const HTTP_URL_PREFIX = /^https?:\/\//i;
const URI_SCHEME_PREFIX = /^[a-z][a-z\d+.-]*:/i;
const HOST_WITH_NUMERIC_PORT = /^[^/?#]+:\d+(?:[/?#]|$)/;

function isUnambiguousSchemeLessHostname(hostname: string): boolean {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return true;

  const labels = hostname.replace(/\.$/, '').split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    )
  );
}

/** Formats persisted website data for display without trusting it to be a valid URL. */
export function formatWebsiteHostname(website: string | null | undefined): string | null {
  if (website == null) return null;

  const value = website.trim();
  if (!value) return INVALID_WEBSITE_LABEL;

  let candidate = value;
  let isSchemeLess = false;

  if (HTTP_URL_PREFIX.test(value)) {
    candidate = value;
  } else if (value.startsWith('//')) {
    candidate = `https:${value}`;
    isSchemeLess = true;
  } else {
    if (
      (URI_SCHEME_PREFIX.test(value) && !HOST_WITH_NUMERIC_PORT.test(value)) ||
      value.startsWith('/') ||
      /[\s\\]/.test(value)
    ) {
      return INVALID_WEBSITE_LABEL;
    }

    candidate = `https://${value}`;
    isSchemeLess = true;
  }

  try {
    const parsed = new URL(candidate);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      (isSchemeLess && !isUnambiguousSchemeLessHostname(parsed.hostname))
    ) {
      return INVALID_WEBSITE_LABEL;
    }

    return parsed.hostname;
  } catch {
    return INVALID_WEBSITE_LABEL;
  }
}
