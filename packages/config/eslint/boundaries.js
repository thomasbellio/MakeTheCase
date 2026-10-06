import boundaries from 'eslint-plugin-boundaries';

/**
 * Architecture boundaries from AGENTS.md section 4.
 *
 *   domain       -> (zod only)
 *   analysis     -> domain, graphology
 *   persistence  -> domain, drizzle
 *   pipeline     -> domain, analysis, langgraph/langchain   (NOT persistence)
 *   worker       -> pipeline, persistence, analysis, domain (composition root)
 *   web (server) -> persistence, domain, pg-boss            (composition root)
 *   web (client) -> domain types only, via the API client
 *
 * No package may import from an `apps/*` package. The server/client split
 * inside `apps/web` is enforced as a directory boundary, which is why
 * `src/server` and `src/client` exist as separate trees.
 *
 * Cross-package dependencies are matched by module source (the package name
 * actually written in the import) rather than by resolved file path, so the
 * rules do not depend on how pnpm symlinks the workspace into node_modules.
 *
 * `pnpm lint:boundaries` asserts that these rules fire; see the
 * `__boundaries__` fixtures.
 */

/** Element types, most specific pattern first. */
const elements = [
  // apps/web is split so the server/client rule is a directory boundary.
  { type: 'web-server', pattern: 'apps/web/src/server/**/*' },
  { type: 'web-client', pattern: 'apps/web/src/client/**/*' },
  { type: 'web-app', pattern: 'apps/web/src/app/**/*' },
  // shadcn/ui output: the `cn` helper and generated components.
  { type: 'web-lib', pattern: 'apps/web/src/lib/**/*' },
  { type: 'web-ui', pattern: 'apps/web/src/components/**/*' },
  { type: 'web-root', pattern: 'apps/web/*' },

  { type: 'worker', pattern: 'apps/worker/**/*' },

  { type: 'domain', pattern: 'packages/domain/**/*' },
  { type: 'analysis', pattern: 'packages/analysis/**/*' },
  { type: 'persistence', pattern: 'packages/persistence/**/*' },
  { type: 'pipeline', pattern: 'packages/pipeline/**/*' },
  { type: 'config', pattern: 'packages/config/**/*' },
];

/** Allows relative imports within the same package. */
const self = (type) => ({ to: { element: { type } } });

/** Allows a third-party or workspace package by name. */
const pkg = (...sources) => sources.map((source) => ({ to: { module: { source } } }));

/** Packages any UI code may use: React, Next and the shadcn/ui stack. */
const UI_PACKAGES = [
  'next',
  'next/*',
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'mobx',
  'mobx-react-lite',
  '@xyflow/react',
  'elkjs',
  'elkjs/*',
  // shadcn/ui (base-nova preset)
  'shadcn',
  'shadcn/*',
  '@base-ui/react',
  '@base-ui/react/*',
  'cn',
  'clsx',
  'tailwind-merge',
  'class-variance-authority',
  'lucide-react',
  'tw-animate-css',
];

/** Node builtins and the test runner are available everywhere. */
const TOOLING = [{ to: { module: { origin: 'core' } } }, ...pkg('vitest', 'vitest/*', '@vitest/*')];

const WORKSPACE = {
  domain: '@make-your-case/domain',
  analysis: '@make-your-case/analysis',
  persistence: '@make-your-case/persistence',
  pipeline: '@make-your-case/pipeline',
};

const policies = [
  {
    // AGENTS.md section 4: domain depends on zod and nothing else.
    from: { element: { type: 'domain' } },
    allow: [self('domain'), ...TOOLING, ...pkg('zod', 'zod/*')],
  },
  {
    from: { element: { type: 'analysis' } },
    allow: [self('analysis'), ...TOOLING, ...pkg(WORKSPACE.domain, 'graphology', 'graphology-*')],
  },
  {
    from: { element: { type: 'persistence' } },
    allow: [
      self('persistence'),
      ...TOOLING,
      ...pkg(WORKSPACE.domain, 'drizzle-orm', 'drizzle-orm/*', 'pg', '@testcontainers/*'),
    ],
  },
  {
    // Deliberately excludes persistence: repositories are injected.
    from: { element: { type: 'pipeline' } },
    allow: [
      self('pipeline'),
      ...TOOLING,
      ...pkg(WORKSPACE.domain, WORKSPACE.analysis, 'zod', 'zod/*', '@langchain/*'),
    ],
  },
  {
    // Composition root.
    from: { element: { type: 'worker' } },
    allow: [
      self('worker'),
      ...TOOLING,
      ...pkg(
        WORKSPACE.domain,
        WORKSPACE.analysis,
        WORKSPACE.persistence,
        WORKSPACE.pipeline,
        'pg-boss',
      ),
    ],
  },
  {
    // Composition root for the API.
    from: { element: { type: 'web-server' } },
    allow: [
      self('web-server'),
      ...TOOLING,
      ...pkg(WORKSPACE.domain, WORKSPACE.persistence, 'pg-boss', 'next', 'next/*'),
    ],
  },
  {
    // Client code sees domain types only, via the API client.
    from: { element: { type: 'web-client' } },
    allow: [
      self('web-client'),
      self('web-lib'),
      self('web-ui'),
      ...TOOLING,
      ...pkg(WORKSPACE.domain, ...UI_PACKAGES),
    ],
  },
  {
    // App Router files compose server and client code.
    from: { element: { type: ['web-app', 'web-root'] } },
    allow: [
      self('web-app'),
      self('web-root'),
      self('web-server'),
      self('web-client'),
      self('web-lib'),
      self('web-ui'),
      ...TOOLING,
      ...pkg(WORKSPACE.domain, ...UI_PACKAGES),
    ],
  },
  {
    // Presentational building blocks: no workspace imports beyond domain types.
    from: { element: { type: ['web-ui', 'web-lib'] } },
    allow: [self('web-ui'), self('web-lib'), ...TOOLING, ...pkg(WORKSPACE.domain, ...UI_PACKAGES)],
  },
  {
    // Shared tooling presets; they legitimately import lint and test plugins.
    from: { element: { type: 'config' } },
    allow: [self('config'), ...TOOLING, ...pkg('*', '*/*')],
  },
];

export const boundariesConfig = [
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Also check external and node-core imports, which is what makes
          // "domain depends on zod only" expressible.
          checkAllOrigins: true,
          policies,
        },
      ],
    },
  },
];

export default boundariesConfig;
