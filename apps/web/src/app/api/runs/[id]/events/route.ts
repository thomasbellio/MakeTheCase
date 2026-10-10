import { getRunEvents } from '../../../../../server/api.ts';

// TODO(security): unauthenticated in v1
export function GET(
  request: Request,
  ctx: RouteContext<'/api/runs/[id]/events'>,
): Promise<Response> {
  return getRunEvents(request, ctx.params);
}
