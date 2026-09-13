export type RuntimePhase =
  | 'foundation'
  | 'bootstrap'
  | 'gameplay'
  | 'network'
  | 'presentation'
  | 'device';

export type RuntimeModuleState = 'registered' | 'starting' | 'ready' | 'failed' | 'blocked';

export type RuntimeModuleDefinition = {
  name: string;
  phase: RuntimePhase;
  critical?: boolean;
  dependsOn?: readonly string[];
  start: () => void;
  reconcile?: () => void;
};

type RuntimeModuleRecord = {
  definition: RuntimeModuleDefinition;
  state: RuntimeModuleState;
  order: number;
  attempts: number;
  reconciliations: number;
  reconcileFailures: number;
  startedAt: number | null;
  lastError: string | null;
};

export type RuntimeModuleHealth = {
  name: string;
  phase: RuntimePhase;
  critical: boolean;
  dependsOn: string[];
  state: RuntimeModuleState;
  attempts: number;
  reconciliations: number;
  reconcileFailures: number;
  startedAt: number | null;
  lastError: string | null;
};

export type RuntimeHealthSnapshot = {
  status: 'booting' | 'healthy' | 'degraded' | 'failed';
  ready: number;
  failed: number;
  blocked: number;
  registered: number;
  modules: RuntimeModuleHealth[];
};

