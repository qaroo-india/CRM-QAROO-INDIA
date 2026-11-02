/**
 * Structured logging.
 *
 * Production writes one JSON object per line, which hosting platforms index
 * and search natively. Development pretty-prints for humans. Tests stay silent
 * unless LOG_LEVEL is raised explicitly to debug a failure.
 *
 * Redaction is the important part: request logs must never capture session
 * cookies, bearer tokens, or passwords, because log storage is rarely as
 * tightly controlled as the database itself.
 */

import { pino, type LoggerOptions } from 'pino';
import { env, isDevelopment, isTest } from './env';

const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
];

const options: LoggerOptions = {
  level: isTest && env.LOG_LEVEL === 'info' ? 'silent' : env.LOG_LEVEL,
  base: { service: 'ims-api', env: env.NODE_ENV },
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (!isDevelopment) {
  // JSON output: emit "level":"info" rather than "level":30 so logs read
  // unaided. Skipped in development because pino-pretty expects numeric levels.
  options.formatters = { level: (label) => ({ level: label }) };
} else {
  options.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,service,env',
      singleLine: false,
    },
  };
}

export const logger = pino(options);
