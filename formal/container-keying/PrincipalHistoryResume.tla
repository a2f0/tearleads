----------------------- MODULE PrincipalHistoryResume ----------------------
EXTENDS Naturals
CONSTANTS MaxVersion, TrustUnsealed, IgnoreBinding, ForgetAuthority
ASSUME /\ MaxVersion > 1
       /\ {TrustUnsealed, IgnoreBinding, ForgetAuthority} \subseteq BOOLEAN
VARIABLES through, checked, authority, observed, savedThrough, savedAuthority,
          usedBinding, phase
vars == <<through, checked, authority, observed, savedThrough, savedAuthority,
          usedBinding, phase>>
OwnBinding == 1
Init == /\ through = 0 /\ checked = 0 /\ authority = 0 /\ observed = 0
        /\ savedThrough = 0 /\ savedAuthority = 0
        /\ usedBinding = OwnBinding /\ phase = "live"
\* A step abstracts an already checked page. Zero means no authority citation.
VerifyPage(citation) ==
  /\ phase = "live" /\ through < MaxVersion
  /\ citation = 0 \/ citation >= authority
  /\ through' = through + 1 /\ checked' = checked + 1
  /\ authority' = IF citation = 0 THEN authority ELSE citation
  /\ observed' = IF citation > observed THEN citation ELSE observed
  /\ UNCHANGED <<savedThrough, savedAuthority, usedBinding, phase>>
Save == /\ phase = "live"
        /\ savedThrough' = through /\ savedAuthority' = authority
        /\ UNCHANGED <<through, checked, authority, observed, usedBinding, phase>>
Crash == /\ phase = "live" /\ phase' = "lost"
         /\ through' = 0 /\ checked' = 0 /\ authority' = 0 /\ observed' = 0
         /\ UNCHANGED <<savedThrough, savedAuthority, usedBinding>>
\* Equality abstracts authenticated bytes. Binding abstracts the local key,
\* revision, operation context, principal scope, checkpoint and reference set.
Restore(offeredThrough, offeredAuthority, requestedBinding) ==
  /\ phase = "lost"
  /\ TrustUnsealed \/ (offeredThrough = savedThrough /\ offeredAuthority = savedAuthority)
  /\ IgnoreBinding \/ requestedBinding = OwnBinding
  /\ through' = offeredThrough /\ checked' = savedThrough
  /\ authority' = IF ForgetAuthority THEN 0 ELSE offeredAuthority
  /\ observed' = savedAuthority /\ usedBinding' = requestedBinding
  /\ phase' = "live" /\ UNCHANGED <<savedThrough, savedAuthority>>
Next == (\E citation \in 0..2: VerifyPage(citation)) \/ Save \/ Crash
        \/ (\E offeredThrough \in 0..MaxVersion, offeredAuthority \in 0..2,
                requestedBinding \in 1..2:
              Restore(offeredThrough, offeredAuthority, requestedBinding))
Spec == Init /\ [][Next]_vars
TypeOK == /\ through \in 0..MaxVersion /\ checked \in 0..MaxVersion
          /\ authority \in 0..2 /\ observed \in 0..2
          /\ savedThrough \in 0..MaxVersion /\ savedAuthority \in 0..2
          /\ usedBinding \in 1..2 /\ phase \in {"live", "lost"}
NoInventedProgress == through = checked
ProgressBinding == phase = "live" => usedBinding = OwnBinding
AuthorityProgress == authority = observed
=============================================================================
