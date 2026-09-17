import type { Task } from '@/lib/db/schema';

export type TaskContext = {
  task: Task;
  /** Collected into the worker's report. Never log buyer phone numbers here. */
  log: (message: string) => void;
};

export type TaskHandler = (ctx: TaskContext) => Promise<void>;
