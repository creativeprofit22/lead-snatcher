interface ParsedFollowUpDate {
  inputValue: string;
  displayValue: string;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

export function parseFollowUpDate(value: string | null | undefined): ParsedFollowUpDate | null {
  const normalizedValue = value?.trim();
  if (!normalizedValue) return null;

  const dateOnly = parseDateOnly(normalizedValue);
  if (dateOnly) {
    return {
      inputValue: normalizedValue,
      displayValue: dateOnly.toLocaleDateString(),
    };
  }

  const datePart = normalizedValue.slice(0, 10);
  if (!normalizedValue.startsWith(`${datePart}T`) || !parseDateOnly(datePart)) return null;

  const timestamp = new Date(normalizedValue);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    inputValue: datePart,
    displayValue: timestamp.toLocaleDateString(),
  };
}

export function serializeFollowUpInputToIso(value: string): string | null {
  return value ? `${value}T12:00:00.000Z` : null;
}

export function formatLeadDetailTimestamp(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
