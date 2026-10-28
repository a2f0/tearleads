----------------------- MODULE PrincipalHistoryPages -----------------------
EXTENDS Naturals
CONSTANTS MaxVersion, PublishEarly, ForgetAuthority,
          RefuseCitationRegression, \* refuse a page citing below the held authority
          RequireUnchangedAuthority \* over-strict, no production seam
ASSUME /\ MaxVersion > 1
       /\ {PublishEarly, ForgetAuthority, RefuseCitationRegression,
           RequireUnchangedAuthority} \subseteq BOOLEAN
VARIABLES through, checked, authority, observed, stagedThrough, stagedAuthority,
          valid, phase, honestRefused
vars == <<through, checked, authority, observed, stagedThrough, stagedAuthority,
          valid, phase, honestRefused>>

Init == /\ through = 0 /\ checked = 0 /\ authority = 0 /\ observed = 0
        /\ stagedThrough = 0 /\ stagedAuthority = 0 /\ valid = FALSE
        /\ phase = "idle" /\ honestRefused = FALSE
\* Validity summarizes signatures, commitments, contiguous predecessors and
\* signer/rotation checks on a nonempty page. Zero means no authority citation.
Stage(last, citation, checksPass) ==
  /\ phase = "idle" /\ through < last /\ last <= MaxVersion
  /\ stagedThrough' = last /\ stagedAuthority' = citation
  /\ valid' = checksPass /\ phase' = "staged"
  /\ through' = IF PublishEarly THEN last ELSE through
  /\ UNCHANGED <<checked, authority, observed, honestRefused>>
\* An honest page is valid and never cites below the authority it extends.
HonestPage == valid /\ (stagedAuthority = 0 \/ stagedAuthority >= authority)
Acceptable ==
  /\ valid
  /\ RefuseCitationRegression => (stagedAuthority = 0 \/ stagedAuthority >= authority)
  /\ RequireUnchangedAuthority => stagedAuthority \in {0, authority}
Accept ==
  /\ phase = "staged" /\ Acceptable
  /\ through' = stagedThrough /\ checked' = stagedThrough
  /\ authority' = IF ForgetAuthority \/ stagedAuthority # 0
                  THEN stagedAuthority ELSE authority
  /\ observed' = IF stagedAuthority > observed THEN stagedAuthority ELSE observed
  /\ phase' = "idle"
  /\ UNCHANGED <<stagedThrough, stagedAuthority, valid, honestRefused>>
Reject == /\ phase = "staged"
          /\ ~Acceptable
          /\ honestRefused' = (honestRefused \/ HonestPage)
          /\ phase' = "idle"
          /\ UNCHANGED <<through, checked, authority, observed,
                         stagedThrough, stagedAuthority, valid>>
Finished == /\ phase = "idle" /\ through = MaxVersion /\ UNCHANGED vars
Next == (\E last \in 1..MaxVersion, citation \in 0..2, checksPass \in BOOLEAN:
          Stage(last, citation, checksPass)) \/ Accept \/ Reject \/ Finished
Spec == Init /\ [][Next]_vars
TypeOK == /\ through \in 0..MaxVersion /\ checked \in 0..MaxVersion
          /\ authority \in 0..2 /\ observed \in 0..2
          /\ stagedThrough \in 0..MaxVersion /\ stagedAuthority \in 0..2
          /\ valid \in BOOLEAN /\ phase \in {"idle", "staged"}
          /\ honestRefused \in BOOLEAN
OnlyCheckedPagesAdvance == through = checked
AuthorityProgress == authority = observed
\* The checks refuse only forged or regressing pages, never an honest one.
HonestPagesAccepted == ~honestRefused
=============================================================================
