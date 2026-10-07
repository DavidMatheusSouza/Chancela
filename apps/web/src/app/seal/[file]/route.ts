import { sealResponse } from '@/lib/seal';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, props: { params: Promise<{ file: string }> }) {
  return sealResponse(request, (await props.params).file);
}
