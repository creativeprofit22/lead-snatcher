import { describe, expect, test, vi } from 'vitest';
import { getOrLoadCachedApiKey, invalidateCachedApiKey } from './cache';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('API key cache invalidation', () => {
  test('does not cache an old key when an update overlaps its load', async () => {
    const oldKeyLoad = createDeferred<string | undefined>();
    const firstRead = getOrLoadCachedApiKey('update-user', 'rapidapi', () => oldKeyLoad.promise);

    invalidateCachedApiKey('update-user', 'rapidapi');
    oldKeyLoad.resolve('old-key');

    await expect(firstRead).resolves.toBe('old-key');

    const updatedKeyLoader = vi.fn(async () => 'updated-key');
    await expect(getOrLoadCachedApiKey('update-user', 'rapidapi', updatedKeyLoader)).resolves.toBe(
      'updated-key'
    );
    expect(updatedKeyLoader).toHaveBeenCalledOnce();

    const cachedKeyLoader = vi.fn(async () => 'unexpected-key');
    await expect(getOrLoadCachedApiKey('update-user', 'rapidapi', cachedKeyLoader)).resolves.toBe(
      'updated-key'
    );
    expect(cachedKeyLoader).not.toHaveBeenCalled();
  });

  test('does not cache an old key when a delete overlaps its load', async () => {
    const oldKeyLoad = createDeferred<string | undefined>();
    const firstRead = getOrLoadCachedApiKey('delete-user', 'pagespeed', () => oldKeyLoad.promise);

    invalidateCachedApiKey('delete-user', 'pagespeed');
    oldKeyLoad.resolve('deleted-key');

    await expect(firstRead).resolves.toBe('deleted-key');

    const deletedKeyLoader = vi.fn(async () => undefined);
    await expect(
      getOrLoadCachedApiKey('delete-user', 'pagespeed', deletedKeyLoader)
    ).resolves.toBeUndefined();
    expect(deletedKeyLoader).toHaveBeenCalledOnce();
  });

  test("keeps another user's cached key when one user is invalidated", async () => {
    await getOrLoadCachedApiKey('changed-user', 'rapidapi', async () => 'changed-old-key');
    await getOrLoadCachedApiKey('other-user', 'rapidapi', async () => 'other-key');

    invalidateCachedApiKey('changed-user', 'rapidapi');

    const changedUserLoader = vi.fn(async () => 'changed-new-key');
    await expect(
      getOrLoadCachedApiKey('changed-user', 'rapidapi', changedUserLoader)
    ).resolves.toBe('changed-new-key');
    expect(changedUserLoader).toHaveBeenCalledOnce();

    const otherUserLoader = vi.fn(async () => 'unexpected-key');
    await expect(getOrLoadCachedApiKey('other-user', 'rapidapi', otherUserLoader)).resolves.toBe(
      'other-key'
    );
    expect(otherUserLoader).not.toHaveBeenCalled();
  });
});
