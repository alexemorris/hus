/**
 * Minimal multi-listener event emitter.
 *
 * `add` returns an unsubscribe function. `setSlot` keeps backwards
 * compatibility with legacy single-setter APIs (`setOnX(cb | null)`): the slot
 * is one extra listener that is replaced on every call.
 */
export class Emitter<TArgs extends readonly unknown[]> {
  private readonly listeners = new Set<(...args: TArgs) => void>();
  private slot: ((...args: TArgs) => void) | null = null;

  public add(listener: (...args: TArgs) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setSlot(listener: ((...args: TArgs) => void) | null): void {
    this.slot = listener;
  }

  public hasListeners(): boolean {
    return this.slot !== null || this.listeners.size > 0;
  }

  public emit(...args: TArgs): void {
    this.slot?.(...args);
    for (const listener of [...this.listeners]) listener(...args);
  }
}
