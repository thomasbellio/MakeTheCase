import { getDocuments, postDocument } from '../../../server/api.ts';

// Always rendered per request: the list changes with every submission.
export const dynamic = 'force-dynamic';

// TODO(security): unauthenticated in v1
export function GET(): Promise<Response> {
  return getDocuments();
}

// TODO(security): unauthenticated in v1
export function POST(request: Request): Promise<Response> {
  return postDocument(request);
}
