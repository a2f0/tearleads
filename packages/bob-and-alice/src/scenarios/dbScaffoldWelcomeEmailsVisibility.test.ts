import { parseConnectJsonEnvelopeBody } from '@tearleads/shared';
import {
  setupBobNotesShareForAliceDb,
  setupWelcomeEmailsDb
} from '@tearleads/shared/scaffolding';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readEmailIds(payload: unknown): string[] {
  if (!isRecord(payload)) {
    return [];
  }

  const emailsValue = payload['emails'];
  if (!Array.isArray(emailsValue)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of emailsValue) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = entry['id'];
    if (typeof id === 'string' && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}

async function fetchEmailIdsFromConnect(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<string[]> {
  const response = await actor.fetch(
    '/connect/tearleads.v1.VfsService/GetEmails',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: 0, limit: 50 })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email fetch failed: ${errorText}`);
  }

  const connectEnvelope: unknown = await response.json();
  const payload = parseConnectJsonEnvelopeBody(connectEnvelope);
  return readEmailIds(payload);
}

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

describe('DB scaffolding welcome email visibility', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('exposes seeded welcome emails to each owner via connect GetEmails', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const client = await harness.ctx.pool.connect();
    let seededEmails: Awaited<ReturnType<typeof setupWelcomeEmailsDb>>;
    try {
      await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
      });

      seededEmails = await setupWelcomeEmailsDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
      });
    } finally {
      client.release();
    }

    const [bobEmailIds, aliceEmailIds] = await Promise.all([
      fetchEmailIdsFromConnect(bob),
      fetchEmailIdsFromConnect(alice)
    ]);

    expect(bobEmailIds).toContain(seededEmails.bob.emailItemId);
    expect(aliceEmailIds).toContain(seededEmails.alice.emailItemId);
    expect(bobEmailIds).not.toContain(seededEmails.alice.emailItemId);
    expect(aliceEmailIds).not.toContain(seededEmails.bob.emailItemId);
  });
});
