import { agentCardResponse } from '@/lib/agent-card';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, props: { params: Promise<{ file: string }> }) {
  return agentCardResponse(request, (await props.params).file);
}
