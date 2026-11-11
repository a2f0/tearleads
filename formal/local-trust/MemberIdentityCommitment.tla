-------------------- MODULE MemberIdentityCommitment --------------------
EXTENDS Naturals, FiniteSets
CONSTANTS BindCompleteBundle, BindProjection, CheckContinuingIdentity
ASSUME {BindCompleteBundle, BindProjection, CheckContinuingIdentity} \subseteq BOOLEAN

(* Collision-free hash abstraction. One independently changed component per *)
(* candidate checks the domain-separated, canonical identity-link.v1 tuple. *)
Fields == {"domain", "user", "signingSuite", "signingKey", "kemSuite", "kemKey"}
Original == [f \in Fields |-> 0]
Bundles == {Original} \cup {[Original EXCEPT ![f] = 1] : f \in Fields}
Fingerprint(b) == IF BindCompleteBundle THEN <<"tearleads.identity-link.v1", b>>
                  ELSE b.kemKey
Projection(b) == IF BindProjection THEN <<"user", "member", Fingerprint(b)>>
                 ELSE <<"user", "member">>
MembershipRoot == {"user"}

VARIABLES kind, current, accepted, delivered
vars == <<kind, current, accepted, delivered>>
Init == /\ kind \in {"group", "organization"}
        /\ current = Original
        /\ accepted = FALSE
        /\ delivered = Original

(* Adversarial delivery of a different bundle under the signed projection. *)
Receive(b) ==
  /\ Projection(b) = Projection(current)
  /\ accepted' = TRUE
  /\ delivered' = b
  /\ UNCHANGED <<kind, current>>

(* Authorized successor, same user ID and role. Authorization does not permit *)
(* silently changing a continuing member's bundle. Remove/re-add is separate. *)
Continue(b) ==
  /\ CheckContinuingIdentity => Fingerprint(b) = Fingerprint(current)
  /\ current' = b
  /\ accepted' = FALSE
  /\ UNCHANGED <<kind, delivered>>
Next == (\E b \in Bundles : Receive(b) \/ Continue(b)) \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == /\ kind \in {"group", "organization"}
          /\ current \in Bundles /\ delivered \in Bundles /\ accepted \in BOOLEAN
AcceptedBundleIsCommitted == accepted => delivered = current
ContinuingIdentityIsImmutable == [][current' = current]_vars
==========================================================================
