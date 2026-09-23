# Realtime hint privacy

Realtime hints request HTTP refreshes; they do not establish content or access.
The gateway routes container mutations to watchers of the container and its
current and previous parents, then constructs a frame for each recipient's
verified interests.

- A watcher of the mutated container receives `container_mutation_created` with
  its id and event type. Parent ids appear only when that socket watches them;
  a null parent denotes the root.
- A parent-only watcher receives `container_children_changed` with only the
  parent ids it watches. It receives no child id, event type, other parent id,
  author session, or mutation timestamp. The SDK refreshes those parent listings,
  whose HTTP access checks determine which children it can discover.
- Descendant watchers retain `container_path_changed` for their own dependent
  paths; this does not reveal the mutated ancestor.

A parent refresh still reveals that something changed and when the notification
arrived. This contract minimizes event details; it does not hide traffic timing.
It is a greenfield wire change with no compatibility translation.
