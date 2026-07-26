import { NextResponse } from 'next/server';
import {
  apiKeySettingsDeleteSuccessSchema,
  apiKeySettingsGetResponseSchema,
  apiKeySettingsPostSuccessSchema,
  type ApiKeySettingsGetResponse,
} from '@/lib/api-key-settings-contract';
import { API_KEY_SERVICES, type ApiKeyService } from '@/lib/api-key-services';
import { invalidateCachedApiKey } from '@/lib/cache';
import { decrypt, encrypt, maskApiKey } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import {
  HttpError,
  parseRouteBody,
  requireRouteValidUser,
  routeErrorResponse,
} from '@/lib/route-utils';
import { apiKeyServiceSchema, saveApiKeySchema } from '@/lib/validations';

export type { ApiKeyService } from '@/lib/api-key-services';

function parseApiKeyService(request: Request): ApiKeyService {
  const service = new URL(request.url).searchParams.get('service');

  if (!service) {
    throw new HttpError('Service is required', 400);
  }

  const result = apiKeyServiceSchema.safeParse(service);
  if (!result.success) {
    throw new HttpError('Invalid service', 400);
  }

  return result.data;
}

// GET - Fetch all API keys (masked) for current user
export async function GET() {
  try {
    const userId = await requireRouteValidUser();
    const apiKeys = await prisma.apiKey.findMany({
      where: { userId },
    });

    const response: ApiKeySettingsGetResponse = API_KEY_SERVICES.map((service) => {
      const found = apiKeys.find((apiKey) => apiKey.service === service);
      if (found) {
        try {
          const decrypted = decrypt(found.key);
          return {
            service,
            maskedKey: maskApiKey(decrypted),
            hasKey: true,
          };
        } catch {
          // Key exists but can't be decrypted (wrong encryption secret).
          // Treat it as missing so the user can enter it again.
          console.warn(`Failed to decrypt ${service} API key - encryption secret may have changed`);
          return {
            service,
            maskedKey: null,
            hasKey: false,
          };
        }
      }

      return {
        service,
        maskedKey: null,
        hasKey: false,
      };
    });

    return NextResponse.json(apiKeySettingsGetResponseSchema.parse(response));
  } catch (error) {
    console.error('Failed to fetch API keys:', error);
    return routeErrorResponse(error, 'Failed to fetch API keys');
  }
}

// POST - Save or update an API key for current user
export async function POST(request: Request) {
  try {
    const userId = await requireRouteValidUser();
    const { service, key } = await parseRouteBody(request, saveApiKeySchema);
    const encryptedKey = encrypt(key);

    await prisma.apiKey.upsert({
      where: {
        userId_service: { userId, service },
      },
      update: { key: encryptedKey },
      create: { userId, service, key: encryptedKey },
    });

    invalidateCachedApiKey(userId, service);

    return NextResponse.json(
      apiKeySettingsPostSuccessSchema.parse({
        success: true,
        service,
        maskedKey: maskApiKey(key),
      })
    );
  } catch (error) {
    console.error('Failed to save API key:', error);
    return routeErrorResponse(error, 'Failed to save API key');
  }
}

// DELETE - Remove an API key for current user
export async function DELETE(request: Request) {
  try {
    const userId = await requireRouteValidUser();
    const service = parseApiKeyService(request);
    const existing = await prisma.apiKey.findUnique({
      where: {
        userId_service: { userId, service },
      },
    });

    if (!existing) {
      throw new HttpError('API key not found', 404);
    }

    await prisma.apiKey.delete({
      where: {
        userId_service: { userId, service },
      },
    });

    invalidateCachedApiKey(userId, service);

    return NextResponse.json(apiKeySettingsDeleteSuccessSchema.parse({ success: true }));
  } catch (error) {
    console.error('Failed to delete API key:', error);
    return routeErrorResponse(error, 'Failed to delete API key');
  }
}
