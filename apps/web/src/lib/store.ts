import { MemoryRepository, seed } from './memory-repository';
import type { Repository } from './repository';

/**
 * Which storage backend is in play.
 *
 * `DATABASE_URL` set means Postgres; absent means memory. The fallback is not a
 * convenience -- it is what keeps `pnpm dev` and the whole CI suite runnable
 * with no infrastructure, which is why the security tests are cheap enough to
 * run on every push.
 *
 * Prisma is imported lazily so that a build without a generated client, or a
 * deployment that never sets DATABASE_URL, does not pay for it or fail on it.
 */

const globalForStore = globalThis as unknown as {
  __chancelaRepo?: Repository;
  __chancelaSeeding?: Promise<void>;
};

async function build(): Promise<Repository> {
  if (!process.env.DATABASE_URL) return new MemoryRepository();

  const [{ PrismaClient }, { PrismaRepository }] = await Promise.all([
    import('@prisma/client'),
    import('./prisma-repository'),
  ]);
  return new PrismaRepository(new PrismaClient());
}

export async function getRepository(): Promise<Repository> {
  if (!globalForStore.__chancelaRepo) {
    globalForStore.__chancelaRepo = await build();
  }
  const repo = globalForStore.__chancelaRepo;

  // Seeding is idempotent -- `seed()` returns early when agents already exist,
  // so a Postgres instance that survived a restart is not re-seeded.
  globalForStore.__chancelaSeeding ??= seed(repo);
  await globalForStore.__chancelaSeeding;

  return repo;
}

/** True when decisions survive a restart. Surfaced by /api/health. */
export function isDurable(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
