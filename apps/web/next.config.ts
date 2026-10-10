import type { NextConfig } from 'next';

// Next reads `.env` files from this app's directory only, but the repository
// keeps one `.env` at its root for every workspace (AGENTS.md section 10).
// Variables already set in the environment win, as Next's own loading does.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No root .env: configuration comes from the environment alone.
}

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source rather than built
  // `dist` output, so Next must compile them. Every workspace package this app
  // imports has to be listed here (AGENTS.md section 5).
  transpilePackages: ['@make-your-case/domain', '@make-your-case/persistence'],
};

export default nextConfig;
