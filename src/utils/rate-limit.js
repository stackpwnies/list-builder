export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function staggerDelay(workerIndex, baseMs = 1000, perWorkerMs = 250) {
  return baseMs + workerIndex * perWorkerMs;
}

export class RateLimiter {
  #maxRequests
  #windowMs
  #timestamps = []
  #pending = []

  constructor({ maxRequests = 250, windowMs = 60000 } = {}) {
    this.#maxRequests = maxRequests
    this.#windowMs = windowMs
  }

  async acquire() {
    this.#prune()
    if (this.#timestamps.length < this.#maxRequests) {
      this.#timestamps.push(Date.now())
      this.#flushPending()
      return
    }

    const waitMs = this.#timestamps[0] + this.#windowMs - Date.now() + 1
    if (waitMs > 0) {
      console.log(`  ⏳ Rate limiter: ${this.#maxRequests}req/${this.#windowMs / 1000}s cap reached, waiting ${(waitMs / 1000).toFixed(1)}s...`)
      await sleep(waitMs)
    }
    this.#prune()
    this.#timestamps.push(Date.now())
    this.#flushPending()
  }

  #prune() {
    const cutoff = Date.now() - this.#windowMs
    while (this.#timestamps.length && this.#timestamps[0] < cutoff) {
      this.#timestamps.shift()
    }
  }

  #flushPending() {
    while (this.#pending.length) {
      this.#pending.shift()()
    }
  }

  get remaining() {
    this.#prune()
    return this.#maxRequests - this.#timestamps.length
  }
}

export const tiktokRateLimiter = new RateLimiter({
  maxRequests: parseInt(process.env.RAPIDAPI_RPM || '250', 10),
})
