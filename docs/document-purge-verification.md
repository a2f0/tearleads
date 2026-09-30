# Document purge verification

Document purge is a signed terminal event committing the document head and sole
authorizing container head. Its signer must have write access through that
path. The API retains evidence after deletion. Full history requires a prior
signed-head observation by that caller. A coded not-found response only prompts
proof fetching; deletion requires an exact local document pin or every signed
transition from a pin or signed genesis. A hash-only snapshot cannot advance a
checkpoint. A later pinned head anywhere on the authorizing path, including an
ancestor, leaves purge ordering unavailable: ancestry cannot order the separate
purge signature relative to that later head. The client authenticates the proof
and checks document, policy, and visible container forks before classifying this
as `ProjectionDependencyUnavailableError`. It retains local data without an
integrity incident or an automatic sync retry loop. Currency is checked again
inside the atomic local-deletion transaction, so a racing checkpoint advance
rolls back teardown. Actual invalid signatures and conflicting checkpoints remain
integrity errors. The retained purge-time proof alone cannot resolve this ordering
ambiguity; eventual deletion after a later path checkpoint is not guaranteed.
