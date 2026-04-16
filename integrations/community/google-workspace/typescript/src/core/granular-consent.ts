import type { WorkspaceEvent } from "../types";

/**
 * Builds the response that triggers Google's granular consent prompt for
 * missing OAuth scopes. Per Google's HTTP add-on docs, when the add-on
 * needs scopes the user hasn't granted, return:
 *
 *   { "requesting_google_scopes": { "scopes": [...] } }
 *
 * Google then shows a consent screen for those scopes and re-runs the
 * action with the granted scopes available in `authorizationEventObject.authorizedScopes`.
 */
export function requestMissingScopes(scopes: string[]) {
  return {
    requesting_google_scopes: { scopes },
  };
}

/**
 * Returns the array of authorizedScopes from a workspace event,
 * or empty array if none.
 */
export function getAuthorizedScopes(event: WorkspaceEvent): string[] {
  return (
    (event.authorizationEventObject as any)?.authorizedScopes ?? []
  );
}

/**
 * Returns the scopes from `required` that are NOT in the event's
 * authorizedScopes list. If the result is non-empty, the caller should
 * return `requestMissingScopes(missing)` instead of attempting the action.
 */
export function findMissingScopes(
  event: WorkspaceEvent,
  required: string[],
): string[] {
  const granted = new Set(getAuthorizedScopes(event));
  return required.filter((s) => !granted.has(s));
}
