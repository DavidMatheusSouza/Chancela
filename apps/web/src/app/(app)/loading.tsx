import { Skeleton } from '@/components/ui/skeleton';

/** Every screen under (app) is dynamic and hits the database, so navigation
 *  needs something to land on rather than appearing to freeze. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56 bg-raised" />
        <Skeleton className="h-4 w-80 bg-raised" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] bg-raised" />
        ))}
      </div>
      <Skeleton className="h-64 bg-raised" />
    </div>
  );
}
