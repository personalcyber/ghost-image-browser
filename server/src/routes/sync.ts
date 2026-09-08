import { Router } from 'express';
import { canRunFullSync } from '../catalog/roles.js';
import { getLastSync, syncCatalog } from '../catalog/sync.js';
import { GhostApiError } from '../ghost/client.js';
import { asyncRoute, requireSession, type AppContext } from './context.js';

export function syncRoutes({ db, sessions }: AppContext): Router {
  const router = Router();
  router.use(requireSession(sessions));

  // One sync per site at a time: a second concurrent run would interleave
  // timestamps and prune the first run's references out from under it.
  const inFlight = new Set<string>();

  router.get('/', (req, res) => {
    res.json({ lastSync: getLastSync(db, req.session!.siteUrl) });
  });

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const { siteUrl, client, role } = req.session!;

      // Ghost only returns the posts this role can see. A partial-visibility
      // role (Author, Contributor) syncing would prune every other
      // contributor's references from the shared catalog.
      if (!canRunFullSync(role)) {
        res.status(403).json({
          error:
            'Your Ghost role can only see your own posts, so running a sync would ' +
            "remove other people's images from the catalog. Ask an Editor or " +
            'Administrator to sync.',
        });
        return;
      }

      if (inFlight.has(siteUrl)) {
        res.status(409).json({ error: 'A sync is already running for this site.' });
        return;
      }

      inFlight.add(siteUrl);
      try {
        res.json({ result: await syncCatalog(db, client) });
      } catch (error) {
        if (error instanceof GhostApiError) {
          res.status(error.status === 401 || error.status === 403 ? 401 : 502).json({
            error: `Ghost rejected the sync: ${error.message}`,
          });
          return;
        }
        throw error;
      } finally {
        inFlight.delete(siteUrl);
      }
    }),
  );

  return router;
}
