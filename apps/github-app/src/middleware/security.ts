import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../utils/logger.js';
import { SecurityUtils } from '../utils/security.js';

/**
 * Security middleware for Fastify server
 */
export class SecurityMiddleware {
  /**
   * Register security middleware with Fastify
   */
  static register(app: FastifyInstance): void {
    // Security headers
    app.addHook('onRequest', this.addSecurityHeaders);

    // CORS protection
    app.addHook('onRequest', this.handleCORS);

    // Rate limiting
    app.addHook('onRequest', this.rateLimit);

    // Request validation
    app.addHook('preValidation', this.validateRequest);

    // Error handling
    app.setErrorHandler(this.handleError);

    logger.info('Security middleware registered');
  }

  /**
   * Add security headers to all responses
   */
  private static addSecurityHeaders(
    request: FastifyRequest,
    reply: FastifyReply,
    done: () => void
  ): void {
    // Security headers
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()'
    );

    // Content Security Policy
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https://api.github.com https://api.claude.ai",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    reply.header('Content-Security-Policy', csp);

    // HSTS for HTTPS
    if (request.protocol === 'https') {
      reply.header(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }

    done();
  }

  /**
   * Handle CORS requests
   */
  private static handleCORS(
    request: FastifyRequest,
    reply: FastifyReply,
    done: () => void
  ): void {
    const origin = request.headers.origin;

    if (origin && SecurityUtils.validateOrigin(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, DELETE, OPTIONS'
      );
      reply.header(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256'
      );
      reply.header('Access-Control-Max-Age', '86400');
    }

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      reply.status(200).send();
      return;
    }

    done();
  }

  /**
   * Basic rate limiting
   */
  private static rateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
    done: () => void
  ): void {
    const clientId = request.ip || 'unknown';

    if (!SecurityUtils.checkRateLimit(clientId)) {
      reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: 60,
      });
      return;
    }

    done();
  }

  /**
   * Validate incoming requests
   */
  private static validateRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    done: () => void
  ): void {
    try {
      // Validate content length
      const contentLength = parseInt(request.headers['content-length'] || '0');
      if (contentLength > 10 * 1024 * 1024) {
        // 10MB limit
        reply.status(413).send({
          error: 'Payload Too Large',
          message: 'Request body too large',
        });
        return;
      }

      // Validate content type for POST requests
      if (request.method === 'POST') {
        const contentType = request.headers['content-type'];
        if (!contentType || !contentType.includes('application/json')) {
          reply.status(400).send({
            error: 'Bad Request',
            message: 'Invalid content type. Expected application/json',
          });
          return;
        }
      }

      // Validate GitHub webhook signature for webhook endpoints
      if (request.url.includes('/webhook')) {
        const signature = request.headers['x-hub-signature-256'] as string;
        const payload = JSON.stringify(request.body || {});
        const secret = process.env['GITHUB_WEBHOOK_SECRET'];

        if (
          !signature ||
          !secret ||
          !SecurityUtils.validateGitHubWebhook(payload, signature, secret)
        ) {
          reply.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid webhook signature',
          });
          return;
        }
      }

      done();
    } catch (error) {
      logger.error('Request validation failed:', error);
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Request validation failed',
      });
    }
  }

  /**
   * Handle errors securely
   */
  private static handleError(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply
  ): void {
    logger.error('Unhandled error:', {
      error: SecurityUtils.sanitizeError(error),
      url: request.url,
      method: request.method,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    // Don't expose internal errors to clients
    const statusCode = reply.statusCode || 500;
    const isClientError = statusCode >= 400 && statusCode < 500;

    if (isClientError) {
      reply.status(statusCode).send({
        error: error.name || 'Bad Request',
        message: SecurityUtils.sanitizeError(error),
      });
    } else {
      reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    }
  }
}
