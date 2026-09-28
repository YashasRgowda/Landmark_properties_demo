import 'server-only';
import {
  claimDueTasks,
  completeTask,
  failTask,
  reapStuckTasks,
} from '@/lib/queue';
import { TASK_TIMEOUT_MS } from '@/lib/queue-policy';
import { handlerFor } from './index';

/**
 * One pass of the worker.
 *
 * Two rules matter here:
 *  - One bad task must never stop the other 49 (mistake 7). Every handler runs
 *    inside its own try/catch.
 *  - A handler that hangs must not hold the whole run. Each is given a deadline.
 */

/**
 * How long a worker run may take when the caller does not say. Just inside a
 * 60-second serverless function, with room for the response.
 */
const DEFAULT_BUDGET_MS = 54_000;

export type RunOptions = {
  /**
   * Stop starting new tasks once less than one task's worth of time is left.
   * A task the platform kills halfway leaves no error, no retry and no reply —
   * so it is far better never to start it.
   */
  budgetMs?: number;
};

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

export async function runDueTasks(limit = 50, options: RunOptions = {}): Promise<WorkerReport> {
  const startedAt = Date.now();
  const deadline = startedAt + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  // Rescue anything a dead worker left behind before claiming new work.
  let rescued = 0;
  let rescueError: string | undefined;
  try {
    rescued = await reapStuckTasks();
  } catch (error) {
    rescueError = error instanceof Error ? error.message : String(error);
    console.error('[worker] could not rescue stuck tasks', error);
  }

  const claimed: { id: string }[] = [];
  const outcomes: TaskOutcome[] = [];

  // One task at a time, highest priority first, and only while there is time
  // to finish it. Anything not started stays PENDING for the next run, rather
  // than being claimed and then stranded.
  while (claimed.length < limit && deadline - Date.now() >= TASK_TIMEOUT_MS) {
    const [task] = await claimDueTasks(1);
    if (!task) break;
    claimed.push(task);

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
