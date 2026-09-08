/**
 * Per-key serialisation for read-modify-write cycles.
 *
 * The Python workbench holds one process-wide `threading.RLock` around every
 * session mutation (`web.py:635`). Here the intake listener and the model's
 * tool calls interleave on one event loop, so each session needs its own
 * queue: without it, two captures that land together both read the old offer
 * list and one of them is lost.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>()

  /**
   * Run `task` with exclusive access to `key`.
   * @param key - the resource to serialise on.
   * @param task - the critical section.
   * @returns whatever the task returns.
   */
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    // Swallow the predecessor's rejection so one failure cannot poison the queue.
    const result = previous.then(task, task)
    this.tails.set(
      key,
      result.catch(() => undefined),
    )
    try {
      return await result
    } finally {
      // Drop the entry once this task is the last one queued.
      if (this.tails.get(key) === undefined) this.tails.delete(key)
    }
  }
}
