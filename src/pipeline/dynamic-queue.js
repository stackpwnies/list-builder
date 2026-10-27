export class DynamicQueue {
  #queue = []
  #waiting = []
  #finished = false
  #metrics = { pushed: 0, popped: 0, peakSize: 0 }

  async push(item) {
    this.#queue.push(item)
    this.#metrics.pushed++
    this.#metrics.peakSize = Math.max(this.#metrics.peakSize, this.#queue.length)
    this.#notify()
  }

  pushMany(items) {
    for (const item of items) {
      this.#queue.push(item)
      this.#metrics.pushed++
    }
    this.#metrics.peakSize = Math.max(this.#metrics.peakSize, this.#queue.length)
    const count = items.length
    for (let i = 0; i < count; i++) this.#notify()
  }

  async pop(timeoutMs = 30000) {
    if (this.#queue.length > 0) {
      const item = this.#queue.shift()
      this.#metrics.popped++
      return item
    }
    if (this.#finished) return null

    return new Promise((resolve) => {
      let timer = null
      const entry = () => {
        if (timer) clearTimeout(timer)
        if (this.#queue.length > 0) {
          const item = this.#queue.shift()
          this.#metrics.popped++
          resolve(item)
        } else {
          resolve(null)
        }
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this.#waiting.indexOf(entry)
          if (idx !== -1) this.#waiting.splice(idx, 1)
          resolve(null)
        }, timeoutMs)
      }

      this.#waiting.push(entry)
      this.#notify()
    })
  }

  finish() {
    this.#finished = true
    while (this.#waiting.length) this.#waiting.shift()()
  }

  get size() {
    return this.#queue.length
  }

  get finished() {
    return this.#finished
  }

  getMetrics() {
    return { ...this.#metrics, currentSize: this.#queue.length }
  }

  #notify() {
    if (this.#waiting.length && this.#queue.length > 0) {
      this.#waiting.shift()()
    }
  }
}
