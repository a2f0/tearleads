---------------------- MODULE AttachmentKeyReachability ----------------------
EXTENDS Naturals, FiniteSets

CONSTANTS CheckBindingFrontier, RetainPriorWraps, UseHistoricalKeys,
          IsolateHydration, ReuseRetiredWraps, RetainedTargetsNeedCiphertext,
          InvalidateAttachmentCache
ASSUME {CheckBindingFrontier, RetainPriorWraps, UseHistoricalKeys,
        IsolateHydration, ReuseRetiredWraps,
        RetainedTargetsNeedCiphertext, InvalidateAttachmentCache} \subseteq BOOLEAN
Containers == {"source", "destination"}
Blobs == {"one", "two"}
Epochs == 1..2

VARIABLES bindings, linked, epoch, wraps, issued, phase,
          observedBindings, observedEpoch, planned, hydrated, relinkRejected,
          cachedWraps, cacheValid, unlinkRejected
vars == <<bindings, linked, epoch, wraps, issued, phase,
          observedBindings, observedEpoch, planned, hydrated, relinkRejected,
          cachedWraps, cacheValid, unlinkRejected>>

Targets(bs, cs, es) == {<<b, c, es[c]>> : b \in bs, c \in cs}
Init ==
  /\ bindings = {"one"} /\ linked = {"source"}
  /\ epoch = [c \in Containers |-> 1]
  /\ wraps = Targets(bindings, linked, epoch) /\ issued = wraps
  /\ phase = "idle" /\ observedBindings = {} /\ observedEpoch = epoch
  /\ planned = {} /\ hydrated = "pending" /\ relinkRejected = FALSE
  /\ cachedWraps = {} /\ cacheValid = FALSE /\ unlinkRejected = FALSE

BindSecond ==
  /\ "two" \notin bindings
  /\ bindings' = bindings \cup {"two"}
  /\ wraps' = wraps \cup Targets({"two"}, linked, epoch)
  /\ issued' = issued \cup wraps'
  /\ UNCHANGED <<linked, epoch, phase, observedBindings, observedEpoch,
                  planned, hydrated, relinkRejected, cachedWraps, cacheValid,
                  unlinkRejected>>

PrepareLink ==
  /\ phase \in {"idle", "prepared"}
  /\ observedBindings' = bindings /\ observedEpoch' = epoch
  /\ planned' = Targets(bindings, Containers, epoch)
  /\ phase' = "prepared"
  /\ cachedWraps' = wraps /\ cacheValid' = TRUE
  /\ UNCHANGED <<bindings, linked, epoch, wraps, issued, hydrated, relinkRejected,
                  unlinkRejected>>

CommitLink ==
  /\ phase = "prepared" /\ observedEpoch = epoch
  /\ ~CheckBindingFrontier \/ observedBindings = bindings
  /\ linked' = Containers
  /\ wraps' = IF RetainPriorWraps THEN wraps \cup planned ELSE planned
  /\ issued' = issued \cup wraps'
  /\ phase' = "linked"
  /\ cacheValid' = IF InvalidateAttachmentCache THEN FALSE ELSE cacheValid
  /\ UNCHANGED <<bindings, epoch, observedBindings, observedEpoch,
                  planned, hydrated, relinkRejected, cachedWraps, unlinkRejected>>

RemainingEnvelopesRetained ==
  Targets(bindings, {"destination"}, epoch) \subseteq wraps

UnlinkSource ==
  /\ phase = "linked" /\ linked = Containers
  (* Retained envelopes need no ciphertext; a rekey can require new envelopes. *)
  /\ RemainingEnvelopesRetained /\ ~RetainedTargetsNeedCiphertext
  (* A stale warm cache omits the destination wrap just committed by link.
     Regenerating it with fresh randomness conflicts with the active envelope. *)
  /\ unlinkRejected' = (cacheValid /\
       ~(Targets(bindings, {"destination"}, epoch) \subseteq cachedWraps))
  /\ linked' = IF unlinkRejected' THEN linked ELSE {"destination"}
  /\ wraps' = IF unlinkRejected' \/ RetainPriorWraps THEN wraps
              ELSE Targets(bindings, {"destination"}, epoch)
  /\ issued' = issued \cup wraps'
  /\ cacheValid' = IF InvalidateAttachmentCache THEN FALSE ELSE cacheValid
  /\ UNCHANGED <<bindings, epoch, phase, observedBindings, observedEpoch,
                  planned, hydrated, relinkRejected, cachedWraps>>

