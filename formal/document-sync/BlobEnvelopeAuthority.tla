------------------------ MODULE BlobEnvelopeAuthority ------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS ScopeBindingWrites, VerifyFreshDestination
ASSUME {ScopeBindingWrites, VerifyFreshDestination} \subseteq BOOLEAN
Documents == {"A", "B"}
Epochs == 1..2
VARIABLES served, bound, observedForeign, freshDestinations, epoch
vars == <<served, bound, observedForeign, freshDestinations, epoch>>

Init ==
  /\ served = [d \in Documents |-> IF d = "A" THEN "authentic-old" ELSE "none"]
  /\ bound = FALSE /\ observedForeign = "authentic-old"
  /\ freshDestinations = {} /\ epoch = 1

Rotate ==
  /\ epoch = 1 /\ epoch' = 2
  /\ UNCHANGED <<served, bound, observedForeign, freshDestinations>>

(* A reader of A has write authority only on its new binding in B.
   Its request must not substitute the first envelope at A's new epoch. *)
BindB ==
  /\ ~bound /\ epoch = 2
  /\ observedForeign' = served["A"]
  /\ served' = [served EXCEPT !["B"] = "authentic-new",
                             !["A"] = IF ScopeBindingWrites THEN @ ELSE "forged"]
  /\ bound' = TRUE
  /\ UNCHANGED <<freshDestinations, epoch>>

(* Historical KEKs can authenticate source material, but a fresh DEK may only
   be sent to a verified current destination. No wrap of this DEK existed at 1. *)
PrepareFreshWrap(e) ==
  /\ epoch = 2 /\ e \in Epochs
  /\ ~VerifyFreshDestination \/ e = epoch
  /\ freshDestinations' = freshDestinations \cup {e}
  /\ UNCHANGED <<served, bound, observedForeign, epoch>>

ForeignEnvelopesUnchanged == bound => served["A"] = observedForeign
FreshKeysUseCurrentEpoch == freshDestinations \subseteq {2}
TypeOK ==
  /\ served \in [Documents -> {"authentic-old", "authentic-new", "none", "forged"}]
  /\ observedForeign \in {"authentic-old", "authentic-new", "none", "forged"}
  /\ bound \in BOOLEAN /\ epoch \in Epochs
  /\ freshDestinations \subseteq Epochs
Next == Rotate \/ BindB \/ (\E e \in Epochs : PrepareFreshWrap(e)) \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
=============================================================================
