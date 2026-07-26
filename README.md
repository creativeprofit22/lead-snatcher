# Lead Snatcher

A lightweight CRM for local business lead generation. Search businesses by type and city, score leads based on their digital presence, and manage your sales pipeline.

## Features

- **Business Search** - Find local businesses via Google Maps API
- **Lead Scoring** - Automatic scoring (0-100) based on missing website, phone, reviews, etc.
- **CRM Pipeline** - Track leads through stages: New > Contacted > Called > Proposal > Negotiating > Won/Lost
- **Contact Logging** - Record calls, emails, meetings with outcomes
- **Tags** - Organize leads with custom colored tags
- **Dashboard** - View pipeline stats, hot/cold leads, conversion rates

## Quick Start

```bash
# Run setup (handles everything!)
./scripts/setup.sh

# Start the app
npm run dev
```

Open [localhost:3000](http://localhost:3000) and login with the credentials shown after setup.

### Country default

New searches default to the United States (`us`) in the UI, API validation, and database. Existing searches keep their stored country, including Australian (`au`) rows created under the previous database default; these cannot be safely distinguished from searches where Australia was explicitly selected.

The setup script automatically:

1. Installs dependencies
2. Creates SQLite database
3. Generates all secrets
4. Creates default admin user

## Manual Setup

If you prefer to set things up manually:

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env - generate secrets with: openssl rand -base64 32

# Create data directory
mkdir -p data

# Setup database
npm run db:generate
npm run db:push

# Create your user
npm run setup:user

# Start the app
npm run dev
```

## Environment Variables

| Variable            | Required | Description                                                  |
| ------------------- | -------- | ------------------------------------------------------------ |
| `DATABASE_URL`      | Yes      | SQLite URL (`file:./data/lead-snatcher.db`)                  |
| `NEXTAUTH_SECRET`   | Yes      | Authentication encryption key                                |
| `NEXTAUTH_URL`      | Yes      | App URL (`http://localhost:3000`)                            |
| `ADMIN_SECRET`      | Yes      | Secret for `/admin` user management                          |
| `ENCRYPTION_SECRET` | Yes      | Secret used to encrypt stored API keys                       |
| `ENCRYPTION_SALT`   | Yes      | Separate salt used with `ENCRYPTION_SECRET`                  |
| `RAPIDAPI_KEY`      | No       | Fallback when a user has not saved a RapidAPI key            |
| `PAGESPEED_API_KEY` | No       | Fallback when a user has no readable saved PageSpeed API key |

Generate `ENCRYPTION_SECRET` with `openssl rand -base64 32` and generate `ENCRYPTION_SALT` separately with `openssl rand -base64 16`. Keep both values unchanged after storing API keys: changing either value makes existing encrypted API-key rows unreadable, so users must re-enter their keys in Settings.

## Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run db:push      # Push schema to database
npm run db:studio    # Open Prisma Studio (database GUI)
npm run setup:user   # Create/update user
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript checks
```

## Tech Stack

- **Framework**: Next.js 16, React 19
- **Database**: SQLite + Prisma ORM
- **Auth**: NextAuth.js v5 (credentials)
- **Styling**: TailwindCSS v4
- **UI**: Radix UI, Lucide Icons

## Troubleshooting

### Database Issues

```bash
# Reset database
rm -rf data/lead-snatcher.db
npm run db:push
npm run setup:user
```

### Port Conflicts

```bash
# Check what's using port 3000
lsof -i :3000
```

## License

MIT
