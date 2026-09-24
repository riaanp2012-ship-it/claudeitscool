/** Fixed-capacity object pool. `acquire` returns null when exhausted so callers can degrade gracefully. */
export class Pool<T> {
  private readonly free: T[] = [];
  readonly items: T[] = [];

  constructor(
    readonly capacity: number,
    factory: (index: number) => T,
  ) {
    for (let i = 0; i < capacity; i++) {
      const item = factory(i);
      this.items.push(item);
      this.free.push(item);
    }
  }

  acquire(): T | null {
    return this.free.pop() ?? null;
  }

  release(item: T): void {
    if (this.free.length < this.capacity && !this.free.includes(item)) this.free.push(item);
  }

  get available(): number {
    return this.free.length;
  }

  get inUse(): number {
    return this.capacity - this.free.length;
  }
}
