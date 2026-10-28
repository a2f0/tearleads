---------------------- MODULE BlobSourceAuthority ----------------------
EXTENDS Naturals
CONSTANTS CheckSourceAuthority, CheckDestinationWrite
ASSUME {CheckSourceAuthority, CheckDestinationWrite} \subseteq BOOLEAN
VARIABLES sourceReadable, ciphertextAuthor, destinationWritable, bound
vars == <<sourceReadable, ciphertextAuthor, destinationWritable, bound>>
Init ==
  /\ sourceReadable \in BOOLEAN
  /\ ciphertextAuthor \in BOOLEAN
  /\ destinationWritable \in BOOLEAN
  /\ bound = FALSE
(* A bind request may come from any reader; the API checks both ends. *)
Bind ==
  /\ CheckDestinationWrite => destinationWritable
  /\ ~CheckSourceAuthority \/ sourceReadable \/ ciphertextAuthor
  /\ bound' = TRUE
  /\ UNCHANGED <<sourceReadable, ciphertextAuthor, destinationWritable>>
Next == Bind \/ UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == {sourceReadable, ciphertextAuthor, destinationWritable, bound} \subseteq BOOLEAN
BoundBytesHaveSourceAuthority == bound => (sourceReadable \/ ciphertextAuthor)
DestinationWriteIsRequired == bound => destinationWritable
=============================================================================
