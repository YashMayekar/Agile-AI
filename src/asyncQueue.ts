/* src/asyncQueue.ts
   Simple FIFO async queue for serializing operations
*/

/** Simple FIFO async queue */
export class AsyncQueue {
  private queue: (() => Promise<void>)[] = [];
  private running = false;

  add(task: () => Promise<void>) {
    this.queue.push(task);
    if (!this.running) this.run();
  }

  private async run() {
    this.running = true;
    while (this.queue.length) {
      const t = this.queue.shift()!;
      try {
        await t();
      } catch (e) {
        console.error('Task error', e);
      }
    }
    this.running = false;
  }
}