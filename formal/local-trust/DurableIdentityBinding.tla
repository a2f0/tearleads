-------------------- MODULE DurableIdentityBinding --------------------
EXTENDS FiniteSets

CONSTANTS Domains, Users, Fingerprints, None, CheckReverseBinding, CheckPinCompare
ASSUME /\ IsFiniteSet(Domains) /\ IsFiniteSet(Users) /\ IsFiniteSet(Fingerprints)
       /\ None \notin Users \cup Fingerprints
       /\ {CheckReverseBinding, CheckPinCompare} \subseteq BOOLEAN

VARIABLES pins, acknowledged
vars == <<pins, acknowledged>>

Init ==
  /\ pins = [d \in Domains |-> [u \in Users |-> None]]
  /\ acknowledged = [d \in Domains |-> [f \in Fingerprints |-> None]]

(* One atomic durable compare-or-insert, followed by session publication. *)
(* Without the compare, a login presenting another key replaces the pin.  *)
Login(d, u, f) ==
  /\ acknowledged[d][f] \in {None, u}
  /\ CheckPinCompare => pins[d][u] \in {None, f}
  /\ ~CheckReverseBinding \/ (\A other \in Users : pins[d][other] = f => other = u)
  /\ pins' = [pins EXCEPT ![d][u] = f]
  /\ acknowledged' = [acknowledged EXCEPT ![d][f] = u]

(* Loss of session state never removes a pin from the surviving trust store. *)
Reboot ==
  /\ acknowledged' = [d \in Domains |-> [f \in Fingerprints |-> None]]
  /\ UNCHANGED pins

Next == Reboot \/ (\E d \in Domains, u \in Users, f \in Fingerprints : Login(d, u, f))
Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ pins \in [Domains -> [Users -> Fingerprints \cup {None}]]
  /\ acknowledged \in [Domains -> [Fingerprints -> Users \cup {None}]]

SigningFingerprintsHaveOneUser ==
  \A d \in Domains, u \in Users, other \in Users :
    (pins[d][u] # None /\ pins[d][u] = pins[d][other]) => u = other

PublishedSessionsMatchPins ==
  \A d \in Domains, f \in Fingerprints :
    acknowledged[d][f] # None => pins[d][acknowledged[d][f]] = f

PinsNeverChange ==
  [][\A d \in Domains, u \in Users : pins[d][u] # None => pins'[d][u] = pins[d][u]]_vars
======================================================================