(* Returning to an old key identity reuses its retained randomized envelope. *)
RelinkSource ==
  /\ phase = "linked" /\ linked = {"destination"}
  /\ relinkRejected' = (~ReuseRetiredWraps /\
        (Targets(bindings, {"source"}, epoch) \cap issued) # {})
  /\ linked' = IF relinkRejected' THEN linked ELSE Containers
  /\ wraps' = IF relinkRejected' THEN wraps
              ELSE wraps \cup Targets(bindings, {"source"}, epoch)
  /\ issued' = issued \cup wraps'
  /\ UNCHANGED <<bindings, epoch, phase, observedBindings, observedEpoch,
                  planned, hydrated, cachedWraps, cacheValid, unlinkRejected>>

ReenteredTargetsRemainWritable == ~relinkRejected
MovePreservesCommittedEnvelopes == ~unlinkRejected

Rekey(c) ==
  /\ epoch[c] = 1
  /\ epoch' = [epoch EXCEPT ![c] = 2]
  /\ UNCHANGED <<bindings, linked, wraps, issued, phase,
                  observedBindings, observedEpoch, planned, hydrated, relinkRejected,
                  cachedWraps, cacheValid, unlinkRejected>>

(* One valid attachment and one unavailable/invalid attachment settle together. *)
Hydrate ==
  /\ hydrated = "pending"
  /\ hydrated' = IF IsolateHydration THEN "validInstalled" ELSE "allLost"
  /\ UNCHANGED <<bindings, linked, epoch, wraps, issued, phase,
                  observedBindings, observedEpoch, planned, relinkRejected,
                  cachedWraps, cacheValid, unlinkRejected>>

CanOpen(b, c) == \E e \in Epochs :
  /\ <<b, c, e>> \in wraps
  /\ IF UseHistoricalKeys THEN e <= epoch[c] ELSE e = epoch[c]
CurrentReadersCanOpen == \A b \in bindings, c \in linked : CanOpen(b, c)
PriorWrapsRetained == issued \subseteq wraps
IndependentHydrationProgress == hydrated # "allLost"
TypeOK ==
  /\ bindings \subseteq Blobs /\ linked \subseteq Containers
  /\ epoch \in [Containers -> Epochs]
  /\ wraps \subseteq (Blobs \X Containers \X Epochs)
  /\ issued \subseteq (Blobs \X Containers \X Epochs)
  /\ phase \in {"idle", "prepared", "linked"}
  /\ observedBindings \subseteq Blobs /\ observedEpoch \in [Containers -> Epochs]
  /\ planned \subseteq (Blobs \X Containers \X Epochs)
  /\ hydrated \in {"pending", "validInstalled", "allLost"}
  /\ relinkRejected \in BOOLEAN
  /\ cachedWraps \subseteq (Blobs \X Containers \X Epochs)
  /\ {cacheValid, unlinkRejected} \subseteq BOOLEAN

Idle == UNCHANGED vars
Next == Idle \/ BindSecond \/ PrepareLink \/ CommitLink \/ UnlinkSource \/ RelinkSource \/ Hydrate
        \/ (\E c \in Containers : Rekey(c))
LinkedDocumentCanUnlink ==
  (phase = "linked" /\ linked = Containers) ~>
    (linked = {"destination"} \/ ~RemainingEnvelopesRetained)
Spec == Init /\ [][Next]_vars /\ WF_vars(UnlinkSource)
=============================================================================
