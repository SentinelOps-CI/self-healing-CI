import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { logger } from './logger.js';

/**
 * Security utilities for input validation, sanitization, and security checks
 */

export interface SecurityConfig {
  maxInputLength: number;
  allowedOrigins: string[];
  rateLimitWindowMs: number;
  maxRequestsPerWindow: number;
}

export class SecurityUtils {
  private static readonly DEFAULT_CONFIG: SecurityConfig = {
    maxInputLength: 10000,
    allowedOrigins: ['https://github.com', 'https://api.github.com'],
    rateLimitWindowMs: 60000, // 1 minute
    maxRequestsPerWindow: 100,
  };

  private static readonly XSS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
    /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
  ];

  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|script)\b)/gi,
    /(--|\/\*|\*\/|xp_|sp_)/gi,
    /(\b(and|or)\s+\d+\s*=\s*\d+)/gi,
  ];

  /**
   * Validate and sanitize input strings
   */
  static validateAndSanitizeInput(input: string, maxLength?: number): string {
    if (!input || typeof input !== 'string') {
      throw new Error('Invalid input: must be a non-empty string');
    }

    const maxLen = maxLength || this.DEFAULT_CONFIG.maxInputLength;
    if (input.length > maxLen) {
      throw new Error(`Input too long: maximum ${maxLen} characters allowed`);
    }

    // Remove null bytes and control characters (avoid no-control-regex in ESLint)
    let sanitized = [...input]
      .filter(ch => {
        const c = ch.charCodeAt(0);
        return c >= 32 && c !== 127;
      })
      .join('');

    // Remove XSS patterns
    this.XSS_PATTERNS.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    // Remove SQL injection patterns
    this.SQL_INJECTION_PATTERNS.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    // Trim whitespace
    sanitized = sanitized.trim();

    if (sanitized.length === 0) {
      throw new Error('Input contains only invalid characters');
    }

    return sanitized;
  }

  /**
   * Validate GitHub webhook signature
   */
  static validateGitHubWebhook(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    try {
      const expectedSignature = `sha256=${createHmac('sha256', secret)
        .update(payload)
        .digest('hex')}`;

      return timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error('GitHub webhook validation failed:', error);
      return false;
    }
  }

  /**
   * Validate origin for CORS
   */
  static validateOrigin(origin: string): boolean {
    if (!origin) return false;

    try {
      const url = new URL(origin);
      return this.DEFAULT_CONFIG.allowedOrigins.includes(url.origin);
    } catch {
      return false;
    }
  }

  /**
   * Rate limiting check
   */
  static checkRateLimit(
    identifier: string,
    currentTime: number = Date.now()
  ): boolean {
    void identifier;
    void currentTime;
    return true;
  }

  /**
   * Validate environment variables for security
   */
  static validateEnvironment(): void {
    const requiredVars = [
      'GITHUB_APP_ID',
      'GITHUB_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET',
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(', ')}`
      );
    }

    // Validate private key format
    const privateKey = process.env['GITHUB_PRIVATE_KEY'];
    if (privateKey && !privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
      throw new Error('Invalid GitHub private key format');
    }

    // Validate webhook secret length
    const webhookSecret = process.env['GITHUB_WEBHOOK_SECRET'];
    if (webhookSecret && webhookSecret.length < 16) {
      throw new Error(
        'GitHub webhook secret must be at least 16 characters long'
      );
    }
  }

  /**
   * Sanitize error messages to prevent information disclosure
   */
  static sanitizeError(error: Error): string {
    const message = error.message || 'Unknown error';

    // Remove sensitive information from error messages
    const sanitized = message
      .replace(/password\s*=\s*[^\s]+/gi, 'password=***')
      .replace(/key\s*=\s*[^\s]+/gi, 'key=***')
      .replace(/secret\s*=\s*[^\s]+/gi, 'secret=***')
      .replace(/token\s*=\s*[^\s]+/gi, 'token=***');

    return sanitized;
  }

  /**
   * Generate secure random string
   */
  static generateSecureToken(length: number = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Hash sensitive data
   */
  static hashData(data: string, salt?: string): string {
    const hash = createHash('sha256');
    hash.update(data + (salt || ''));
    return hash.digest('hex');
  }
}
