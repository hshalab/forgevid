

import createNextIntlPlugin from 'next-intl/plugin';
import createBundleAnalyzer from '@next/bundle-analyzer';
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');
const withBundleAnalyzer = createBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });
const backendApiOrigin = process.env.BACKEND_API_ORIGIN?.replace(/\/$/, '');
const collaborationUrl = process.env.NEXT_PUBLIC_COLLABORATION_URL?.replace(/\/$/, '');
const collaborationWsUrl = collaborationUrl?.replace(/^http/, 'ws');

function buildExternalRewrites() {
  if (!backendApiOrigin) {
    return [];
  }

  return [
    { source: '/api/ai', destination: `${backendApiOrigin}/api/ai` },
    { source: '/api/ai/:path*', destination: `${backendApiOrigin}/api/ai/:path*` },
    { source: '/api/editor/:path*', destination: `${backendApiOrigin}/api/editor/:path*` },
    { source: '/api/videos/upload/:path*', destination: `${backendApiOrigin}/api/videos/upload/:path*` },
    { source: '/api/media/:path*', destination: `${backendApiOrigin}/api/media/:path*` },
    { source: '/generated/:path*', destination: `${backendApiOrigin}/generated/:path*` },
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Emit a self-contained server bundle (.next/standalone) so the Docker runtime
  // stage can `COPY .next/standalone` and run `node server.js` without node_modules.
  // Required by the Dockerfile; do NOT remove.
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  experimental: {
    optimizeCss: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Externalize ffmpeg packages to avoid webpack bundling issues
      config.externals = config.externals || [];
      // ffmpeg-static MUST be external. Bundled, its `path.join(__dirname, ...)`
      // resolves to a webpack-mangled directory, the binary check fails, and
      // lib/ffmpeg-env silently falls through to @ffmpeg-installer's 2018 build
      // — which has neither `xfade` (4.3) nor `adelay:all` (4.2). Every render
      // the web app produced therefore had HARD CUTS instead of the cross-fades
      // it was asked for, while the test suites (plain node, correct resolution)
      // used the modern 6.1.1 binary and passed.
      config.externals.push('ffmpeg-static', 'fluent-ffmpeg', '@ffmpeg-installer/ffmpeg', '@ffmpeg/ffmpeg', '@ffmpeg/util');
    }
    return config;
  },
  async rewrites() {
    // Serve public assets even when a locale prefix is present — but ONLY real
    // files. The old rule (`/:locale/:file*`) matched EVERY locale-prefixed
    // path and, because array rewrites run before dynamic routes, it hijacked
    // the whole app/[locale] tree: /es, /es/collaborate, ... all 404'd. Assets
    // always contain a dot (extension); page routes never do, so the regex
    // constraint keeps assets working without shadowing localized pages.
    return [
      { source: '/:locale(en|es|hi|zh|ja|fr|it|ko|pt|de)/:file(.*\\..*)', destination: '/:file' },
      ...buildExternalRewrites(),
    ]
  },
  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';

    /*
     * `immutable` is a promise that a URL's bytes will NEVER change, so the
     * browser may keep them for a year without ever revalidating.
     *
     * In a production build that promise holds: chunk filenames carry a content
     * hash. In DEVELOPMENT they do not — the chunk is plainly
     * `/_next/static/chunks/app/page.js` — so this header told every browser to
     * cache a snapshot of the app's code for a YEAR. Edit a component, and the
     * server sends fresh HTML while the browser replays year-old JavaScript:
     *
     *     Hydration failed because the initial UI does not match
     *     what was rendered on the server
     *
     * and no ordinary reload fixes it, because `immutable` suppresses even the
     * revalidation request. Cache aggressively in production; never in dev.
     */
    const staticCache = isDev
      ? 'no-store, must-revalidate'
      : 'public, max-age=31536000, immutable';
    const mediaCache = isDev
      ? 'no-cache'
      : 'public, max-age=86400, stale-while-revalidate=604800';

    return [
      {
        source: '/(.*)',
        headers: [
          // CSP is set per-request in middleware/csp.ts: it needs a nonce for
          // Next's inline bootstrap scripts, and a static header cannot carry one.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
        ]
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
        ],
      },
      // CDN cache headers for static assets
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: staticCache },
        ],
      },
      {
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: mediaCache },
        ],
      },
      {
        source: '/videos/:path*',
        headers: [
          { key: 'Cache-Control', value: mediaCache },
        ],
      },
    ];
  },
};

export default withBundleAnalyzer(withNextIntl(nextConfig));
