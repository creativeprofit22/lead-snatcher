import { describe, expect, test, vi } from 'vitest';
import { createCrmTag, CrmTagMutationError, deleteCrmTag, updateCrmTag } from './crm-tags-client';

describe('CRM tags mutation client', () => {
  test('preserves mutation requests and ignores successful response bodies', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(
        new Response('<html>not JSON</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      createCrmTag({ name: 'Priority', color: '#3b82f6' }, fetcher)
    ).resolves.toBeUndefined();
    await expect(
      updateCrmTag('tag-1', { name: 'Qualified', color: '#22c55e' }, fetcher)
    ).resolves.toBeUndefined();
    await expect(deleteCrmTag('tag-1', fetcher)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Priority', color: '#3b82f6' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/tags/tag-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Qualified', color: '#22c55e' }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/tags/tag-1', {
      method: 'DELETE',
    });
  });

  test('exposes a validated JSON error message and HTTP status', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'A tag with this name already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(createCrmTag({ name: 'Priority', color: '#3b82f6' }, fetcher)).rejects.toEqual(
      new CrmTagMutationError(409, 'A tag with this name already exists')
    );
  });

  test.each([
    ['empty', new Response(null, { status: 500 })],
    [
      'HTML',
      new Response('<html>Server error</html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    ],
    [
      'malformed JSON',
      new Response('{', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ],
    [
      'JSON without a string error',
      new Response(JSON.stringify({ error: { message: 'Server error' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ],
  ])('does not expose a server message from an %s error body', async (_label, response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);

    const request = deleteCrmTag('tag-1', fetcher);

    await expect(request).rejects.toBeInstanceOf(CrmTagMutationError);
    await expect(request).rejects.toMatchObject({ status: 500, serverMessage: undefined });
  });
});
