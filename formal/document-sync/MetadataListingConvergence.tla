---- MODULE MetadataListingConvergence ----
(***************************************************************************)
(* A client that holds a container metadata document at a recorded       *)
(* position catches up with a peer's edit whose realtime hint was lost.   *)
(*                                                                         *)
(* Every peer edit advances the server container timestamp. So do other   *)
(* touches, such as writes into the folder or moves. A hint reaches the   *)
(* client only while it is up and its interest is acknowledged; otherwise *)
(* it is lost. Each acknowledged connection owes one re-list. The re-list *)
(* compares the listed timestamp with the one the client recorded. When   *)
(* the listed one is later, it owes the metadata document a read, in      *)
(* memory and durably, and records the listed timestamp. A read captures  *)
(* the server version and the signal sequence; finishing it settles the   *)
(* debt only if no newer signal arrived meanwhile. A crash loses memory,  *)
(* the socket and in-flight work; the recorded timestamp, the durable     *)
(* debt and the local version survive, and startup reloads the debt.      *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS
  MaxEdits,
  MaxTouches,
  MaxRestarts,
  MaxDisconnects,
  MaxResumes,
  \* Production advances the container timestamp strictly on every write.
  StrictTimestamps,
  \* Production owes the read before it records the listed timestamp.
  OweBeforeRecord,
  \* Production settles only when no newer signal arrived during the read.
  SettleOnlyIfUnchanged,
  \* Production startup requeues the durable debts.
  RestoreOnStart,
  \* Production never settles from a pass that resumed an earlier pull.
  SettleResumedPull

ASSUME /\ MaxEdits \in Nat /\ MaxTouches \in Nat
       /\ MaxRestarts \in Nat /\ MaxDisconnects \in Nat
       /\ MaxResumes \in Nat
       /\ StrictTimestamps \in BOOLEAN
       /\ OweBeforeRecord \in BOOLEAN
       /\ SettleOnlyIfUnchanged \in BOOLEAN
       /\ RestoreOnStart \in BOOLEAN
       /\ SettleResumedPull \in BOOLEAN

VARIABLES
  remoteVer,     \* server metadata version
  stamp,         \* server container timestamp
  edits, touches, restarts, disconnects, resumes,
  up,            \* the client process is running
  connected,     \* its interest declaration is acknowledged
  relistDue,     \* an acknowledged connection still owes its re-list
  listing,       \* a re-list is applying this container
  listedStamp,   \* the timestamp that re-list read
  listChanged,   \* it was later than the recorded one
  listOwed,      \* that re-list already owed the read
  listRecorded,  \* that re-list already recorded the timestamp
  recorded,      \* durable: the server timestamp the client recorded
  owedMem,       \* the in-memory needs-sync queue holds the document
  owedDurable,   \* durable: container_metadata_revalidations holds it
  seq,           \* in-memory signal sequence for the document
  localVer,      \* durable: the metadata version the client holds
  reading, readVer, readSeq,
  readResumed    \* the read resumes an earlier pull's pages and bound

vars == <<remoteVer, stamp, edits, touches, restarts, disconnects, resumes,
          up, connected, relistDue, listing, listedStamp, listChanged,
          listOwed, listRecorded, recorded, owedMem, owedDurable, seq,
          localVer, reading, readVer, readSeq, readResumed>>

listingVars == <<listing, listedStamp, listChanged, listOwed, listRecorded>>
readVars == <<reading, readVer, readSeq, readResumed>>
boundVars == <<edits, touches, restarts, disconnects, resumes>>

MaxStamp == MaxEdits + MaxTouches
MaxSeq == MaxEdits + MaxStamp + MaxRestarts

TypeOK ==
  /\ remoteVer \in 0..MaxEdits /\ localVer \in 0..MaxEdits
  /\ readVer \in 0..MaxEdits
  /\ stamp \in 0..MaxStamp /\ recorded \in 0..MaxStamp
  /\ listedStamp \in 0..MaxStamp
  /\ seq \in 0..MaxSeq /\ readSeq \in 0..MaxSeq
  /\ {up, connected, relistDue, listing, listChanged, listOwed,
      listRecorded, owedMem, owedDurable, reading,
      readResumed} \subseteq BOOLEAN

Init ==
  \* Registration or a seeded create: the client holds version 0 and its
  \* recorded timestamp matches the server's.
  /\ remoteVer = 0 /\ stamp = 0 /\ recorded = 0 /\ localVer = 0
  /\ edits = 0 /\ touches = 0 /\ restarts = 0 /\ disconnects = 0
  /\ resumes = 0
  /\ up = TRUE /\ connected = FALSE /\ relistDue = FALSE
  /\ listing = FALSE /\ listedStamp = 0 /\ listChanged = FALSE
  /\ listOwed = FALSE /\ listRecorded = FALSE
  /\ owedMem = FALSE /\ owedDurable = FALSE /\ seq = 0
  /\ reading = FALSE /\ readVer = 0 /\ readSeq = 0 /\ readResumed = FALSE

\* A peer device of the same identity edits the metadata document. Without
\* strict timestamps, a write in the same millisecond, or on an instance whose
\* clock trails, can leave the stored timestamp where it was.
PeerEdit ==
  /\ edits < MaxEdits
  /\ remoteVer' = remoteVer + 1
  /\ stamp' \in IF StrictTimestamps THEN {stamp + 1} ELSE {stamp, stamp + 1}
  /\ edits' = edits + 1
  /\ IF up /\ connected
       THEN owedMem' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<owedMem, seq>>
  /\ UNCHANGED <<touches, restarts, disconnects, resumes, up, connected,
                 relistDue, listingVars, recorded, owedDurable, localVer,
                 readVars>>

\* A write into the folder or a move advances the timestamp only.
OtherTouch ==
  /\ touches < MaxTouches
  /\ stamp' = stamp + 1 /\ touches' = touches + 1
  /\ UNCHANGED <<remoteVer, edits, restarts, disconnects, resumes, up,
                 connected, relistDue, listingVars, recorded, owedMem,
                 owedDurable, seq, localVer, readVars>>

Acknowledge ==
  /\ up /\ ~connected
  /\ connected' = TRUE /\ relistDue' = TRUE
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, listingVars, recorded,
                 owedMem, owedDurable, seq, localVer, readVars>>

Disconnect ==
  /\ connected /\ disconnects < MaxDisconnects
  /\ connected' = FALSE /\ disconnects' = disconnects + 1
  /\ UNCHANGED <<remoteVer, stamp, edits, touches, restarts, resumes, up,
                 relistDue, listingVars, recorded, owedMem, owedDurable, seq,
                 localVer, readVars>>

BeginListing ==
  /\ up /\ relistDue /\ ~listing
  /\ relistDue' = FALSE /\ listing' = TRUE
  /\ listedStamp' = stamp /\ listChanged' = (stamp > recorded)
  /\ listOwed' = FALSE /\ listRecorded' = FALSE
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, connected, recorded,
                 owedMem, owedDurable, seq, localVer, readVars>>

\* oweContainerMetadataRead: memory first, then container_metadata_revalidations.
OweListedRead ==
  /\ up /\ listing /\ listChanged /\ ~listOwed
  /\ OweBeforeRecord \/ listRecorded
  /\ owedMem' = TRUE /\ seq' = seq + 1 /\ owedDurable' = TRUE
  /\ listOwed' = TRUE
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, connected, relistDue,
                 listing, listedStamp, listChanged, listRecorded, recorded,
                 localVer, readVars>>

\* The hydration write records the listed timestamp and lane watermark.
RecordListedStamp ==
  /\ up /\ listing /\ ~listRecorded
  /\ ~OweBeforeRecord \/ listOwed \/ ~listChanged
  /\ recorded' = IF listedStamp > recorded THEN listedStamp ELSE recorded
  /\ listRecorded' = TRUE
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, connected, relistDue,
                 listing, listedStamp, listChanged, listOwed, owedMem,
                 owedDurable, seq, localVer, readVars>>

FinishListing ==
  /\ listing /\ listRecorded /\ (listOwed \/ ~listChanged)
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listRecorded' = FALSE
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, connected, relistDue,
                 listedStamp, listChanged, recorded, owedMem, owedDurable,
                 seq, localVer, readVars>>

\* syncSingleContainerMetadata snapshots the signal sequence before its GET.
BeginRead ==
  /\ up /\ owedMem /\ ~reading
  /\ reading' = TRUE /\ readVer' = remoteVer /\ readSeq' = seq
  /\ readResumed' = FALSE
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, connected, relistDue,
                 listingVars, recorded, owedMem, owedDurable, seq, localVer>>

\* The pass resumes a paginated pull begun earlier; its pages stop at that
\* pull's upper bound, any version up to the current one.
ResumeRead ==
  /\ up /\ owedMem /\ ~reading /\ resumes < MaxResumes
  /\ reading' = TRUE /\ readSeq' = seq /\ readResumed' = TRUE
  /\ readVer' \in 0..remoteVer
  /\ resumes' = resumes + 1
  /\ UNCHANGED <<remoteVer, stamp, edits, touches, restarts, disconnects, up,
                 connected, relistDue, listingVars, recorded, owedMem,
                 owedDurable, seq, localVer>>

\* The pull imports every update the client lacks as of its snapshot.
FinishRead ==
  /\ up /\ reading
  /\ reading' = FALSE
  /\ localVer' = IF readVer > localVer THEN readVer ELSE localVer
  /\ IF (~SettleOnlyIfUnchanged \/ seq = readSeq)
        /\ (SettleResumedPull \/ ~readResumed)
       THEN owedMem' = FALSE /\ owedDurable' = FALSE
       ELSE UNCHANGED <<owedMem, owedDurable>>
  /\ UNCHANGED <<remoteVer, stamp, boundVars, up, connected, relistDue,
                 listingVars, recorded, seq, readVer, readSeq, readResumed>>

Crash ==
  /\ up /\ restarts < MaxRestarts
  /\ up' = FALSE /\ connected' = FALSE /\ relistDue' = FALSE
  /\ restarts' = restarts + 1
  /\ listing' = FALSE /\ listOwed' = FALSE /\ listRecorded' = FALSE
  /\ owedMem' = FALSE /\ reading' = FALSE
  /\ UNCHANGED <<remoteVer, stamp, edits, touches, disconnects, resumes,
                 listedStamp, listChanged, recorded, owedDurable, seq,
                 localVer, readVer, readSeq, readResumed>>

\* restoreOwedContainerMetadataReads on a store's first sync pass.
Start ==
  /\ ~up
  /\ up' = TRUE
  /\ IF RestoreOnStart /\ owedDurable
       THEN owedMem' = TRUE /\ seq' = seq + 1
       ELSE UNCHANGED <<owedMem, seq>>
  /\ UNCHANGED <<remoteVer, stamp, boundVars, connected, relistDue,
                 listingVars, recorded, owedDurable, localVer, readVars>>

Next ==
  \/ PeerEdit \/ OtherTouch \/ Acknowledge \/ Disconnect
  \/ BeginListing \/ OweListedRead \/ RecordListedStamp \/ FinishListing
  \/ BeginRead \/ ResumeRead \/ FinishRead \/ Crash \/ Start
  \* Bounded peer, crash and disconnect budgets leave a quiescent end state.
  \/ UNCHANGED vars

Fairness ==
  /\ WF_vars(Acknowledge) /\ WF_vars(Start)
  /\ WF_vars(BeginListing) /\ WF_vars(OweListedRead)
  /\ WF_vars(RecordListedStamp) /\ WF_vars(FinishListing)
  /\ WF_vars(BeginRead) /\ WF_vars(FinishRead)

Spec == Init /\ [][Next]_vars /\ Fairness

(***************************************************************************)
(* While the client is behind, something still obliges a read: a durable  *)
(* debt, a timestamp the next re-list will see as changed, or, while the  *)
(* process is up, a queued read, a read that covers the latest version,   *)
(* or a re-list that has seen the change and not yet owed its read.       *)
(***************************************************************************)
EvidenceRetained ==
  localVer < remoteVer =>
    \/ owedDurable
    \/ stamp > recorded
    \/ up /\ owedMem
    \/ up /\ reading /\ readVer = remoteVer
    \/ up /\ listing /\ listChanged /\ ~listOwed

\* Once edits stop, the client holds the server's metadata version.
Converges == <>[](localVer = remoteVer)

====
