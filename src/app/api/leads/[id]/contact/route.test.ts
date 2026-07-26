import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  getCurrentUserId,
  findLead,
  findContactLogs,
  transaction,
  transactionFindLead,
  createContactLog,
  updateLead,
} = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  findLead: vi.fn(),
  findContactLogs: vi.fn(),
  transaction: vi.fn(),
  transactionFindLead: vi.fn(),
  createContactLog: vi.fn(),
  updateLead: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: transaction,
    lead: { findFirst: findLead },
    contactLog: { findMany: findContactLogs },
  },
}));

import { GET, POST } from './route';

const context = { params: Promise.resolve({ id: 'lead-1' }) };
const createdAt = new Date('2026-07-25T09:00:00.000Z');
const contactLog = {
  id: 'contact-1',
  leadId: 'lead-1',
  type: 'call',
  summary: 'Spoke with the owner',
  outcome: 'positive',
  createdAt,
};

const transactionClient = {
  lead: { findFirst: transactionFindLead, update: updateLead },
  contactLog: { create: createContactLog },
};
type TransactionWork = (client: typeof transactionClient) => Promise<unknown>;

function get() {
  return GET(new Request('http://localhost/api/leads/lead-1/contact'), context);
}

function post(body: BodyInit) {
  return POST(
    new Request('http://localhost/api/leads/lead-1/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    context
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  getCurrentUserId.mockResolvedValue('user-1');
  findLead.mockResolvedValue({ id: 'lead-1', userId: 'user-1' });
  findContactLogs.mockResolvedValue([contactLog]);
  transactionFindLead.mockResolvedValue({ id: 'lead-1' });
  createContactLog.mockResolvedValue(contactLog);
  updateLead.mockResolvedValue({ id: 'lead-1' });
  transaction.mockImplementation((work: TransactionWork) => work(transactionClient));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/leads/[id]/contact', () => {
  test('returns 401 before querying Prisma when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findLead).not.toHaveBeenCalled();
    expect(findContactLogs).not.toHaveBeenCalled();
  });

  test('returns contact logs only after verifying parent lead ownership', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
    });
    expect(findContactLogs).toHaveBeenCalledWith({
      where: { leadId: 'lead-1' },
      orderBy: { createdAt: 'desc' },
    });
    await expect(response.json()).resolves.toEqual({
      contactLogs: [{ ...contactLog, createdAt: createdAt.toISOString() }],
    });
  });

  test.each(['foreign', 'missing'])('returns the same 404 for a %s parent lead ID', async () => {
    findLead.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
    expect(findContactLogs).not.toHaveBeenCalled();
  });

  test('returns only the route fallback for unexpected errors', async () => {
    findContactLogs.mockRejectedValue(new Error('SQLite connection details'));

    const response = await get();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch contact logs' });
  });
});

describe('POST /api/leads/[id]/contact', () => {
  test('returns 401 before parsing or opening a transaction when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await post(JSON.stringify({ type: 'call', summary: 'Spoke with the owner' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('returns the shared 400 contract for malformed JSON without writing', async () => {
    const response = await post('{"type":');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(transaction).not.toHaveBeenCalled();
  });

  test('returns schema 400 without writing', async () => {
    const response = await post(JSON.stringify({ type: 'fax', summary: '' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid option');
    expect(transaction).not.toHaveBeenCalled();
  });

  test('creates a contact log and timestamp atomically for an owned lead', async () => {
    const response = await post(
      JSON.stringify({
        type: 'call',
        summary: 'Spoke with the owner',
        outcome: 'positive',
      })
    );

    expect(response.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transactionFindLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
      select: { id: true },
    });
    expect(createContactLog).toHaveBeenCalledWith({
      data: {
        leadId: 'lead-1',
        type: 'call',
        summary: 'Spoke with the owner',
        outcome: 'positive',
      },
    });
    expect(updateLead).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { lastContactedAt: expect.any(Date) },
    });
    await expect(response.json()).resolves.toEqual({
      contactLog: { ...contactLog, createdAt: createdAt.toISOString() },
      message: 'Contact log added successfully',
    });
  });

  test.each(['foreign', 'missing'])(
    'returns the same 404 for a %s lead ID without mutating transaction state',
    async () => {
      transactionFindLead.mockResolvedValue(null);

      const response = await post(
        JSON.stringify({ type: 'call', summary: 'Spoke with the owner' })
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
      expect(transactionFindLead).toHaveBeenCalledWith({
        where: { id: 'lead-1', userId: 'user-1' },
        select: { id: true },
      });
      expect(createContactLog).not.toHaveBeenCalled();
      expect(updateLead).not.toHaveBeenCalled();
    }
  );

  test('cannot commit the contact log when the timestamp update fails', async () => {
    const committedContactLogs: unknown[] = [];
    updateLead.mockRejectedValue(new Error('timestamp update failed'));
    transaction.mockImplementation(async (work: TransactionWork) => {
      const pendingContactLogs: unknown[] = [];
      createContactLog.mockImplementationOnce(async ({ data }: { data: unknown }) => {
        pendingContactLogs.push(data);
        return contactLog;
      });

      const result = await work(transactionClient);
      committedContactLogs.push(...pendingContactLogs);
      return result;
    });

    const response = await post(JSON.stringify({ type: 'call', summary: 'Spoke with the owner' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to add contact log' });
    expect(createContactLog).toHaveBeenCalledTimes(1);
    expect(updateLead).toHaveBeenCalledTimes(1);
    expect(committedContactLogs).toEqual([]);
  });

  test('returns only the route fallback for unexpected transaction errors', async () => {
    transaction.mockRejectedValue(new Error('SQLite connection details'));

    const response = await post(JSON.stringify({ type: 'call', summary: 'Spoke with the owner' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to add contact log' });
  });
});
