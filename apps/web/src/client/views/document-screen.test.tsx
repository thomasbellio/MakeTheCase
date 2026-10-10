// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FakeApiClient } from '../api/testing/fake-api-client';
import { sampleArgument } from '../testing/sample-argument';
import { DocumentScreen } from './document-screen';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(() => {
  // React Flow measures its container; jsdom has no layout.
  const noop = (): void => undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = noop;
      unobserve = noop;
      disconnect = noop;
    },
  );
});

afterEach(cleanup);

describe('DocumentScreen', () => {
  // Next runs React Strict Mode in development, which mounts, cleans up and
  // mounts again. The page used to stay on its loading skeleton.
  it('shows a completed analysis under Strict Mode', async () => {
    const sample = sampleArgument();
    const api = new FakeApiClient();
    api.details.set(sample.document.id, {
      ok: true,
      value: { document: sample.document, spans: sample.spans, latestRun: sample.run },
    });
    api.arguments.set(sample.document.id, { ok: true, value: sample.graph });

    render(
      <StrictMode>
        <DocumentScreen documentId={sample.document.id} api={api} />
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', { name: 'Argument map' })).toBeDefined();
    expect(screen.getByRole('heading', { name: /^Findings/ })).toBeDefined();
  });
});
