# Request-volume canaries, 2026-11-26

One run of `bun run perf:canaries` on an M2 Pro with Bun 1.4.2, at
`1844df270`. The uncommitted changes were the runner itself, in
`packages/performance`. All nine canaries passed in 236 s, one sample each.
This is the first recorded request baseline. An efficiency proposal compares
its implementation with it through `--baseline`, after rerunning it at the
proposal's base revision.

Counts are proxied API requests and body bytes, headers excluded, against
PGlite and the in-memory object store. Dual-pane canaries sum both panes.
The offline phases of `DeviceFirstOfflineRequestVolume` and the
`create empty folder` and explorer-opening phases of
`DualPaneProvider.sharing` sent no requests and are left out.
`test total` in the sharing canary spans its earlier phases.

| Canary | Phase | Requests | Request bytes | Response bytes |
| --- | --- | ---: | ---: | ---: |
| `DualPaneProvider.groupsRequestVolume` | provisioning + settle | 41 | 551,000 | 56,130 |
| `DualPaneProvider.groupsRequestVolume` | open org manager + select Admins | 3 | 0 | 4,215 |
| `DualPaneProvider.groupsRequestVolume` | admin-group add + settle | 49 | 130,003 | 493,530 |
| `DualPaneProvider.groupsRequestVolume` | admin-group mutation + settle | 46 | 130,003 | 489,315 |
| `DualPaneProvider.sharing` | create note with attachment | 9 | 54,919 | 7,720 |
| `DualPaneProvider.sharing` | share root + post-share settle | 19 | 47,165 | 168,395 |
| `DualPaneProvider.sharing` | auto-discover shared note settle | 19 | 2,328 | 160,488 |
| `DualPaneProvider.sharing` | test total | 47 | 104,412 | 336,603 |
| `ExplorerUploadRequestVolume` | explorer single-file upload | 5 | 34,558 | 2,176 |
| `FolderMutationRequestVolume` | create child folder | 3 | 30,433 | 1,984 |
| `FolderMutationRequestVolume` | link document to folder | 2 | 9,076 | 687 |
| `FolderMutationRequestVolume` | unlink document from folder | 5 | 17,637 | 20,870 |
| `FolderMutationRequestVolume` | move document to trash | 4 | 26,456 | 8,223 |
| `FolderMutationRequestVolume` | move folder to trash | 10 | 16,610 | 19,933 |
| `FolderMutationRequestVolume` | restore folder from trash | 11 | 16,728 | 31,452 |
| `GroupMutationRequestVolume` | create first organization group | 6 | 27,594 | 19,097 |
| `GroupMutationRequestVolume` | add peer to first custom group | 28 | 74,877 | 241,109 |
| `GroupMutationRequestVolume` | create and add peer to first group | 34 | 102,471 | 260,206 |
| `GroupMutationRequestVolume` | create second organization group | 4 | 27,958 | 8,975 |
| `GroupMutationRequestVolume` | add peer to second custom group | 5 | 34,662 | 9,300 |
| `GroupMutationRequestVolume` | create and add peer to second group | 9 | 62,620 | 18,275 |
| `OrganizationBootstrapRequestVolume` | personal organization bootstrap | 21 | 275,795 | 28,343 |
| `OrganizationBootstrapRequestVolume` | additional organization creation + activation | 6 | 210,421 | 13,309 |
| `PaneReconnectRequestVolume` | reconnect without pending work | 12 | 2,234 | 41,097 |
| `PaneReconnectRequestVolume` | reconnect after peer folder create | 18 | 2,874 | 82,188 |
| `PaneRestartRequestVolume` | persisted pane restart | 19 | 3,867 | 61,942 |
| `PaneRestartRequestVolume` | settled restart with 2 notes | 11 | 3,466 | 16,077 |
| `PaneRestartRequestVolume` | settled restart with 8 notes | 11 | 3,466 | 19,917 |
| `PaneRestartRequestVolume` | settled restart with 8 folders | 10 | 4,286 | 21,766 |
| `PaneRestartRequestVolume` | restart after a local edit | 13 | 3,759 | 18,072 |

See [Request-volume canaries](../../README.md#request-volume-canaries) for what
the runner measures and how to repeat it.
