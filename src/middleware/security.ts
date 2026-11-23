import { defineMiddleware } from 'astro:middleware';
import type { APIContext } from 'astro';
import crypto from 'node:crypto';

// CSP nonce generation for inline scripts (Astro islands)
const generateNonce = () => crypto.randomBytes(16).toString('base64');

// Rate limit store (in-memory for edge, use Redis/KV for production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const checkRateLimit = (ip: string, limit = 100, windowMs = 60_000): boolean => {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
};

const isSuspiciousUA = (ua: string): boolean => {
  const suspicious = [
    /sqlmap/i, /nikto/i, /nessus/i, /openvas/i, /burp/i,
    /python-requests/i, /go-http-client/i, /curl/i, /wget/i,
    /scanner/i, /bot/i, /crawler/i, /spider/i,
  ];
  return suspicious.some((pattern) => pattern.test(ua));
};

export const onRequest = defineMiddleware(async (context: APIContext, next: () => Promise<Response>) => {
  const { request, locals, url } = context;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const ua = request.headers.get('user-agent') || '';

  // Rate limiting
  if (!checkRateLimit(ip)) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': '60' },
    });
  }

  // Block suspicious user agents
  if (isSuspiciousUA(ua)) {
    return new Response('Forbidden', { status: 403 });
  }

  // CSP nonce for this request
  const nonce = generateNonce();
  locals.cspNonce = nonce;

  // Security headers
  const response = await next();

  // Clone headers to modify
  const headers = new Headers(response.headers);

  // HSTS
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // CSP - strict, nonce-based for islands
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'", // Tailwind needs unsafe-inline for JIT
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.neon.tech wss://*.neon.tech",
    "frame-src 'self' https://www.youtube.com https://player.vimeo.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  headers.set('Content-Security-Policy', csp);

  // Cross-Origin Isolation
  // COEP: credentialless for marketing routes with embeds (YouTube/Vimeo)
  // COOP: same-origin
  const isMarketingRoute = url.pathname === '/' || url.pathname.startsWith('/blog') || url.pathname.startsWith('/features');
  if (isMarketingRoute) {
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  } else {
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  // Additional security headers
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Remove server header
  headers.delete('Server');
  headers.delete('X-Powered-By');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});