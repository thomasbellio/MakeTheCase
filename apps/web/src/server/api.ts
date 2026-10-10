import {
  analysisRunWireSchema,
  encodeArgumentResponse,
  createDocumentResponseSchema,
  documentDetailResponseSchema,
  documentListResponseSchema,
} from '@make-your-case/domain';
import { serverResources } from './container.ts';
import {
  errorResponse,
  json,
  readJson,
  resultResponse,
  resumeSequence,
  sseResponse,
} from './http.ts';
import { log } from './logger.ts';
import {
  getDocumentArgument,
  getDocumentDetail,
  listDocuments,
  submitDocument,
} from './services/document-service.ts';
import { getRun, openRunEventStream } from './services/run-service.ts';

/**
 * One function per endpoint in AGENTS.md section 8.6. Route files under
 * `src/app/api/` only forward to these, so authentication (section 2) can be
 * added here, in one place, later.
 */

type Params = Promise<{ id: string }>;

export function postDocument(request: Request): Promise<Response> {
  return guard(async () => {
    const result = await submitDocument(serverResources(), await readJson(request));
    return resultResponse(result, createDocumentResponseSchema, 201);
  });
}

export function getDocuments(): Promise<Response> {
  return guard(async () =>
    json(documentListResponseSchema, await listDocuments(serverResources())),
  );
}

export function getDocument(params: Params): Promise<Response> {
  return guard(async () => {
    const result = await getDocumentDetail(serverResources(), (await params).id);
    return resultResponse(result, documentDetailResponseSchema);
  });
}

export function getArgument(params: Params): Promise<Response> {
  return guard(async () => {
    const result = await getDocumentArgument(serverResources(), (await params).id);
    // Not `resultResponse`: the graph is a declared interface the schema's
    // inferred type cannot express, so domain encodes it (see `contracts/api.ts`).
    return result.ok
      ? Response.json(encodeArgumentResponse(result.value))
      : errorResponse(result.error);
  });
}

export function getRunStatus(params: Params): Promise<Response> {
  return guard(async () => {
    const result = await getRun(serverResources().repositories, (await params).id);
    return resultResponse(result, analysisRunWireSchema);
  });
}

export function getRunEvents(request: Request, params: Params): Promise<Response> {
  return guard(async () => {
    const result = await openRunEventStream(
      serverResources().repositories,
      (await params).id,
      resumeSequence(request),
      { signal: request.signal },
    );
    return result.ok ? sseResponse(result.value) : errorResponse(result.error);
  });
}

/**
 * Unexpected failures become a generic 500. The detail is logged, never sent:
 * a driver error can quote SQL, and SQL can quote the document.
 */
async function guard(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    log('error', 'request failed', {
      error: (error as Error).message,
      name: (error as Error).name,
    });
    return errorResponse({ code: 'internal', message: 'Something went wrong on the server.' });
  }
}
