import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The paddle tile pyramids live under .cache (millions of small files).
  // Next's build-trace step sees the tile routes' dynamic fs reads rooted
  // there and tries to inventory the whole tree into the trace graph —
  // which OOMs the build worker's 4 GB V8 heap. Tiles are runtime data,
  // never build inputs: keep the tracer out.
  outputFileTracingExcludes: {
    '*': ['.cache/**'],
  },
  experimental: {
    esmExternals: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
