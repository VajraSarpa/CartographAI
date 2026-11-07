import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // the TypeScript compiler is large and loads its own lib files: keep it out of the bundle
  // tree-sitter loads its WASM files from its own package folder at runtime: keep them external too
  serverExternalPackages: ["typescript", "web-tree-sitter", "tree-sitter-python"],
  // the Ask agent and the Python plug-in ship as TypeScript source in workspace packages
  transpilePackages: ["cartograph-agent", "cartograph-lang-python"],
  // the WASM grammars are read from disk, so tell file tracing to ship them
  outputFileTracingIncludes: {
    "/**": ["./node_modules/web-tree-sitter/tree-sitter.wasm", "./node_modules/tree-sitter-python/tree-sitter-python.wasm"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
