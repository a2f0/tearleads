# Document reload, 2026-11-26

The [document reload probe](../README.md#document-reload) counted, for
[issue #3256](https://github.com/a2f0/tearleads/issues/3256), the requests a
returning client makes when it reloads, from ten to a thousand notes, with the
notes spread over folders and with all of them in one folder:

```sh
bun run perf:reload
bun run perf:reload --documents 100,1000 --per-folder 1000
```

Two runs on an M2 Pro with Bun 1.4.2 and PostgreSQL 17.12, from `6c9df004d`:
`87a898d8d` (which includes #3305, #3312 and #3313) plus the contention probe
(#3308) and this probe. Each size had one first reload and three settled
reloads. Every settled sample made the same requests, so the request columns
are exact; times and statements are medians.

## Ten notes to a folder

| Notes | Folders | Reload | Requests | Parent lanes | Document listings | Document heads | Settled in | PostgreSQL statements | Local statements |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1 | First | 21 | 1 | 2 | 10 | 1,120 ms | 395 | 2,009 |
| 10 | 1 | Settled | 5 | 1 | 1 | 0 | 197 ms | 60 | 433 |
| 100 | 10 | First | 97 | 1 | 2 | 90 | 3,620 ms | 2,263 | 10,874 |
| 100 | 10 | Settled | 5 | 1 | 1 | 0 | 202 ms | 69 | 487 |
| 1,000 | 100 | First | 915 | 5 | 4 | 900 | 31,792 ms | 22,001 | 107,888 |
| 1,000 | 100 | Settled | 8 | 4 | 1 | 0 | 391 ms | 162 | 1,034 |

## Every note in one folder

| Notes | Folders | Reload | Requests | Parent lanes | Document listings | Document heads | Settled in | PostgreSQL statements | Local statements |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | First | 114 | 1 | 5 | 100 | 3,802 ms | 2,578 | 11,861 |
| 100 | 1 | Settled | 5 | 1 | 1 | 0 | 188 ms | 60 | 433 |
| 1,000 | 1 | First | 943 | 1 | 38 | 900 | 31,976 ms | 21,975 | 100,469 |
| 1,000 | 1 | Settled | 5 | 1 | 1 | 0 | 206 ms | 60 | 436 |

Parent lanes are `POST /containers/parent-lanes/query`, document listings
`POST /containers/documents/query`, and document heads
`GET /documents/{documentId}/writer-projection`. Every settled reload also
made two folder writer-projection reads and one policy read. First reloads
also made two to four folder writer-projection reads and two to four policy
reads, and each run's first reload one principal history read and one sync of
a system document, so their columns do not add up to their totals. Local
statements are the client's SQLite statements. A first reload follows the
notes created since the previous reload: 10, 90 and 900 in the first run, 100
and 900 in the second.

## Settled reloads before #3312 and #3313

The same two runs from `cc3de1404`, on `31d9837c9`, on 2026-11-25. Of what
merged between the two bases, only #3312 (32 lanes per parent-lane request,
one crawl per connect) and #3313 (list only the folders a crawl moved) change
the client's reload; the others changed UI, documentation and an OpenAPI
ignore list. Times are from separate runs on the same machine.

| Notes | Folders | Requests | Parent lanes | Document listings | PostgreSQL statements | Local statements | Settled in |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1 | 8 → 5 | 2 → 1 | 2 → 1 | 101 → 60 | 714 → 433 | 273 → 197 ms |
| 100 | 10 | 10 → 5 | 4 → 1 | 2 → 1 | 121 → 69 | 2,228 → 487 | 400 → 202 ms |
| 1,000 | 100 | 36 → 8 | 27 → 4 | 5 → 1 | 345 → 162 | 17,379 → 1,034 | 2,020 → 391 ms |
| 100 | 1 | 8 → 5 | 2 → 1 | 2 → 1 | 101 → 60 | 1,974 → 433 | 371 → 188 ms |
| 1,000 | 1 | 8 → 5 | 2 → 1 | 2 → 1 | 101 → 60 | 14,580 → 436 | 1,561 → 206 ms |

On the earlier base every settled reload also synced a system document; on
this one none did.

## Findings

- **A settled reload grows with neither notes nor their local work.** Ten,
  a hundred and a thousand notes cost the same 5 requests and 60 PostgreSQL
  statements, and a thousand notes in one folder ran 436 local statements
  against 433 for a hundred. On the earlier base the requests were already
  flat, but local statements grew about 14 per note, to 14,580, and the
  reload took 1.6 s to settle; it now takes about 0.2 s. The probe counts
  these statements but does not attribute them.
- **Folders still add parent-lane requests, one per 32 lanes.** Parent-lane
  requests were 1, 1 and 4 for 1, 10 and 100 folders, against 2, 4 and 27 at
  four lanes per request on the earlier base, where these results estimated
  about five at 32. The catch-up's document listings no longer grow with
  folders: one at every size, against five at 100 folders. A settled reload
  of 100 folders is 8 requests, 162 PostgreSQL statements and 0.4 s.
- **The first reload after creating notes still reads each new note's head.**
  It made one document writer-projection read per note created since the
  previous reload, 900 for 900, as #3256's status update says, and ran about
  24 PostgreSQL statements per note. It took about 32 s against this local
  API, against 27 to 29 s on the earlier base; its PostgreSQL and local
  statement counts are within 2% of that base's, so the difference is not
  work the probe can see. When those notes are all in one folder, the listing
  pages through their rows, so document listings rose to 38.

What this cannot say: how a browser's storage, worker and network change the
times, what the app shell's own requests add, or what a reload costs after
another device has changed the account.
