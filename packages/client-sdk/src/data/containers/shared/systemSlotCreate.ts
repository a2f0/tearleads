/**
 * Recorded on a queued system-slot create that a root fold re-homed onto a
 * server root. That root may already hold the slot, and the listing of its
 * children that shows it folds this copy instead, so the create waits for one.
 */
export const CONTAINER_CREATE_AWAITS_PARENT_LISTING =
  "Container create waits for a listing of its parent";

/**
 * Recorded once the server refused a create because its organization already
 * holds the system slot. The same create never succeeds; a listing that shows
 * the held container folds this copy into it.
 */
export const CONTAINER_SYSTEM_SLOT_TAKEN_MESSAGE =
  "Container system slot is already taken";
