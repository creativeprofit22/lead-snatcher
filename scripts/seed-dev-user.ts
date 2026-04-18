import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import bcrypt from 'bcrypt';

async function main() {
  const email = 'me@local.dev';
  const name = 'Matt';
  const password = 'password123';

  const dbPath = path.join(process.cwd(), 'data', 'lead-snatcher.db');
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  const prisma = new PrismaClient({ adapter });

  const hashedPassword = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });
    console.log(`Updated password for ${email}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
        createdAt: new Date(),
      },
    });
    console.log(`Created ${email}`);
  }

  await prisma.$disconnect();
}

main();
