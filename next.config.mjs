/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "@napi-rs/canvas", "pino", "pg", "ioredis", "@electric-sql/pglite"],
  outputFileTracingIncludes: { "/api/reveal/[grantId]": ["./assets/fonts/**"] },
};
export default nextConfig;
