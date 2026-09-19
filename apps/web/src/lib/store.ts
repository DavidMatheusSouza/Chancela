import { MemoryRepository, seed } from './memory-repository';
import type { Repository } from './repository';

// Survives Next.js hot reloads in dev, where module state is otherwise recycled.
const globalForStore = globalThis as unknown as { __trustagentRepo?: Repository };

let seeding: Promise<void> | null = null;

export async function getRepository(): Promise<Repository> {
  if (!globalForStore.__trustagentRepo) {
    globalForStore.__trustagentRepo = new MemoryRepository();
  }
  const repo = globalForStore.__trustagentRepo;
  seeding ??= seed(repo);
  await seeding;
  return repo;
}