const PHASE_ORDER: RuntimePhase[] = [
  'foundation',
  'bootstrap',
  'gameplay',
  'network',
  'presentation',
  'device',
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown runtime error');
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

class RuntimeKernel {
  private readonly records = new Map<string, RuntimeModuleRecord>();
  private nextOrder = 0;

  register(definition: RuntimeModuleDefinition): void {
    const current = this.records.get(definition.name);
    if (current) {
      if (
        current.definition.phase !== definition.phase ||
        Boolean(current.definition.critical) !== Boolean(definition.critical)
      ) {
        throw new Error(`Runtime module ${definition.name} was registered with conflicting metadata`);
      }
      return;
    }

    this.records.set(definition.name, {
      definition: {
        ...definition,
        dependsOn: [...(definition.dependsOn ?? [])],
      },
      state: 'registered',
      order: this.nextOrder++,
      attempts: 0,
      reconciliations: 0,
      reconcileFailures: 0,
      startedAt: null,
      lastError: null,
    });
  }

  registerMany(definitions: readonly RuntimeModuleDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  isReady(name: string): boolean {
    return this.records.get(name)?.state === 'ready';
  }

  start(name: string, stack: readonly string[] = []): boolean {
    const record = this.records.get(name);
    if (!record) {
      this.emitFailure(name, 'foundation', false, 'dependency', new Error(`Unregistered runtime module: ${name}`));
      return false;
    }
    if (record.state === 'ready') return true;
    if (record.state === 'failed' || record.state === 'blocked') return false;
    if (record.state === 'starting' || stack.includes(name)) {
      return this.block(record, `Runtime dependency cycle: ${[...stack, name].join(' -> ')}`);
    }

    record.state = 'starting';
    const dependencyStack = [...stack, name];
    for (const dependency of record.definition.dependsOn ?? []) {
      if (!this.records.has(dependency)) {
        return this.block(record, `Missing runtime dependency: ${dependency}`);
      }
      if (!this.start(dependency, dependencyStack)) {
        return this.block(record, `Runtime dependency unavailable: ${dependency}`);
      }
    }

    record.attempts += 1;
    try {
      record.definition.start();
      record.state = 'ready';
      record.startedAt = Date.now();
      record.lastError = null;
      this.publishHealth();
      return true;
    } catch (error) {
      record.state = 'failed';
      record.lastError = errorText(error);
      this.emitFailure(
        record.definition.name,
        record.definition.phase,
        Boolean(record.definition.critical),
        'start',
        error,
      );
      this.publishHealth();
      return false;
    }
  }

  startPhase(phase: RuntimePhase): void {
    const records = [...this.records.values()]
      .filter((record) => record.definition.phase === phase)
      .sort((a, b) => a.order - b.order);
    for (const record of records) this.start(record.definition.name);
  }

  startPhases(phases: readonly RuntimePhase[]): void {
    for (const phase of phases) this.startPhase(phase);
  }

  reconcile(name: string): boolean {
    const record = this.records.get(name);
    if (!record) return false;
    if (record.state !== 'ready' && !this.start(name)) return false;
    if (!record.definition.reconcile) return true;

    record.reconciliations += 1;
    try {
      record.definition.reconcile();
      record.lastError = null;
      this.publishHealth();
      return true;
    } catch (error) {
      record.reconcileFailures += 1;
      record.lastError = errorText(error);
      this.emitFailure(
        record.definition.name,
        record.definition.phase,
        Boolean(record.definition.critical),
        'reconcile',
        error,
      );
      this.publishHealth();
      return false;
    }
  }

  reconcilePhase(phase: RuntimePhase): void {
    const records = [...this.records.values()]
      .filter((record) => record.definition.phase === phase && record.definition.reconcile)
      .sort((a, b) => a.order - b.order);
    for (const record of records) this.reconcile(record.definition.name);
  }

  snapshot(): RuntimeHealthSnapshot {
    const modules = [...this.records.values()]
      .sort((a, b) => {
        const phaseDelta = PHASE_ORDER.indexOf(a.definition.phase) - PHASE_ORDER.indexOf(b.definition.phase);
        return phaseDelta || a.order - b.order;
      })
      .map<RuntimeModuleHealth>((record) => ({
        name: record.definition.name,
        phase: record.definition.phase,
        critical: Boolean(record.definition.critical),
        dependsOn: [...(record.definition.dependsOn ?? [])],
        state: record.state,
        attempts: record.attempts,
        reconciliations: record.reconciliations,
        reconcileFailures: record.reconcileFailures,
        startedAt: record.startedAt,
        lastError: record.lastError,
      }));

    const failed = modules.filter((module) => module.state === 'failed').length;
    const blocked = modules.filter((module) => module.state === 'blocked').length;
    const ready = modules.filter((module) => module.state === 'ready').length;
    const registered = modules.filter((module) => module.state === 'registered' || module.state === 'starting').length;
    const criticalFailure = modules.some(
      (module) => module.critical && (module.state === 'failed' || module.state === 'blocked'),
    );
    const degraded = failed > 0 || blocked > 0 || modules.some((module) => module.reconcileFailures > 0);
    const status = criticalFailure ? 'failed' : degraded ? 'degraded' : registered > 0 ? 'booting' : 'healthy';

    return { status, ready, failed, blocked, registered, modules };
  }

  private block(record: RuntimeModuleRecord, message: string): false {
    record.state = 'blocked';
    record.lastError = message;
    this.emitFailure(
      record.definition.name,
      record.definition.phase,
      Boolean(record.definition.critical),
      'dependency',
      new Error(message),
    );
    this.publishHealth();
    return false;
  }

  private emitFailure(
    name: string,
    phase: RuntimePhase,
    critical: boolean,
    operation: 'start' | 'reconcile' | 'dependency',
    error: unknown,
  ): void {
    console.error(`[runtime-kernel] ${operation} failed for ${name}`, error);
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('gone-runtime-start-error', {
      detail: {
        name,
        phase,
        critical,
        operation,
        message: errorText(error),
        stack: errorStack(error),
      },
    }));
  }

  private publishHealth(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('gone-runtime-health-changed', { detail: this.snapshot() }));
  }
}

export const runtimeKernel = new RuntimeKernel();

if (typeof window !== 'undefined') {
  (window as any).goneRuntimeHealth = {
    snapshot: () => runtimeKernel.snapshot(),
    isReady: (name: string) => runtimeKernel.isReady(name),
    reconcile: (name: string) => runtimeKernel.reconcile(name),
  };
}
