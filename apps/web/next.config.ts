import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source rather than built
  // `dist` output, so Next must compile them. Every workspace package this app
  // imports has to be listed here (AGENTS.md section 5).
  transpilePackages: ['@make-your-case/domain', '@make-your-case/persistence'],
};

export default nextConfig;
