import 'server-only';
import {
  claimDueTasks,
  completeTask,
  failTask,
  reapStuckTasks,
} from '@/lib/queue';
import { handlerFor } from './index';

/**
 * One pass of the worker.
 *
 * Two rules matter here:
 *  - One bad task must never stop the other 49 (mistake 7). Every handler runs
 *    inside its own try/catch.
 *  - A handler that hangs must not hold the whole run. Each is given a deadline.
 */

/** A single task may not take longer than this. */
const TASK_TIMEOUT_MS = 60_000;

export type TaskOutcome = {
  id: string;
  type: string;
  status: 'DONE' | 'RETRY' | 'FAILED';
  attempts: number;
  retryAt?: string;
  error?: string;
  logs?: string[];
};

export type WorkerReport = {
  claimed: number;
  done: number;
  retry: number;
  failed: number;
  rescued: number;
  /** Set when the stuck-task rescue itself failed — never hidden. */
  rescueError?: string;
  durationMs: number;
  tasks: TaskOutcome[];
};

export async function runDueTasks(limit = 50): Promise<WorkerReport> {
  const startedAt = Date.now();

  // Rescue anything a dead worker left behind before claiming new work.
  let rescued = 0;
  let rescueError: string | undefined;
  try {
    rescued = await reapStuckTasks();
  } catch (error) {
    rescueError = error instanceof Error ? error.message : String(error);
    console.error('[worker] could not rescue stuck tasks', error);
  }

  const claimed = await claimDueTasks(limit);
  const outcomes: TaskOutcome[] = [];

  for (const task of claimed) {
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);

    try {
      await withTimeout(
        handlerFor(task.type)({ task, log }),
        TASK_TIMEOUT_MS,
        `task ${task.type} exceeded ${TASK_TIMEOUT_MS / 1000}s`,
      );
      await completeTask(task.id);
      outcomes.push({
        id: task.id,
        type: task.type,
        status: 'DONE',
        attempts: task.attempts,
        logs: logs.length ? logs : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[worker] ${task.type} ${task.id} failed:`, message);

      try {
        const result = await failTask(task, error);
        outcomes.push({
          id: task.id,
          type: task.type,
          status: result.status === 'FAILED' ? 'FAILED' : 'RETRY',
          attempts: task.attempts,
          retryAt: result.retryAt?.toISOString(),
          error: message,
          logs: logs.length ? logs : undefined,
        });
      } catch (bookkeepingError) {
        // Even the failure path must not throw — the remaining tasks still run.
        // The stuck-task reaper will pick this row up on a later pass.
        console.error('[worker] could not record failure', bookkeepingError);
        outcomes.push({
          id: task.id,
          type: task.type,
          status: 'FAILED',
          attempts: task.attempts,
          error: message,
        });
      }
    }
  }

  return {
    claimed: claimed.length,
    done: outcomes.filter((o) => o.status === 'DONE').length,
    retry: outcomes.filter((o) => o.status === 'RETRY').length,
    failed: outcomes.filter((o) => o.status === 'FAILED').length,
    rescued,
    ...(rescueError ? { rescueError } : {}),
    durationMs: Date.now() - startedAt,
    tasks: outcomes,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}
