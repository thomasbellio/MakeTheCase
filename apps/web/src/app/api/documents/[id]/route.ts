import { getDocument } from '../../../../server/api.ts';

// TODO(security): unauthenticated in v1
export function GET(
  _request: Request,
  ctx: RouteContext<'/api/documents/[id]'>,
): Promise<Response> {
  return getDocument(ctx.params);
}
