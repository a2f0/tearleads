----------------------- MODULE OrganizationScope -----------------------
EXTENDS Naturals
CONSTANTS RequireDirectoryScope, RequireDirectoryHead,
          RequireReferenceCurrent, RequireParentScope
VARIABLES expectedOrg, directoryOrg, groupBranch, directoryVersion,
          referenceVersion, parentOrg, cacheAttempted, cached,
          parentAttempted, parentAccepted, groupHead
vars == <<expectedOrg, directoryOrg, groupBranch, directoryVersion,
          referenceVersion, parentOrg, cacheAttempted, cached,
          parentAttempted, parentAccepted, groupHead>>
fixed == <<expectedOrg, directoryOrg, groupBranch, directoryVersion,
           referenceVersion, parentOrg, groupHead>>
Orgs == {"A", "B"}
(* The verified policy contains versions 1 and 2 on one authenticated chain; *)
(* the group may advance to 3, and an honest directory follows it.           *)
DirectoryBindsChain == directoryOrg = groupBranch /\ directoryVersion = groupHead
HasScopeProof == directoryOrg = expectedOrg /\ DirectoryBindsChain

Init ==
  /\ expectedOrg \in Orgs /\ directoryOrg \in Orgs /\ groupBranch \in Orgs
  /\ groupHead = 2
  /\ directoryVersion \in 1..2 /\ referenceVersion \in 1..2
  /\ parentOrg \in Orgs
  /\ cacheAttempted = FALSE /\ cached = FALSE
  /\ parentAttempted = FALSE /\ parentAccepted = FALSE

WarmPolicy ==
  /\ ~cacheAttempted
  /\ cacheAttempted' = TRUE
  /\ cached' = ((~RequireDirectoryScope \/ directoryOrg = expectedOrg)
                /\ (~RequireDirectoryHead \/ DirectoryBindsChain)
                /\ (~RequireReferenceCurrent \/ referenceVersion = groupHead))
  /\ UNCHANGED <<fixed, parentAttempted, parentAccepted>>

ChooseParent ==
  /\ ~parentAttempted
  /\ parentAttempted' = TRUE
  /\ parentAccepted' = (~RequireParentScope \/ parentOrg = expectedOrg)
  /\ UNCHANGED <<fixed, cacheAttempted, cached>>

(* The group commits version 3 before any cache attempt; a directory that  *)
(* bound the old head binds the new one, so a reference to 2 is now history. *)
AdvanceDirectory ==
  /\ ~cacheAttempted /\ groupHead = 2
  /\ groupHead' = 3
  /\ directoryVersion' = IF directoryVersion = 2 THEN 3 ELSE directoryVersion
  /\ UNCHANGED <<expectedOrg, directoryOrg, groupBranch, referenceVersion, parentOrg,
                  cacheAttempted, cached, parentAttempted, parentAccepted>>

Next == WarmPolicy \/ ChooseParent \/ AdvanceDirectory \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ {expectedOrg, directoryOrg, groupBranch, parentOrg} \subseteq Orgs
  /\ {directoryVersion, referenceVersion} \subseteq 1..3 /\ groupHead \in 2..3
  /\ {cacheAttempted, cached, parentAttempted, parentAccepted} \subseteq BOOLEAN
CachedGroupsHaveSignedScope == cached => HasScopeProof
HistoricalReferencesRemainCacheable == (cacheAttempted /\ HasScopeProof) => cached
ParentEdgesStayInOrganization == parentAccepted => parentOrg = expectedOrg
========================================================================
