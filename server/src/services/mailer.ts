/**
 * Outgoing email.
 *
 * EMAIL_TRANSPORT decides what "send" means, and the result always says so:
 *   smtp     -- delivered to the configured SMTP server (real email)
 *   log      -- development only: the message metadata is logged and NOTHING
 *               is sent; callers record the transport so the UI can say so
 *   disabled -- every send fails with a clear reason
 *
 * Tests replace the transport with setMailTransport() to simulate success
 * and failure without a network.
 */

import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface MailResult {
  messageId: string;
  transport: 'smtp' | 'log' | 'test';
}

export type MailTransport = (message: MailMessage) => Promise<MailResult>;

export class MailError extends Error {
  override readonly name = 'MailError';
}

function smtpTransport(): MailTransport {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return async (message) => {
    const info = await transporter.sendMail({ from: env.EMAIL_FROM, ...message });
    const rejected = (info.rejected ?? []).map(String);
    if (rejected.length > 0 && rejected.length === message.to.length) {
      throw new MailError(`The mail server rejected every recipient: ${rejected.join(', ')}`);
    }
    return { messageId: String(info.messageId ?? ''), transport: 'smtp' };
  };
}

function logTransport(): MailTransport {
  return async (message) => {
    // Recipients and subject only: report contents are confidential.
    logger.info(
      { to: message.to, subject: message.subject, attachments: message.attachments?.map((a) => `${a.filename} (${a.content.length} bytes)`) },
      'EMAIL_TRANSPORT=log: email NOT sent (development mode)',
    );
    return { messageId: `log-${Date.now()}`, transport: 'log' };
  };
}

function disabledTransport(): MailTransport {
  return async () => {
    throw new MailError('Email is disabled on this server (EMAIL_TRANSPORT=disabled).');
  };
}

let override: MailTransport | null = null;
let configured: MailTransport | null = null;

function configuredTransport(): MailTransport {
  configured ??= env.EMAIL_TRANSPORT === 'smtp' ? smtpTransport() : env.EMAIL_TRANSPORT === 'log' ? logTransport() : disabledTransport();
  return configured;
}

/** Replace the transport (tests). Pass null to restore the configured one. */
export function setMailTransport(transport: MailTransport | null): void {
  override = transport;
}

export function mailTransportName(): 'smtp' | 'log' | 'disabled' | 'test' {
  return override ? 'test' : env.EMAIL_TRANSPORT;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (message.to.length === 0) throw new MailError('No recipients');
  return await (override ?? configuredTransport())(message);
}
