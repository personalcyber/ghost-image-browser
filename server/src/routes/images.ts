import { Router } from 'express';
import { z } from 'zod';
import { getImage, listImages, countImages, saveMetadata } from '../catalog/repo.js';
import { asyncRoute, requireSession, type AppContext } from './context.js';

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  usage: z.enum(['feature_image', 'content', 'og_image', 'twitter_image']).optional(),
  unused: z.enum(['true', 'false']).optional(),
  internal: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const metadataSchema = z
  .object({
    altText: z.string().max(1000),
    caption: z.string().max(2000),
    credit: z.string().max(500),
    license: z.string().max(500),
    notes: z.string().max(10000),
    tags: z.array(z.string().trim().min(1).max(60)).max(50),
  })
  .partial();

export function imageRoutes({ db, sessions }: AppContext): Router {
  const router = Router();
  router.use(requireSession(sessions));

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid filter parameters.' });
        return;
      }
      const siteUrl = req.session!.siteUrl;
      const { q, usage, unused, internal, limit, offset } = parsed.data;
      const filter = {
        siteUrl,
        query: q,
        usage,
        unusedOnly: unused === 'true',
        internalOnly: internal === 'true',
      };

      res.json({
        total: countImages(db, filter),
        images: listImages(db, { ...filter, limit, offset }),
      });
    }),
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      const image = Number.isInteger(id) ? getImage(db, req.session!.siteUrl, id) : null;
      if (!image) {
        res.status(404).json({ error: 'No such image in this catalog.' });
        return;
      }
      res.json({ image });
    }),
  );

  router.put(
    '/:id/metadata',
    asyncRoute(async (req, res) => {
      const id = Number(req.params.id);
      const image = Number.isInteger(id) ? getImage(db, req.session!.siteUrl, id) : null;
      if (!image) {
        res.status(404).json({ error: 'No such image in this catalog.' });
        return;
      }

      const parsed = metadataSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid metadata.', issues: parsed.error.issues });
        return;
      }

      const metadata = saveMetadata(db, id, parsed.data, new Date().toISOString());
      res.json({ metadata });
    }),
  );

  return router;
}
