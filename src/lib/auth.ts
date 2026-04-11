import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/db';
import { authConfig } from './auth.config';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, _request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Rate limit login attempts per email to prevent brute force.
        // We key on email (normalized) rather than IP because:
        // 1. Protects the specific account under attack
        // 2. IP can be rotated; the target email cannot
        const rateLimitKey = `auth:login:${email.toLowerCase().trim()}`;
        const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMITS.auth);
        if (!rateLimit.success) {
          // Return null (auth failure) — NextAuth shows generic "invalid credentials"
          // which doesn't leak that the account exists or is rate-limited
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) {
          return null;
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
});
