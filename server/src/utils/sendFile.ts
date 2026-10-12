/**
 * Send a generated or stored file as a download. Private, never cached, and
 * never sniffed into something executable by the browser.
 */

import type { Response } from 'express';

export function sendDownload(res: Response, file: { buffer: Buffer; fileName: string; mimeType: string }, disposition: 'attachment' | 'inline' = 'attachment'): void {
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', String(file.buffer.length));
  res.setHeader('Content-Disposition', `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(file.buffer);
}
