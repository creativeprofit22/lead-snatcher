import { describe, expect, test } from 'vitest';
import type { Lead as PrismaLead, Tag as PrismaTag } from '@/generated/prisma/client';
import { toLeadDto } from './lead-dto';

const timestamp = new Date('2026-07-24T10:00:00.000Z');
const tag: PrismaTag = {
  id: 'tag-1',
  userId: 'user-1',
  name: 'Priority',
  color: '#ff0000',
  createdAt: timestamp,
};

const persistedLead: PrismaLead & { tags: Array<{ tag: PrismaTag }> } = {
  id: 'lead-1',
  userId: 'user-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  address: null,
  phone: '555-0100',
  website: null,
  rating: 4.8,
  reviewCount: 12,
  industryType: 'medical',
  photoUrl: null,
  mapsUrl: 'https://maps.example/acme',
  leadScore: 72,
  scoreBreakdown: '{"noWebsite":20}',
  status: 'contacted',
  notes: null,
  opportunities: '["Build a website"]',
  lastContactedAt: timestamp,
  nextFollowUpAt: null,
  popularTimesData: '{"weekly":[]}',
  popularTimesScrapedAt: timestamp,
  savedAt: timestamp,
  updatedAt: timestamp,
  tags: [{ tag }],
};

const expectedLead = {
  id: 'lead-1',
  placeId: 'place-1',
  name: 'Acme Dental',
  address: null,
  phone: '555-0100',
  website: null,
  rating: 4.8,
  reviewCount: 12,
  industryType: 'medical',
  photoUrl: null,
  mapsUrl: 'https://maps.example/acme',
  leadScore: 72,
  scoreBreakdown: { noWebsite: 20 },
  status: 'contacted',
  notes: null,
  opportunities: ['Build a website'],
  lastContactedAt: timestamp.toISOString(),
  nextFollowUpAt: null,
  savedAt: timestamp.toISOString(),
  updatedAt: timestamp.toISOString(),
  tags: [
    {
      id: 'tag-1',
      name: 'Priority',
      color: '#ff0000',
      createdAt: timestamp.toISOString(),
    },
  ],
  popularTimesData: '{"weekly":[]}',
  popularTimesScrapedAt: timestamp.toISOString(),
};

function expectLeadContract() {
  expect(toLeadDto(persistedLead)).toEqual(expectedLead);
}

describe('lead endpoint response mapper contracts', () => {
  test('maps the list endpoint lead contract', expectLeadContract);
  test('maps the create endpoint lead contract', expectLeadContract);
  test('maps the detail endpoint lead contract', expectLeadContract);
  test('maps the update endpoint lead contract', expectLeadContract);

  test('uses safe defaults for absent relations and invalid persisted JSON', () => {
    expect(
      toLeadDto({
        ...persistedLead,
        scoreBreakdown: 'invalid',
        opportunities: 'invalid',
        tags: undefined,
      })
    ).toMatchObject({ scoreBreakdown: null, opportunities: [], tags: [] });
  });
});
