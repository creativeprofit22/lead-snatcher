export interface CrmTagMutationInput {
  name: string;
  color: string;
}

export type CrmTagMutation =
  | { type: 'created' }
  | { type: 'updated' }
  | { type: 'deleted'; tagId: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readServerError(response: Response): Promise<string | undefined> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  if (!isRecord(body) || typeof body.error !== 'string' || body.error.length === 0) {
    return undefined;
  }

  return body.error;
}

export class CrmTagMutationError extends Error {
  constructor(
    public readonly status: number,
    public readonly serverMessage?: string
  ) {
    super(serverMessage ?? `CRM tag mutation failed (${status})`);
    this.name = 'CrmTagMutationError';
  }
}

async function requireSuccessfulMutation(response: Response): Promise<void> {
  if (response.ok) return;

  throw new CrmTagMutationError(response.status, await readServerError(response));
}

export async function createCrmTag(
  input: CrmTagMutationInput,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher('/api/tags', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });

  await requireSuccessfulMutation(response);
}

export async function updateCrmTag(
  tagId: string,
  input: CrmTagMutationInput,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const response = await fetcher(`/api/tags/${tagId}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });

  await requireSuccessfulMutation(response);
}

export async function deleteCrmTag(tagId: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`/api/tags/${tagId}`, {
    method: 'DELETE',
  });

  await requireSuccessfulMutation(response);
}
