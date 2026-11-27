--------------------------- MODULE SystemSlotFold ---------------------------
(* A device-first system container (Contacts) made under a pre-auth root,   *)
(* whose create is queued. Sign-in or restore folds that root into the      *)
(* account root, which may already hold the slot (#3290). The create must   *)
(* not reach the server while a listing of the account root could still     *)
(* fold it, a refused create must not be retried, and the create must still *)
(* settle or wait only on a listing when listings never complete.           *)
EXTENDS Naturals

CONSTANTS HoldOnFold, TypedSlotConflict, HoldBound, ParkRefused
ASSUME {HoldOnFold, TypedSlotConflict, HoldBound, ParkRefused} \subseteq BOOLEAN

(* A create pass works from the intents it listed when it started, so      *)
(* seenTaken is that snapshot and parked is the pass's own memory.          *)
VARIABLES accountHasSlot, folded, held, listedAfterHold, expired, pending,
          taken, posts, created, inPass, seenTaken, parked
vars == <<accountHasSlot, folded, held, listedAfterHold, expired, pending,
          taken, posts, created, inPass, seenTaken, parked>>
passVars == <<inPass, seenTaken, parked>>

(* Posts are bounded so the faulty configurations stay finite. *)
MaxPosts == 3

TypeOK ==
  /\ {accountHasSlot, folded, held, listedAfterHold, expired, pending, taken,
      created, inPass, seenTaken, parked} \subseteq BOOLEAN
  /\ posts \in 0..MaxPosts

Init ==
  /\ accountHasSlot \in BOOLEAN
  /\ folded = FALSE /\ held = FALSE /\ listedAfterHold = FALSE
  /\ expired = FALSE /\ pending = TRUE /\ taken = FALSE /\ posts = 0
  /\ created = FALSE /\ inPass = FALSE /\ seenTaken = FALSE
  /\ parked = FALSE

(* The root fold re-homes the create onto the account root. *)
RootFold ==
  /\ ~folded
  /\ folded' = TRUE /\ held' = HoldOnFold
  /\ UNCHANGED <<accountHasSlot, listedAfterHold, expired, pending, taken,
                  posts, created>>
  /\ UNCHANGED passVars

(* A drained listing of the account root's children. A listed twin folds   *)
(* the local copy, which deletes its create intent.                        *)
ListParent ==
  /\ folded /\ pending
  /\ listedAfterHold' = TRUE
  /\ pending' = (pending /\ ~accountHasSlot)
  /\ UNCHANGED <<accountHasSlot, folded, held, expired, taken, posts, created>>
  /\ UNCHANGED passVars

Expire ==
  /\ held /\ ~listedAfterHold /\ ~expired /\ HoldBound
  /\ expired' = TRUE
  /\ UNCHANGED <<accountHasSlot, folded, held, listedAfterHold, pending, taken,
                  posts, created>>
  /\ UNCHANGED passVars

MayPost == ~held \/ listedAfterHold \/ expired

(* The pass may try the create: it listed it untaken and has not parked it. *)
PassMayPost ==
  folded /\ pending /\ ~seenTaken /\ ~parked /\ MayPost /\ posts < MaxPosts

StartPass ==
  /\ ~inPass
  /\ inPass' = TRUE /\ seenTaken' = taken /\ parked' = FALSE
  /\ UNCHANGED <<accountHasSlot, folded, held, listedAfterHold, expired,
                  pending, taken, posts, created>>

(* A pass ends once it has nothing left to try. Another create settling in *)
(* it reruns the rest, which this leaves open.                              *)
EndPass ==
  /\ inPass /\ ~PassMayPost
  /\ inPass' = FALSE /\ parked' = FALSE
  /\ UNCHANGED <<accountHasSlot, folded, held, listedAfterHold, expired,
                  pending, taken, posts, created, seenTaken>>

(* The server takes the create when the slot is free. Otherwise a typed    *)
(* refusal is final and parks the create for the rest of the pass; an      *)
(* untyped one looks stale and is retried.                                  *)
Post ==
  /\ inPass /\ PassMayPost
  /\ posts' = posts + 1
  /\ IF accountHasSlot
       THEN /\ taken' = TypedSlotConflict
            /\ parked' = (TypedSlotConflict /\ ParkRefused)
            /\ UNCHANGED <<pending, created>>
       ELSE /\ created' = TRUE /\ pending' = FALSE
            /\ UNCHANGED <<taken, parked>>
  /\ UNCHANGED <<accountHasSlot, folded, held, listedAfterHold, expired,
                  inPass, seenTaken>>

Next == RootFold \/ ListParent \/ Expire \/ StartPass \/ EndPass \/ Post
          \/ UNCHANGED vars

(* Listings may never complete: no fairness on ListParent. *)
Spec == Init /\ [][Next]_vars /\ WF_vars(RootFold) /\ WF_vars(Expire)
          /\ WF_vars(StartPass) /\ WF_vars(EndPass) /\ WF_vars(Post)

(* A slot the account holds is never posted while its listing can still   *)
(* fold the local copy, unless the hold ran out.                            *)
NoPostBeforeFoldingListing ==
  (accountHasSlot /\ ~expired) => posts = 0

(* One create never reaches the server twice. *)
AtMostOnePost == posts <= 1

(* No brick: the create settles, or the server proved the slot taken and   *)
(* only a listing can fold it.                                              *)
CreateSettles == <>(~pending \/ taken)
=============================================================================
