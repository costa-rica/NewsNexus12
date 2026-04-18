/**
 * SECURITY EVENT LOGGING UTILITY
 *
 * PURPOSE: Detect and log security-related events for monitoring and incident response
 *
 * SECURITY CONTEXT:
 * During the December 2025 security breach, the application had no logging of
 * attack attempts. This made it impossible to:
 * - Detect attacks in real-time
 * - Identify attacker IPs for blocking
 * - Understand attack patterns
 * - Respond quickly to ongoing threats
 *
 * This logger provides visibility into attack attempts while the primary defenses
 * (validation, sanitization, framework updates) prevent the attacks from succeeding.
 *
 * DEFENSE-IN-DEPTH ROLE:
 * - Primary defense: Input validation (prevents attacks)
 * - Secondary defense: Logging (detects attempts)
 * - Together: Prevention + Detection = Comprehensive security
 *
 * IMPORTANT SECURITY NOTES:
 * - NEVER log passwords, tokens, or secrets
 * - NEVER log complete request bodies (may contain PII)
 * - DO log validation failures and suspicious patterns
 * - DO log client IP addresses for blocking
 *
 * REFERENCE: docs/security-measures20251213/Security_Measures_01_Logging.md
 *
 * @see https://nextjs.org/docs/app/api-reference/functions/headers
 */

/**
 * Security event severity levels
 * - LOW: Minor validation failures, normal user errors
 * - MEDIUM: Suspicious patterns, repeated failures
 * - HIGH: Clear attack patterns, injection attempts
 * - CRITICAL: Successful exploitation attempts (should never occur if defenses work)
 */
export type SecuritySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Security event types for categorization
 */
export type SecurityEventType =
  | "INVALID_INPUT" // Failed validation (email format, password strength)
  | "SUSPICIOUS_PATTERN" // Input contains attack patterns (SQL, XSS, command injection)
  | "RATE_LIMIT_EXCEEDED" // Too many requests from same IP
  | "AUTHENTICATION_FAILURE" // Failed login attempt
  | "INVALID_TOKEN" // Invalid or expired reset token
  | "MALFORMED_REQUEST"; // Invalid request structure

/**
 * Structure of a security event log entry
 */
interface SecurityEvent {
  timestamp: string;
  app: string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  message: string;
  ip?: string;
  userAgent?: string;
  endpoint?: string;
  details?: Record<string, unknown>;
}

/**
 * Logs a security event to stdout
 *
 * SECURITY: This function is safe to call from client components because:
 * - Client-side calls only log to browser console (not server logs)
 * - Sensitive data detection prevents logging secrets
 * - IP addresses can only be captured server-side
 *
 * For server-side logging (Server Actions, API routes), pass IP from headers.
 * For client-side logging, IP will be marked as 'client-side' (not available).
 *
 * @param event - Security event to log
 *
 * @example
 * // Client-side usage (auth forms)
 * logSecurityEvent({
 *   type: 'INVALID_INPUT',
 *   severity: 'MEDIUM',
 *   message: 'Email validation failed',
 *   endpoint: '/users/login',
 *   details: { field: 'email', error: 'Invalid format' }
 * });
 *
 * @example
 * // Server-side usage (Server Actions)
 * const ip = headers().get('x-forwarded-for') || 'unknown';
 * logSecurityEvent({
 *   type: 'AUTHENTICATION_FAILURE',
 *   severity: 'HIGH',
 *   message: 'Login attempt with invalid credentials',
 *   ip,
 *   endpoint: '/users/login'
 * });
 */
export function logSecurityEvent(
  event: Omit<SecurityEvent, "timestamp" | "app">,
): void {
  // SECURITY: Detect and prevent logging of sensitive data
  const sanitizedDetails = sanitizeLogDetails(event.details);

  const logEntry: SecurityEvent = {
    timestamp: new Date().toISOString(),
    app: "NewsNexus12Portal",
    ...event,
    // Mark IP as client-side if not provided (can't get real IP from client)
    ip: event.ip || "client-side",
    details: sanitizedDetails,
  };

  // SECURITY: Use console.warn for security events
  // This makes them easy to filter: logs NewsNexus12Portal | grep SECURITY
  console.warn("[SECURITY]", JSON.stringify(logEntry));

  // OPTIONAL: In production, also send critical events to monitoring service
  // if (process.env.NODE_ENV === 'production' && event.severity === 'CRITICAL') {
  //   sendToMonitoring(logEntry);
  // }
}

/**
 * Sanitizes log details to prevent logging sensitive information
 *
 * SECURITY: Removes common sensitive field names to prevent accidental logging
 * of passwords, tokens, credit cards, etc.
 *
 * @param details - Raw details object
 * @returns Sanitized details with sensitive fields redacted
 */
function sanitizeLogDetails(
  details?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!details) return undefined;

  const sensitiveFields = [
    "password",
    "newPassword",
    "oldPassword",
    "token",
    "resetToken",
    "accessToken",
    "refreshToken",
    "secret",
    "apiKey",
    "creditCard",
    "ssn",
    "cvv",
  ];

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    // Check if field name contains sensitive keywords (case-insensitive)
    const isSensitive = sensitiveFields.some((field) =>
      key.toLowerCase().includes(field.toLowerCase()),
    );

    if (isSensitive) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Helper function to determine severity based on validation error type
 *
 * Used to automatically assign severity levels based on the type of validation failure.
 *
 * @param errorMessage - Validation error message
 * @returns Recommended severity level
 */
export function getValidationSeverity(errorMessage: string): SecuritySeverity {
  const message = errorMessage.toLowerCase();

  // HIGH severity: Clear attack patterns
  if (
    message.includes("invalid characters") ||
    message.includes("contains invalid") ||
    message.includes("too long")
  ) {
    return "HIGH";
  }

  // MEDIUM severity: Suspicious but could be user error
  if (message.includes("format") || message.includes("invalid")) {
    return "MEDIUM";
  }

  // LOW severity: Simple validation failures
  return "LOW";
}

/**
 * Helper to detect if user agent looks like an automated tool/bot
 *
 * @param userAgent - User agent string from request headers
 * @returns true if appears to be automated, false otherwise
 */
export function isAutomatedUserAgent(userAgent?: string): boolean {
  if (!userAgent) return false;

  const automatedPatterns = [
    "curl",
    "wget",
    "python-requests",
    "postman",
    "insomnia",
    "bot",
    "crawler",
    "spider",
    "scraper",
  ];

  return automatedPatterns.some((pattern) =>
    userAgent.toLowerCase().includes(pattern),
  );
}
