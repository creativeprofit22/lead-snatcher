import path from 'node:path';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function resolveDatabasePath(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    // Support both "file:./data/lead-snatcher.db" (Prisma-style) and plain paths
    const stripped = dbUrl.startsWith('file:') ? dbUrl.slice(5) : dbUrl;
    // Resolve relative paths from project root
    return path.resolve(process.cwd(), stripped);
  }
  // Fallback to default location
  return path.join(process.cwd(), 'data', 'lead-snatcher.db');
}

function createPrismaClient(): PrismaClient {
  const dbPath = resolveDatabasePath();
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
