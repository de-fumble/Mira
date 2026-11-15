import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js "N" bubble shown during development (it never appears in
  // production builds anyway). Build/runtime errors are still shown.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  // pdfkit reads its own data files at runtime, so load it with plain Node `require`.
  serverExternalPackages: ["pdfkit"],
  // Ship the PDF fonts with the export route when deployed.
  outputFileTracingIncludes: {
    "/api/meetings/\\[id\\]/export": ["./assets/fonts/**/*"],
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
