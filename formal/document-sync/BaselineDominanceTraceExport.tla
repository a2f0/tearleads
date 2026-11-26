------------------ MODULE BaselineDominanceTraceExport ------------------
(* Exports every served behavior of the bounded BaselineDominance model as *)
(* one machine-readable line while TLC checks the base invariants. The     *)
(* generator in scripts/protocol/generateBaselineDominanceTraces.ts runs   *)
(* this configuration, canonicalizes the printed lines, and writes the    *)
(* committed fixture BaselineDominanceTraces.json, which the TypeScript    *)
(* replay suite drives through the real dominance and redirect kernels.    *)
(* A mutation that weakens Dominated, Older, or the raw-mode serve rule    *)
(* changes these exported behaviors and therefore fails either the trace   *)
(* fixture drift check or the kernel replay. The exported baseline flag is *)
(* the readable baseline, a whole signed group, whose coverage the kernels *)
(* receive. Which segment carries an update, and which segments are        *)
(* stored, are not exported: they decide whether a group is readable, and  *)
(* the kernels see only that.                                              *)
EXTENDS BaselineDominance, TLC

ASSUME Peers = {"a", "b"}
ASSUME UpdateCount = 2

ExportServedBehavior ==
  \/ phase # "served"
  \/ PrintT(<<"BDTRACE",
              currentEpoch,
              ReadableBaseline,
              historyMode,
              coverage["a"], coverage["b"],
              updates[1].epoch,
              updates[1].frontier["a"], updates[1].frontier["b"],
              updates[2].epoch,
              updates[2].frontier["a"], updates[2].frontier["b"],
              1 \in served, 2 \in served,
              Dominated(1), Dominated(2)>>)

====================================================================
