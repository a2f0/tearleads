# Rotation Deaths

A key rotation rebuilds a document's whole history in Loro, one raw-history
page at a time, each read in a
[read window](./glossary/sync.md#loro-read-window) like a sync pass's
([Loro runtime failures](./advisory-op-spans.md#loro-runtime-failures)). This
page covers what a death in one of those windows counts toward
(`rotationAvailabilityMachine.ts`).

## What a Death Counts Toward

Raw history holds the history the device accepted and, past it, any update
the device has not yet pulled; the rotation installs those with the rest. A
rotation page whose every update the live document already covers reads
accepted history, and a death there is far likelier the rebuild's size or
state than any update, so it counts toward the device's rotation of the
document, never toward an update, and isolates the page's updates. A page
reading an update the device has not accepted reads it as a sync pass would,
so a death there counts toward that update, and a crashing update cannot stop
a device's rotations by reaching it there first. Each counted death is
reported to the host's diagnostics and Sentry.

Once a death stands against the rotation, it reads raw history one update a
page until a rebuild completes, whatever suspects a sync pull has cleared, so
every death after the first names one update.

## Leaving an Update Out

The acceptance check trusts the update's declared span, which any writer may
set to counters already committed
([what the server checks](./advisory-op-spans.md#what-the-server-checks)), so
an update the device never held can pass as accepted. When the third death
under one judge, with no completed rebuild between them, read one update
alone, the device's next rebuild leaves that update out, unread and
unrecorded. That rebuild got past it if it dies reading another update
alone, which it leaves out too, so two writers' forged updates side by side
cost no more than one each. When a rebuild leaving them out completes, the
exact-history check decides for them all. A rebuild without them that still
equals the live document shows the device never held them, so the rotation
goes ahead and leaves them out from then on, and deaths count anew. A
rebuild that differs, where the live document holds counters within a
left-out update's span that the rebuild lacks, shows the device holds one; a
difference their spans do not explain decides nothing, and the rotation
fails as any unverified history does. Later updates found the same way join
the ones left out, up to eight a document; a device that comes to hold one
it left out, so that a rebuild without them differs within their spans,
reads them all again from the start. A rebuild leaving them out that keeps
failing for an unrelated reason, such as a gap in local history, decides
nothing, so that document's rotations keep reading one update a page until a
rebuild leaving them out proves or diverges, or a new judge arrives.

## Unavailable Rotation

The device records the document's rotation as unavailable and starts no more
when a rebuild leaving updates out shows the device holds one or ends the
process reading several updates, when the third death read several updates,
or when eight updates are already left out
(`DocumentRotationUnavailableError`). It
cannot unlink, move, or purge-unlink that document, and leaves those to other
members, none of which waits on it. A queued move it cannot prove parks as a
denied one does, replaying once a launch. It still opens, edits, and syncs
the document. A completed rebuild below the limit starts the count over, and
so does a new judge (a decoder or void rules change); an unavailable
rotation, or an update left out, stays so until then.

A completed sync pull of the document clears the suspects a rotation's death
left, though it never reads them. A death outside a rotation page's window,
between pages or in the rebuild's final comparison, counts toward nothing.
