import path from 'node:path';
import crypto from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';

// Use absolute path to database
const dbPath = path.join(process.cwd(), 'data', 'lead-snatcher.db');
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

function generateSecurePassword(): string {
  // 24 chars, base64 — guaranteed uppercase, lowercase, digits
  return crypto.randomBytes(18).toString('base64');
}

async function main() {
  // eslint-disable-next-line no-console
  console.info('Seeding database...');

  // Create default admin user with a random password
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@leadsnatcher.local';
  const adminPassword = process.env.ADMIN_PASSWORD || generateSecurePassword();

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    // eslint-disable-next-line no-console
    console.info('Admin user already exists, skipping...');
  } else {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        name: 'Admin',
        inviteToken: null,
        createdAt: new Date(),
      },
    });

    // eslint-disable-next-line no-console
    console.info(`Created admin user: ${adminEmail}`);
    // eslint-disable-next-line no-console
    console.info(`Generated password: ${adminPassword}`);
    // eslint-disable-next-line no-console
    console.info('⚠ CHANGE THIS PASSWORD IMMEDIATELY after first login.');
  }

  // eslint-disable-next-line no-console
  console.info('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
