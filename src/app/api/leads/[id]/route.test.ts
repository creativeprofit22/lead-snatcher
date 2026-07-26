import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { getCurrentUserId, findLead, updateLead, deleteLead } = vi.hoisted(() => ({
  getCurrentUserId: vi.fn(),
  findLead: vi.fn(),
  updateLead: vi.fn(),
  deleteLead: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ getCurrentUserId }));
vi.mock('@/lib/db', () => ({
  prisma: {
    lead: { findFirst: findLead, update: updateLead, delete: deleteLead },
  },
}));

import { DELETE, GET, PATCH } from './route';

const context = { params: Promise.resolve({ id: 'lead-1' }) };
const savedAt = new Date('2026-07-25T09:00:00.000Z');
const updatedAt = new Date('2026-07-25T10:00:00.000Z');
const storedLead = {
  id: 'lead-1',
  userId: 'user-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  address: null,
  phone: null,
  website: null,
  rating: null,
  reviewCount: null,
  industryType: 'medical',
  photoUrl: null,
  mapsUrl: null,
  leadScore: 70,
  scoreBreakdown: null,
  status: 'new',
  notes: null,
  opportunities: '[]',
  lastContactedAt: null,
  nextFollowUpAt: null,
  popularTimesData: null,
  popularTimesScrapedAt: null,
  savedAt,
  updatedAt,
  tags: [],
};

function get() {
  return GET(new Request('http://localhost/api/leads/lead-1'), context);
}

function patch(body: BodyInit) {
  return PATCH(
    new Request('http://localhost/api/leads/lead-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
    }),
    context
  );
}

function remove() {
  return DELETE(new Request('http://localhost/api/leads/lead-1', { method: 'DELETE' }), context);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  getCurrentUserId.mockResolvedValue('user-1');
  findLead.mockResolvedValue(storedLead);
  updateLead.mockResolvedValue(storedLead);
  deleteLead.mockResolvedValue(storedLead);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/leads/[id]', () => {
  test('returns 401 before querying Prisma when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findLead).not.toHaveBeenCalled();
  });

  test('returns an owned lead with the established DTO shape', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
      include: { tags: { include: { tag: true } } },
    });
    await expect(response.json()).resolves.toEqual({
      lead: expect.objectContaining({
        id: 'lead-1',
        name: 'Acme Dental',
        status: 'new',
        savedAt: savedAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        tags: [],
      }),
    });
  });

  test.each(['foreign', 'missing'])('returns the same 404 for a %s lead ID', async () => {
    findLead.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
  });

  test('returns only the route fallback for unexpected errors', async () => {
    findLead.mockRejectedValue(new Error('SQLite connection details'));

    const response = await get();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch lead' });
  });
});

describe('PATCH /api/leads/[id]', () => {
  test('returns 401 before parsing or querying when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await patch(JSON.stringify({ status: 'called' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findLead).not.toHaveBeenCalled();
    expect(updateLead).not.toHaveBeenCalled();
  });

  test('returns the shared 400 contract for malformed JSON without writing', async () => {
    const response = await patch('{"status":');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
    expect(findLead).not.toHaveBeenCalled();
    expect(updateLead).not.toHaveBeenCalled();
  });

  test('returns schema 400 without writing', async () => {
    const response = await patch(JSON.stringify({ status: 'invalid-status' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Invalid option');
    expect(findLead).not.toHaveBeenCalled();
    expect(updateLead).not.toHaveBeenCalled();
  });

  test('updates an owned lead and preserves the success response', async () => {
    const nextFollowUpAt = '2026-08-01T12:00:00.000Z';
    updateLead.mockResolvedValue({
      ...storedLead,
      status: 'called',
      notes: 'Reached the owner',
      nextFollowUpAt: new Date(nextFollowUpAt),
    });

    const response = await patch(
      JSON.stringify({ status: 'called', notes: 'Reached the owner', nextFollowUpAt })
    );

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
    });
    expect(updateLead).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: {
        status: 'called',
        notes: 'Reached the owner',
        nextFollowUpAt: new Date(nextFollowUpAt),
        lastContactedAt: expect.any(Date),
      },
      include: { tags: { include: { tag: true } } },
    });
    await expect(response.json()).resolves.toEqual({
      lead: expect.objectContaining({
        id: 'lead-1',
        status: 'called',
        notes: 'Reached the owner',
        nextFollowUpAt,
      }),
      message: 'Lead updated successfully',
    });
  });

  test.each(['foreign', 'missing'])('returns the same 404 for a %s lead ID', async () => {
    findLead.mockResolvedValue(null);

    const response = await patch(JSON.stringify({ notes: 'Follow up' }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
    expect(updateLead).not.toHaveBeenCalled();
  });

  test('returns only the route fallback for unexpected errors', async () => {
    updateLead.mockRejectedValue(new Error('SQLite connection details'));

    const response = await patch(JSON.stringify({ notes: 'Follow up' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to update lead' });
  });
});

describe('DELETE /api/leads/[id]', () => {
  test('returns 401 before querying Prisma when authentication is missing', async () => {
    getCurrentUserId.mockResolvedValue(null);

    const response = await remove();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(findLead).not.toHaveBeenCalled();
    expect(deleteLead).not.toHaveBeenCalled();
  });

  test('deletes an owned lead and preserves the success message', async () => {
    const response = await remove();

    expect(response.status).toBe(200);
    expect(findLead).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1' },
    });
    expect(deleteLead).toHaveBeenCalledWith({ where: { id: 'lead-1' } });
    await expect(response.json()).resolves.toEqual({ message: 'Lead deleted successfully' });
  });

  test.each(['foreign', 'missing'])('returns the same 404 for a %s lead ID', async () => {
    findLead.mockResolvedValue(null);

    const response = await remove();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Lead not found' });
    expect(deleteLead).not.toHaveBeenCalled();
  });

  test('returns only the route fallback for unexpected errors', async () => {
    deleteLead.mockRejectedValue(new Error('SQLite connection details'));

    const response = await remove();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Failed to delete lead' });
  });
});
