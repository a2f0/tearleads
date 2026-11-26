# Document reload, 2026-11-25

The [document reload probe](../README.md#document-reload) counted, for
[issue #3256](https://github.com/a2f0/tearleads/issues/3256), the requests a
returning client makes when it reloads, from ten to a thousand notes, with the
notes spread over folders and with all of them in one folder:

```sh
bun run perf:reload
bun run perf:reload --documents 100,1000 --per-folder 1000
```

Two runs on an M2 Pro with Bun 1.4.2 and PostgreSQL 17.12, from `31d9837c9`
(which includes #3305) plus the contention probe (#3308) and this probe. Each
size had one first reload and three settled reloads. Every settled sample
made the same requests, so the request columns are exact; times and
statements are medians.

## Ten notes to a folder

| Notes | Folders | Reload | Requests | Parent lanes | Document listings | Document heads | Settled in | PostgreSQL statements | Local statements |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1 | First | 22 | 2 | 2 | 10 | 766 ms | 393 | 1,965 |
| 10 | 1 | Settled | 8 | 2 | 2 | 0 | 215 ms | 101 | 714 |
| 100 | 10 | First | 101 | 4 | 2 | 90 | 3,008 ms | 2,299 | 11,138 |
| 100 | 10 | Settled | 10 | 4 | 2 | 0 | 329 ms | 121 | 2,228 |
| 1,000 | 100 | First | 940 | 27 | 5 | 900 | 31,484 ms | 22,066 | 109,568 |
| 1,000 | 100 | Settled | 36 | 27 | 5 | 0 | 2,051 ms | 345 | 17,379 |

## Every note in one folder

| Notes | Folders | Reload | Requests | Parent lanes | Document listings | Document heads | Settled in | PostgreSQL statements | Local statements |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1 | First | 115 | 2 | 5 | 100 | 3,484 ms | 2,577 | 11,814 |
| 100 | 1 | Settled | 8 | 2 | 2 | 0 | 321 ms | 101 | 1,974 |
| 1,000 | 1 | First | 945 | 2 | 38 | 900 | 29,944 ms | 22,008 | 100,549 |
| 1,000 | 1 | Settled | 8 | 2 | 2 | 0 | 1,616 ms | 101 | 14,580 |

Parent lanes are `POST /containers/parent-lanes/query`, document listings
`POST /containers/documents/query`, and document heads
`GET /documents/{documentId}/writer-projection`. Every settled reload also
made two folder writer-projection reads, one policy read and one sync of a
system document. Local statements are the client's SQLite
statements. A first reload follows the notes created since the previous
reload: 10, 90 and 900 in the first run, 100 and 900 in the second.

## Findings

- **A settled reload no longer grows with notes.** A thousand notes in one
  folder cost the same 8 requests and 101 PostgreSQL statements as a hundred.
  #3256's phase 1 holds at sizes the pane canaries do not reach.
- **It grows with folders, through the tree crawl.** Parent-lane requests rose
  from 2 to 4 to 27 for 1, 10 and 100 folders, about one request per four
  lanes, and were 27 of the 36 requests at 100 folders. #3305 raised the API's
  limit to 32 lanes per request, but at this revision the SDK still sends four
  (`CONTAINER_PARENT_HYDRATION_CONCURRENCY`). Sending 32, the crawl would
  still list the root's lane before its children, but the 27 should fall to
  about five; that is an estimate, not a measurement. Document
  listings, at 32 lanes per request, rose only from 2 to 5.
- **Local work grows with notes.** With the same 8 requests, a settled reload
  of a thousand notes ran 14,580 local statements against 1,974 for a hundred,
  about 14 per note, and took 1.6 s to settle against 0.3 s. The probe counts
  these statements but does not attribute them.
- **The first reload after creating notes reads each new note's head.** It
  made one document writer-projection read per note created since the previous
  reload, 900 for 900, as #3256's status update says. That reload took 30 s
  against this local API and ran about 24 PostgreSQL statements per note.
  When those notes are all in one folder, the listing pages through their
  rows, so document listings rose to 38.

What this cannot say: how a browser's storage, worker and network change the
times, what the app shell's own requests add, or what a reload costs after
another device has changed the account.
