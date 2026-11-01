-------------------- MODULE DurableIdentityBinding --------------------
EXTENDS FiniteSets, Naturals

CONSTANTS Domains, Users, Fingerprints, None, CheckReverseBinding, CheckPinCompare,
          CheckAdmissionProvenance, RaiseProvenanceOnly
ASSUME /\ IsFiniteSet(Domains) /\ IsFiniteSet(Users) /\ IsFiniteSet(Fingerprints)
       /\ None \notin Users \cup Fingerprints
       /\ {CheckReverseBinding, CheckPinCompare, CheckAdmissionProvenance,
           RaiseProvenanceOnly} \subseteq BOOLEAN

(* How the device came to trust a pin: "observed" is the first server     *)
(* answer for a user signed state references, "link" an independently     *)
(* exchanged identity link, "self" this device's own local keys.          *)
Provenances == {"observed", "link", "self"}
Rank(p) == CASE p = "self" -> 3 [] p = "link" -> 2 [] p = "observed" -> 1
                [] OTHER -> 0
AdmittingProvenances == {"link", "self"}

VARIABLES pins, acknowledged, provenance, admitted
vars == <<pins, acknowledged, provenance, admitted>>

Init ==
  /\ pins = [d \in Domains |-> [u \in Users |-> None]]
  /\ acknowledged = [d \in Domains |-> [f \in Fingerprints |-> None]]
  /\ provenance = [d \in Domains |-> [u \in Users |-> None]]
  /\ admitted = [d \in Domains |-> {}]

(* One atomic durable compare-or-insert of fingerprint f for user u with   *)
(* candidate provenance p. Without the compare, a candidate presenting     *)
(* another key replaces the pin. Matching keys keep the stored row and     *)
(* only raise its provenance; they never lower it.                         *)
PinCompare(d, u, f, p) ==
  /\ CheckPinCompare => pins[d][u] \in {None, f}
  /\ ~CheckReverseBinding \/ (\A other \in Users : pins[d][other] = f => other = u)
  /\ pins' = [pins EXCEPT ![d][u] = f]
  /\ provenance' = [provenance EXCEPT ![d][u] =
       IF RaiseProvenanceOnly /\ pins[d][u] = f /\ Rank(p) <= Rank(provenance[d][u])
         THEN provenance[d][u] ELSE p]

(* A login pins the user's own local keys, then publishes the session.    *)
Login(d, u, f) ==
  /\ acknowledged[d][f] \in {None, u}
  /\ PinCompare(d, u, f, "self")
  /\ acknowledged' = [acknowledged EXCEPT ![d][f] = u]
  /\ UNCHANGED admitted

(* A server answer for a referenced user pins as observed; a verified     *)
(* identity link pins as link. Neither publishes a session.               *)
Resolve(d, u, f, p) ==
  /\ p \in {"observed", "link"}
  /\ PinCompare(d, u, f, p)
  /\ UNCHANGED <<acknowledged, admitted>>

(* Admission (contact, roster import, group add, folder share) reads the   *)
(* pin without writing it and requires link or self provenance.           *)
Admit(d, u) ==
  /\ pins[d][u] # None
  /\ CheckAdmissionProvenance => provenance[d][u] \in AdmittingProvenances
  /\ admitted' = [admitted EXCEPT ![d] = @ \cup {u}]
  /\ UNCHANGED <<pins, acknowledged, provenance>>

(* Loss of session state never removes a pin from the surviving trust store. *)
Reboot ==
  /\ acknowledged' = [d \in Domains |-> [f \in Fingerprints |-> None]]
  /\ UNCHANGED <<pins, provenance, admitted>>

Next ==
  \/ Reboot
  \/ \E d \in Domains, u \in Users, f \in Fingerprints :
       \/ Login(d, u, f)
       \/ \E p \in {"observed", "link"} : Resolve(d, u, f, p)
  \/ \E d \in Domains, u \in Users : Admit(d, u)
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ pins \in [Domains -> [Users -> Fingerprints \cup {None}]]
  /\ acknowledged \in [Domains -> [Fingerprints -> Users \cup {None}]]
  /\ provenance \in [Domains -> [Users -> Provenances \cup {None}]]
  /\ admitted \in [Domains -> SUBSET Users]
  /\ \A d \in Domains, u \in Users : (pins[d][u] = None) = (provenance[d][u] = None)

SigningFingerprintsHaveOneUser ==
  \A d \in Domains, u \in Users, other \in Users :
    (pins[d][u] # None /\ pins[d][u] = pins[d][other]) => u = other

PublishedSessionsMatchPins ==
  \A d \in Domains, f \in Fingerprints :
    acknowledged[d][f] # None => pins[d][acknowledged[d][f]] = f

(* Every admitted user is pinned by a link or this device's own keys.     *)
AdmittedUsersAreLinked ==
  \A d \in Domains : \A u \in admitted[d] : provenance[d][u] \in AdmittingProvenances

PinsNeverChange ==
  [][\A d \in Domains, u \in Users : pins[d][u] # None => pins'[d][u] = pins[d][u]]_vars

ProvenanceOnlyRises ==
  [][\A d \in Domains, u \in Users : Rank(provenance'[d][u]) >= Rank(provenance[d][u])]_vars
======================================================================
