import { getArgument } from '../../../../../server/api.ts';

// TODO(security): unauthenticated in v1
export function GET(
  _request: Request,
  ctx: RouteContext<'/api/documents/[id]/argument'>,
): Promise<Response> {
  return getArgument(ctx.params);
}
