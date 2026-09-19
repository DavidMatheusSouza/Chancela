import { PERMISSIONS, PERMISSION_LABELS, TOOL_REGISTRY } from '@trustagent/shared';
import { ok } from '@/lib/http';

export const dynamic = 'force-static';

export async function GET() {
  return ok({
    tools: TOOL_REGISTRY,
    permissions: PERMISSIONS.map((code) => ({ code, label: PERMISSION_LABELS[code] })),
  });
}
