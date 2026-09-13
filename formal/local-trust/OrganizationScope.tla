----------------------- MODULE OrganizationScope -----------------------
EXTENDS Naturals
CONSTANTS RequireDirectoryScope, RequireDirectoryHead,
          RequireReferenceCurrent, RequireParentScope
VARIABLES expectedOrg, directoryOrg, groupBranch, directoryVersion,
          referenceVersion, parentOrg, cacheAttempted, cached,
          parentAttempted, parentAccepted
vars == <<expectedOrg, directoryOrg, groupBranch, directoryVersion,
          referenceVersion, parentOrg, cacheAttempted, cached,
          parentAttempted, parentAccepted>>
fixed == <<expectedOrg, directoryOrg, groupBranch, directoryVersion,
           referenceVersion, parentOrg>>
Orgs == {"A", "B"}
(* The verified policy contains versions 1 and 2 on one authenticated chain. *)
GroupHead == 2
DirectoryBindsChain == directoryOrg = groupBranch /\ directoryVersion = GroupHead
HasScopeProof == directoryOrg = expectedOrg /\ DirectoryBindsChain

Init ==
  /\ expectedOrg \in Orgs /\ directoryOrg \in Orgs /\ groupBranch \in Orgs
  /\ directoryVersion \in 1..2 /\ referenceVersion \in 1..2
  /\ parentOrg \in Orgs
  /\ cacheAttempted = FALSE /\ cached = FALSE
  /\ parentAttempted = FALSE /\ parentAccepted = FALSE

WarmPolicy ==
  /\ ~cacheAttempted
  /\ cacheAttempted' = TRUE
  /\ cached' = ((~RequireDirectoryScope \/ directoryOrg = expectedOrg)
                /\ (~RequireDirectoryHead \/ DirectoryBindsChain)
                /\ (~RequireReferenceCurrent \/ referenceVersion = GroupHead))
  /\ UNCHANGED <<fixed, parentAttempted, parentAccepted>>

ChooseParent ==
  /\ ~parentAttempted
  /\ parentAttempted' = TRUE
  /\ parentAccepted' = (~RequireParentScope \/ parentOrg = expectedOrg)
  /\ UNCHANGED <<fixed, cacheAttempted, cached>>

Next == WarmPolicy \/ ChooseParent \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK ==
  /\ {expectedOrg, directoryOrg, groupBranch, parentOrg} \subseteq Orgs
  /\ {directoryVersion, referenceVersion} \subseteq 1..2
  /\ {cacheAttempted, cached, parentAttempted, parentAccepted} \subseteq BOOLEAN
CachedGroupsHaveSignedScope == cached => HasScopeProof
HistoricalReferencesRemainCacheable == (cacheAttempted /\ HasScopeProof) => cached
ParentEdgesStayInOrganization == parentAccepted => parentOrg = expectedOrg
========================================================================
