import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { getCurrentUserId } from '@/lib/auth-utils';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function requireRouteUserId(): Promise<string> {
  const userId = await getCurrentUserId();

  if (!userId) {
    throw new HttpError('Unauthorized', 401);
  }

  return userId;
}

export async function parseRouteBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new HttpError('Invalid JSON body', 400);
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(result.error.issues[0]?.message ?? 'Invalid request body', 400);
  }

  return result.data;
}

export function routeErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
