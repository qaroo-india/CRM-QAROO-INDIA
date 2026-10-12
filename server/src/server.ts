/**
 * Process entry point: start listening and shut down cleanly.
 *
 * Graceful shutdown matters more than usual with SQLite: closing the database
 * checkpoints the write-ahead log into the main file, so a redeploy never
 * leaves recent payments sitting only in the -wal sidecar file.
 */

import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeDatabase, databaseLocation, sqlite } from './db';
import { getMigrationStatus } from './db/migrator';
import { startBackgroundJobs } from './jobs';

const SHUTDOWN_TIMEOUT_MS = 10_000;
let stopJobs: () => void = () => {};

function warnOnPendingMigrations(): void {
  const status = getMigrationStatus(sqlite);
  if (status.pending.length > 0 || status.applied === 0) {
    logger.warn(
      { pending: status.pending },
      'Database schema is not up to date. Run "npm run db:migrate" before using the app.',
    );
  }
}

function start(): Server {
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        url: `http://${env.HOST}:${env.PORT}/api/v1`,
        environment: env.NODE_ENV,
        database: databaseLocation,
        allowedOrigins: env.CLIENT_URL,
      },
      'API server listening',
    );
    warnOnPendingMigrations();
    stopJobs = startBackgroundJobs();
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal(`Port ${env.PORT} is already in use. Stop the other process or change PORT in server/.env.`);
    } else {
      logger.fatal({ err: error }, 'HTTP server failed');
    }
    closeDatabase();
    process.exit(1);
  });

  return server;
}

const server = start();
let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down: refusing new connections');
  stopJobs();

  // If open connections refuse to drain, exit anyway rather than hang a deploy.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    closeDatabase();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((error) => {
    closeDatabase();
    if (error) {
      logger.error({ err: error }, 'Error while closing HTTP server');
      process.exit(1);
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });
  // Let idle keep-alive sockets go immediately so close() can complete.
  server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// A promise rejection nobody handled means program state is unknown. For a
// system that records money, crashing loudly beats continuing silently.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  closeDatabase();
  process.exit(1);
});
