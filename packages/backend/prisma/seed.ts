/**
 * Prisma seed — auto-create NextJobzBD source if not present.
 *
 * Run: npx prisma db seed
 * Or:  npx tsx prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const NEXTJOBZBD_SOURCE = {
  name: 'NextJobzBD',
  sourceType: 'nextjobzbd',
  baseUrl: 'https://nextjobz.com.bd',
  scraperVersion: '1.0.0',
  configVersion: 1,
  isEnabled: true,
  schedule: '0 */6 * * *',
  scraperConfig: {
    keywords: ['Software Engineer', 'Web Developer'],
    maxPages: 10,
  },
}

async function main() {
  const user = await prisma.user.findFirst()
  if (!user) {
    console.warn('[seed] No user found — skipping source seed')
    return
  }

  const existing = await prisma.source.findFirst({
    where: {
      userId: user.id,
      sourceType: 'nextjobzbd',
    },
  })

  if (existing) {
    console.log('[seed] NextJobzBD source already exists — skipping')
    return
  }

  await prisma.source.create({
    data: {
      userId: user.id,
      ...NEXTJOBZBD_SOURCE,
      scraperConfig: NEXTJOBZBD_SOURCE.scraperConfig as never,
    },
  })

  console.log('[seed] Created NextJobzBD source for user', user.id)
}

main()
  .catch((e) => {
    console.error('[seed] Failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
