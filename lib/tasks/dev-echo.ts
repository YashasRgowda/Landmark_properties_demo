import 'server-only';
import type { TaskHandler } from './types';

/**
 * Test-only handler. Exists so the queue itself can be exercised before any
 * real work (WhatsApp, AI) is built. Never enqueued by business logic.
 *
 * payload.fail = true makes it throw, which is how the retry path is tested.
 */
export const devEcho: TaskHandler = async ({ task, log }) => {
  const payload = (task.payload ?? {}) as { message?: string; fail?: boolean };

  if (payload.fail) {
    throw new Error(payload.message || 'DEV_ECHO was asked to fail');
  }

  log(`echo: ${payload.message ?? '(no message)'}`);
};
