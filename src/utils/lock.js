export const sleep = ms => new Promise(r => setTimeout(r, ms));

export class WriteLock {
  #queue = [];
  #locked = false;

  async acquire() {
    if (!this.#locked) {
      this.#locked = true;
      return;
    }
    await new Promise(r => this.#queue.push(r));
  }

  release() {
    if (this.#queue.length) {
      this.#queue.shift()();
    } else {
      this.#locked = false;
    }
  }
}
