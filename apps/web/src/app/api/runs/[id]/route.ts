import { getRunStatus } from '../../../../server/api.ts';

// TODO(security): unauthenticated in v1
export function GET(_request: Request, ctx: RouteContext<'/api/runs/[id]'>): Promise<Response> {
  return getRunStatus(ctx.params);
}
