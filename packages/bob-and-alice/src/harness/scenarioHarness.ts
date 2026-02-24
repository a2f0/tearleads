import type { WithRealDatabaseOptions } from '@tearleads/db-test-utils';
import { ActorHarness, type ActorHarnessConfig } from './actorHarness.js';
import { ServerHarness } from './serverHarness.js';

export interface ScenarioActorDefinition {
  alias: string;
  userId?: string;
  clientId?: string;
  databaseOptions?: WithRealDatabaseOptions;
}

export interface ScenarioHarnessConfig {
  actors: ScenarioActorDefinition[];
  databaseOptions?: WithRealDatabaseOptions;
  timestampBaseIso?: string;
  timestampStrideMs?: number;
}

export class ScenarioHarness {
  readonly server: ServerHarness;
  private readonly actorMap: Map<string, ActorHarness> = new Map();
  private readonly timestampBaseMs: number;
  private readonly timestampStrideMs: number;
  private timestampCounter = 0;

  private constructor(
    server: ServerHarness,
    config: ScenarioHarnessConfig
  ) {
    this.server = server;
    this.timestampBaseMs = Date.parse(
      config.timestampBaseIso ?? '2025-01-01T00:00:00.000Z'
    );
    this.timestampStrideMs = config.timestampStrideMs ?? 1_000;
  }

  static async create(config: ScenarioHarnessConfig): Promise<ScenarioHarness> {
    const server = new ServerHarness();
    const nowFactory = createDeterministicNowFactory(
      Date.parse(config.timestampBaseIso ?? '2025-01-01T00:00:00.000Z'),
      config.timestampStrideMs ?? 1_000
    );

    const harness = new ScenarioHarness(server, config);

    for (const actorDef of config.actors) {
      const dbOpts = actorDef.databaseOptions ?? config.databaseOptions;
      const actorConfig: ActorHarnessConfig = {
        alias: actorDef.alias,
        server,
        now: nowFactory,
        ...(actorDef.userId !== undefined && { userId: actorDef.userId }),
        ...(actorDef.clientId !== undefined && { clientId: actorDef.clientId }),
        ...(dbOpts !== undefined && { databaseOptions: dbOpts })
      };

      const actor = await ActorHarness.create(actorConfig);
      harness.actorMap.set(actorDef.alias, actor);
    }

    return harness;
  }

  actor(alias: string): ActorHarness {
    const found = this.actorMap.get(alias);
    if (!found) {
      const known = [...this.actorMap.keys()].join(', ');
      throw new Error(
        `Unknown actor "${alias}". Known actors: ${known}`
      );
    }
    return found;
  }

  actors(): ActorHarness[] {
    return [...this.actorMap.values()];
  }

  nextTimestamp(): string {
    const ms = this.timestampBaseMs + this.timestampCounter * this.timestampStrideMs;
    this.timestampCounter += 1;
    return new Date(ms).toISOString();
  }

  async teardown(): Promise<void> {
    const actors = [...this.actorMap.values()];
    await Promise.all(actors.map((actor) => actor.close()));
    this.actorMap.clear();
  }
}

function createDeterministicNowFactory(
  baseMs: number,
  strideMs: number
): () => Date {
  let counter = 0;
  return () => {
    const ms = baseMs + counter * strideMs;
    counter += 1;
    return new Date(ms);
  };
}
