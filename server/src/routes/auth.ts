import { Router } from 'express';
import { z } from 'zod';
import { GhostAdminClient, GhostApiError } from '../ghost/client.js';
import { normalizeSiteUrl } from '../ghost/urls.js';
import { SESSION_COOKIE_NAME } from '../sessions.js';
import { asyncRoute, readCookie, type AppContext } from './context.js';

const loginSchema = z.object({
  siteUrl: z.string().min(1).optional(),
  email: z.email(),
  password: z.string().min(1),
});

export function authRoutes({ config, sessions }: AppContext): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    const session = sessions.get(readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
    if (!session) {
      res.json({ signedIn: false, lockedSiteUrl: config.ghostUrl });
      return;
    }
    res.json({ signedIn: true, siteUrl: session.siteUrl, email: session.email });
  });

  router.post(
    '/login',
    asyncRoute(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'A valid email and password are required.' });
        return;
      }

      // A configured GHOST_URL pins the deployment to one site; without it the
      // user names the site, which is what makes this usable against staging.
      const requestedSite = config.ghostUrl ?? parsed.data.siteUrl;
      if (!requestedSite) {
        res.status(400).json({ error: 'A Ghost site URL is required.' });
        return;
      }

      let siteUrl: string;
      try {
        siteUrl = normalizeSiteUrl(requestedSite);
      } catch {
        res.status(400).json({ error: `"${requestedSite}" is not a valid site URL.` });
        return;
      }

      try {
        const client = await GhostAdminClient.login(
          siteUrl,
          parsed.data.email,
          parsed.data.password,
        );
        const site = await client.getSite();
        const session = sessions.create(siteUrl, parsed.data.email, client);

        res.cookie(SESSION_COOKIE_NAME, session.id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: req.secure,
          maxAge: config.sessionTtlMs,
        });
        res.json({ signedIn: true, siteUrl, email: parsed.data.email, site });
      } catch (error) {
        if (error instanceof GhostApiError) {
          // Ghost answers a bad password with 422; surface it as 401 so the UI
          // can treat every credential failure the same way.
          const status = error.status === 422 ? 401 : error.status;
          res.status(status >= 400 && status < 600 ? status : 502).json({ error: error.message });
          return;
        }
        res.status(502).json({
          error: `Could not reach ${siteUrl}. Check the site URL and that it is online.`,
        });
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
