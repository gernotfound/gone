export type BrowserLifecycleEventName =
  | 'visible'
  | 'hidden'
  | 'focus'
  | 'blur'
  | 'online'
  | 'offline'
  | 'pageshow'
  | 'pagehide'
  | 'beforeunload';

export type BrowserLifecycleSnapshot = {
  visibility: DocumentVisibilityState;
  online: boolean;
  focused: boolean;
  started: boolean;
  dispatches: number;
  handlerFailures: number;
};

type BrowserLifecycleHandler = (snapshot: BrowserLifecycleSnapshot, event: Event) => void;

type Subscriber = {
  name: string;
  priority: number;
  order: number;
  handler: BrowserLifecycleHandler;
};

class BrowserLifecycle {
  private readonly subscribers = new Map<BrowserLifecycleEventName, Subscriber[]>();
  private started = false;
  private order = 0;
  private dispatches = 0;
  private handlerFailures = 0;

  start(): void {
    if (this.started) return;
    this.started = true;

    document.addEventListener('visibilitychange', (event) => {
      this.dispatch(document.visibilityState === 'visible' ? 'visible' : 'hidden', event);
    });
    window.addEventListener('focus', (event) => this.dispatch('focus', event), { passive: true });
    window.addEventListener('blur', (event) => this.dispatch('blur', event), { passive: true });
    window.addEventListener('online', (event) => this.dispatch('online', event), { passive: true });
    window.addEventListener('offline', (event) => this.dispatch('offline', event), { passive: true });
    window.addEventListener('pageshow', (event) => this.dispatch('pageshow', event), { passive: true });
    window.addEventListener('pagehide', (event) => this.dispatch('pagehide', event), { passive: true });
    window.addEventListener('beforeunload', (event) => this.dispatch('beforeunload', event), { once: true });

    this.publish();
  }

  subscribe(
    eventName: BrowserLifecycleEventName,
    name: string,
    handler: BrowserLifecycleHandler,
    priority = 0,
  ): () => void {
    const subscriber: Subscriber = { name, priority, order: this.order++, handler };
    const current = this.subscribers.get(eventName) ?? [];
    current.push(subscriber);
    current.sort((a, b) => b.priority - a.priority || a.order - b.order);
    this.subscribers.set(eventName, current);

    return () => {
      const list = this.subscribers.get(eventName);
      if (!list) return;
      const index = list.indexOf(subscriber);
      if (index >= 0) list.splice(index, 1);
    };
  }

  snapshot(): BrowserLifecycleSnapshot {
    return {
      visibility: document.visibilityState,
      online: navigator.onLine,
      focused: document.hasFocus(),
      started: this.started,
      dispatches: this.dispatches,
      handlerFailures: this.handlerFailures,
    };
  }

  subscriberCount(eventName?: BrowserLifecycleEventName): number {
    if (eventName) return this.subscribers.get(eventName)?.length ?? 0;
    let count = 0;
    for (const list of this.subscribers.values()) count += list.length;
    return count;
  }

  private dispatch(eventName: BrowserLifecycleEventName, event: Event): void {
    this.dispatches += 1;
    const snapshot = this.snapshot();
    const subscribers = [...(this.subscribers.get(eventName) ?? [])];
    for (const subscriber of subscribers) {
      try {
        subscriber.handler(snapshot, event);
      } catch (error) {
        this.handlerFailures += 1;
        const message = error instanceof Error ? error.message : String(error ?? 'unknown lifecycle error');
        const stack = error instanceof Error ? error.stack : undefined;
        console.error(`[browser-lifecycle] ${subscriber.name} failed during ${eventName}`, error);
        window.dispatchEvent(new CustomEvent('gone-runtime-lifecycle-error', {
          detail: { subscriber: subscriber.name, eventName, message, stack },
        }));
      }
    }
    this.publish();
  }

  private publish(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('gone-browser-lifecycle-changed', { detail: this.snapshot() }));
  }
}

export const browserLifecycle = new BrowserLifecycle();

export function startBrowserLifecycle(): void {
  browserLifecycle.start();
}

if (typeof window !== 'undefined') {
  (window as any).goneBrowserLifecycle = {
    snapshot: () => browserLifecycle.snapshot(),
    subscriberCount: (eventName?: BrowserLifecycleEventName) => browserLifecycle.subscriberCount(eventName),
  };
}
