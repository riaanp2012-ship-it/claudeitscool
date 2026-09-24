/** Minimal typed event bus. Handlers are stored in arrays; emitting does not allocate. */
export class EventBus<Events extends { [K in keyof Events]: unknown }> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(handler);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): void {
    const list = this.handlers[type];
    if (!list) return;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i]!(payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
