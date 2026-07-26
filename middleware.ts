import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { applySecurity } from './middleware/security';
import { verifyCsrf, attachCsrfToken } from './middleware/csrf';
import { buildCsp, generateNonce } from './middleware/csp';

// Define supported locales
const locales = ['en', 'es', 'hi', 'zh', 'ja', 'fr', 'it', 'ko', 'pt', 'de'];

// Create next-intl middleware
const intlMiddleware = createMiddleware({
  locales,
  defaultLocale: 'en',
  localePrefix: 'always' // Always show locale in URL
});

const NEXTAUTH_CSRF_EXEMPT_PREFIXES = [
  '/api/auth/callback',
  '/api/auth/csrf',
  '/api/auth/error',
  '/api/auth/providers',
  '/api/auth/session',
  '/api/auth/signin',
  '/api/auth/signout',
  '/api/auth/verify-request',
];

function isCsrfExemptApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/webhooks/') ||
    // Public lead capture from a campaign landing page (app/l/[id]) — the
    // visitor is a stranger with no ForgeVid session/cookie to protect;
    // there's no ambient authority for a forged cross-site POST to abuse.
    pathname.startsWith('/api/l/') ||
    // Scheduler-invoked endpoints (external cron POSTs a Bearer CRON_SECRET;
    // no browser session exists, so double-submit CSRF can never pass and
    // isn't the right control — the shared secret is).
    pathname.startsWith('/api/cron/') ||
    NEXTAUTH_CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hostname = (request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.hostname)
    .split(':')[0]
    .toLowerCase();
  const forgevidHost = hostname === 'forgevid.com' || hostname === 'www.forgevid.com' ||
    hostname === 'localhost' || hostname.endsWith('.railway.app');
  // A verified customer hostname's root resolves server-side to its configured
  // approved campaign creative. Non-root assets and /l routes pass through.
  if (pathname === '/' && !forgevidHost) {
    return NextResponse.rewrite(new URL('/api/custom-domain', request.url));
  }

  // Skip middleware for static files, internal routes, and health checks.
  //
  // /generated, /uploads and /music are real files under public/. Without this
  // the i18n middleware 307s `/generated/x.mp4` -> `/en/generated/x.mp4`, so
  // every video byte and every thumbnail first pays for security headers, CSRF
  // and RATE LIMITING before being redirected. Media loads could be throttled
  // as if they were API calls, and a Range request for video seeking has to
  // survive a redirect it never should have seen.
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/generated/') ||
    pathname.startsWith('/uploads/') ||
    pathname.startsWith('/music/') ||
    pathname.startsWith('/videos/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname === '/api/health' ||
    pathname === '/api/monitoring/health' ||
    pathname.startsWith('/api/internal/')
  ) {
    return NextResponse.next();
  }

  // Apply security middleware first (rate limiting, security headers)
  const securityResponse = await applySecurity(request);
  if (securityResponse) {
    return securityResponse;
  }

  // Apply CSRF protection on API state-changing requests
  if (pathname.startsWith('/api/') && !isCsrfExemptApiPath(pathname)) {
    const csrfResult = await verifyCsrf(request);
    if (csrfResult) {
      return csrfResult;
    }
  }

  // A fresh nonce per request. Next reads it from the CSP header we put on the
  // REQUEST and stamps it onto its inline bootstrap scripts; without it those
  // scripts are refused and React never hydrates. See middleware/csp.ts.
  // A per-request nonce is still exposed as `x-nonce` for any future strict-CSP
  // work, but the CSP itself no longer relies on it — see middleware/csp.ts for
  // why (static prerendering can't stamp a per-request nonce onto scripts).
  const nonce = generateNonce();
  const csp = buildCsp(process.env.NODE_ENV !== 'production');
  const requestHeaders = new Headers(request.headers);
  const requestedLocale = pathname.split('/')[1];
  requestHeaders.set(
    'x-forgevid-locale',
    locales.includes(requestedLocale) ? requestedLocale : 'en',
  );
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  // Skip i18n middleware for non-localized routes (dashboard, api, auth, etc.)
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/docs') ||
    pathname.startsWith('/help') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms') ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/unauthorized') ||
    // Public share links (/v/<id>) MUST bypass i18n: the locale middleware was
    // 307ing them to /en/v/<id>, which has no route -> every shared video 404'd.
    pathname.startsWith('/v/') ||
    // Public template/sample links are implemented as unprefixed routes.
    pathname.startsWith('/samples/') ||
    // Public campaign landing pages (QR/link targets) — same reason as /v/.
    pathname.startsWith('/l/') ||
    // /pricing exists only unprefixed; skip the /en/pricing redirect hop.
    pathname.startsWith('/pricing') ||
    pathname === '/' ||
    pathname === '/en'
  ) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('Content-Security-Policy', csp);
    return await attachCsrfToken(response);
  }

  // For localized routes, apply i18n middleware. It must see the nonce-bearing
  // request headers too, or the localized pages hydrate no better than / did.
  const intlResponse = intlMiddleware(
    new NextRequest(request, { headers: requestHeaders }),
  ) as NextResponse;
  intlResponse.headers.set('Content-Security-Policy', csp);
  return await attachCsrfToken(intlResponse);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
