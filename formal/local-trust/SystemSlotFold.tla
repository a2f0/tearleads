--------------------------- MODULE SystemSlotFold ---------------------------
(* A device-first system container (Contacts) made under a pre-auth root,   *)
(* whose create is queued. Sign-in or restore folds that root into the      *)
(* account root, which may already hold the slot (#3290). The create must   *)
(* not reach the server while a listing of the account root could still     *)
(* fold it, a refused create must not be retried, and the create must still *)
(* settle or wait only on a listing when listings never complete.           *)
EXTENDS Naturals

CONSTANTS HoldOnFold, TypedSlotConflict, HoldBound
ASSUME {HoldOnFold, TypedSlotConflict, HoldBound} \subseteq BOOLEAN

VARIABLES accountHasSlot, folded, held, listedAfterHold, expired, pending,
          taken, posts, created
vars == <<accountHasSlot, folded, held, listedAfterHold, expired, pending,
          taken, posts, created>>

(* Posts are bounded so the faulty configurations stay finite. *)
MaxPosts == 3

TypeOK ==
  /\ {accountHasSlot, folded, held, listedAfterHold, expired, pending, taken,
      created} \subseteq BOOLEAN
  /\ posts \in 0..MaxPosts

Init ==
  /\ accountHasSlot \in BOOLEAN
  /\ folded = FALSE /\ held = FALSE /\ listedAfterHold = FALSE
  /\ expired = FALSE /\ pending = TRUE /\ taken = FALSE /\ posts = 0
  /\ created = FALSE

(* The root fold re-homes the create onto the account root. *)
RootFold ==
  /\ ~folded
  /\ folded' = TRUE /\ held' = HoldOnFold
  /\ UNCHANGED <<accountHasSlot, listedAfterHold, expired, pending, taken,
                  posts, created>>

(* A drained listing of the account root's children. A listed twin folds   *)
(* the local copy, which deletes its create intent.                        *)
ListParent ==
  /\ folded /\ pending
  /\ listedAfterHold' = TRUE
  /\ pending' = (pending /\ ~accountHasSlot)
  /\ UNCHANGED <<accountHasSlot, folded, held, expired, taken, posts, created>>

Expire ==
  /\ held /\ ~listedAfterHold /\ ~expired /\ HoldBound
  /\ expired' = TRUE
  /\ UNCHANGED <<accountHasSlot, folded, held, listedAfterHold, pending, taken,
                  posts, created>>

MayPost == ~held \/ listedAfterHold \/ expired

(* The server takes the create when the slot is free. Otherwise a typed    *)
(* refusal is final; an untyped one looks stale and is retried.             *)
Post ==
  /\ folded /\ pending /\ ~taken /\ MayPost /\ posts < MaxPosts
  /\ posts' = posts + 1
  /\ IF accountHasSlot
       THEN /\ taken' = TypedSlotConflict
            /\ UNCHANGED <<pending, created>>
       ELSE /\ created' = TRUE /\ pending' = FALSE
            /\ UNCHANGED taken
  /\ UNCHANGED <<accountHasSlot, folded, held, listedAfterHold, expired>>

Next == RootFold \/ ListParent \/ Expire \/ Post \/ UNCHANGED vars

(* Listings may never complete: no fairness on ListParent. *)
Spec == Init /\ [][Next]_vars /\ WF_vars(RootFold) /\ WF_vars(Expire)
          /\ WF_vars(Post)

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
