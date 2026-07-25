import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';

export interface ResolvedHostAddress {
  address: string;
  family: number;
}

export type HostResolver = (
  hostname: string,
  signal?: AbortSignal
) => Promise<ReadonlyArray<ResolvedHostAddress>>;

type PublicFetcher = (
  url: URL,
  init: RequestInit,
  addresses: ReadonlyArray<ResolvedHostAddress>
) => Promise<Response>;

export interface PublicFetchDependencies {
  fetch?: PublicFetcher;
  resolve?: HostResolver;
}

interface ValidatedPublicUrl {
  url: URL;
  addresses: ReadonlyArray<ResolvedHostAddress>;
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

async function resolveHost(hostname: string) {
  return lookup(hostname, { all: true, verbatim: true });
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return (
    normalized === 'localhost' || LOCAL_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family === 6) return blockedAddresses.check(address, 'ipv6');
  return true;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

async function resolveWithSignal(
  hostname: string,
  resolve: HostResolver,
  signal?: AbortSignal
): Promise<ReadonlyArray<ResolvedHostAddress>> {
  if (!signal) return resolve(hostname);
  if (signal.aborted) throw abortReason(signal);

  let handleAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    handleAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', handleAbort, { once: true });
  });

  try {
    return await Promise.race([resolve(hostname, signal), aborted]);
  } finally {
    if (handleAbort) signal.removeEventListener('abort', handleAbort);
  }
}

async function validatePublicHttpUrl(
  rawUrl: string | URL,
  resolve: HostResolver,
  signal?: AbortSignal
): Promise<ValidatedPublicUrl> {
  const candidate = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);

  if (!['http:', 'https:'].includes(candidate.protocol)) {
    throw new Error('Website URL must use HTTP or HTTPS');
  }
  if (candidate.username || candidate.password) {
    throw new Error('Website URL credentials are not allowed');
  }

  const hostname = candidate.hostname.replace(/^\[|\]$/g, '');
  if (!hostname || isBlockedHostname(hostname)) {
    throw new Error('Website URL targets a private network');
  }

  const literalFamily = isIP(hostname);
  const resolvedAddresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveWithSignal(hostname, resolve, signal);
  const addresses = resolvedAddresses.map(({ address }) => ({
    address,
    family: isIP(address),
  }));

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error('Website URL targets a private network');
  }

  return { url: candidate, addresses };
}

export async function assertPublicHttpUrl(
  rawUrl: string | URL,
  resolve: HostResolver = resolveHost,
  signal?: AbortSignal
): Promise<URL> {
  return (await validatePublicHttpUrl(rawUrl, resolve, signal)).url;
}

function createPinnedLookup(addresses: ReadonlyArray<ResolvedHostAddress>): LookupFunction {
  return (_hostname, options, callback) => {
    const matchingAddresses = options.family
      ? addresses.filter(({ family }) => family === options.family)
      : addresses;

    if (matchingAddresses.length === 0) {
      const error = Object.assign(new Error('No validated address matches the requested family'), {
        code: 'ENOTFOUND',
      });
      callback(error, '');
      return;
    }

    if (options.all) {
      callback(null, [...matchingAddresses]);
      return;
    }

    const selected = matchingAddresses[0];
    if (!selected) {
      callback(Object.assign(new Error('No validated address available'), { code: 'ENOTFOUND' }), '');
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

async function fetchPinnedPublicUrl(
  url: URL,
  init: RequestInit,
  addresses: ReadonlyArray<ResolvedHostAddress>
): Promise<Response> {
  const dispatcher = new Agent({
    autoSelectFamily: true,
    pipelining: 0,
    connect: { lookup: createPinnedLookup(addresses) },
  });

  try {
    const response = await undiciFetch(url, {
      ...init,
      dispatcher,
      redirect: 'manual',
    } as UndiciRequestInit);

    void dispatcher.close().catch(() => dispatcher.destroy());
    return response as unknown as Response;
  } catch (error) {
    await dispatcher.destroy();
    throw error;
  }
}

export async function fetchPublicHttpUrl(
  rawUrl: string,
  init: RequestInit,
  dependencies: PublicFetchDependencies = {}
): Promise<Response> {
  const fetcher = dependencies.fetch ?? fetchPinnedPublicUrl;
  const resolve = dependencies.resolve ?? resolveHost;
  let validated = await validatePublicHttpUrl(rawUrl, resolve, init.signal ?? undefined);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await fetcher(
      validated.url,
      { ...init, redirect: 'manual' },
      validated.addresses
);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) return response;
    if (redirectCount === MAX_REDIRECTS) {
      await response.body?.cancel();
      throw new Error('Website redirected too many times');
    }

    await response.body?.cancel();
    validated = await validatePublicHttpUrl(
      new URL(location, validated.url),
      resolve,
      init.signal ?? undefined
);
  }

  throw new Error('Website redirected too many times');
}