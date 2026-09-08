import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { canRunFullSync } from '../catalog/roles.js';
import { GhostAdminClient, GhostApiError } from '../ghost/client.js';
import { normalizeSiteUrl } from '../ghost/urls.js';
import { SESSION_COOKIE_NAME } from '../sessions.js';
import { asyncRoute, readCookie, type AppContext } from './context.js';

const staffTokenSchema = z.object({
  siteUrl: z.string().min(1).optional(),
  token: z.string().min(1),
});

export function authRoutes({ config, sessions, loginFetch }: AppContext): Router {
  const router = Router();

  /** Normalises the requested site, or writes a 400 and returns null. */
  function resolveSiteUrl(res: Response, requested: string | undefined): string | null {
    // A configured GHOST_URL pins the deployment to one site; without it the
    // user names the site, which is what makes this usable against staging.
    const wanted = config.ghostUrl ?? requested;
    if (!wanted) {
      res.status(400).json({ error: 'A Ghost site URL is required.' });
      return null;
    }
    try {
      return normalizeSiteUrl(wanted);
    } catch {
      res.status(400).json({ error: `"${wanted}" is not a valid site URL.` });
      return null;
    }
  }

  /** Maps a Ghost failure onto an HTTP status the UI can act on. */
  function sendGhostError(res: Response, error: unknown, siteUrl: string): void {
    if (error instanceof GhostApiError) {
      const status = error.status === 422 ? 401 : error.status;
      res.status(status >= 400 && status < 600 ? status : 502).json({ error: error.message });
      return;
    }
    res.status(502).json({
      error: `Could not reach ${siteUrl}. Check the site URL and that it is online.`,
    });
  }

  router.get('/me', (req, res) => {
    const session = sessions.get(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
    if (!session) {
      res.json({ signedIn: false, lockedSiteUrl: config.ghostUrl });
      return;
    }
    res.json({
      signedIn: true,
      siteUrl: session.siteUrl,
      email: session.email,
      role: session.role,
      canSync: canRunFullSync(session.role),
    });
  });

  router.post(
    '/staff-token',
    asyncRoute(async (req, res) => {
      const parsed = staffTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'A Ghost staff token is required.' });
        return;
      }

      const siteUrl = resolveSiteUrl(res, parsed.data.siteUrl);
      if (!siteUrl) return;

      let client: GhostAdminClient;
      try {
        client = GhostAdminClient.fromStaffToken(siteUrl, parsed.data.token, loginFetch);
      } catch (error) {
        sendGhostError(res, error, siteUrl);
        return;
      }

      try {
        const site = await client.getSite();
        const { email, role } = await client.getCurrentUser();
        const session = sessions.create(siteUrl, email, client, role);

        res.cookie(SESSION_COOKIE_NAME, session.id, {
          httpOnly: true,
          sameSite: 'lax',
          // Correct only because `app.set('trust proxy', …)` is configured; see
          // config.ts. Behind a TLS-terminating proxy this is what keeps the
          // session cookie from going out without `Secure`.
          secure: req.secure,
          maxAge: config.sessionTtlMs,
        });
        res.json({
          signedIn: true,
          siteUrl,
          email,
          role,
          canSync: canRunFullSync(role),
          site,
        });
      } catch (error) {
        sendGhostError(res, error, siteUrl);
      }
    }),
  );

  router.post('/logout', (req, res) => {
    sessions.destroy(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ signedIn: false });
  });

  return router;
}
