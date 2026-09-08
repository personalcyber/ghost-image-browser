/**
 * Which Ghost staff roles may run a catalog sync.
 *
 * The catalog is shared per site and sync prunes every reference the run did
 * not re-record. Ghost's Admin API only returns the posts the signed-in role
 * can see, so a role with partial visibility (Author, Contributor) would prune
 * everyone else's references and wrongly mark their images unused. Only roles
 * that see every post on the site are allowed to sync.
 */
const FULL_VISIBILITY_ROLES = new Set(['Owner', 'Administrator', 'Editor']);

export function canRunFullSync(role: string): boolean {
  return FULL_VISIBILITY_ROLES.has(role);
}
