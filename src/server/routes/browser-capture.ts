import { Router } from 'express';

import { BrowserCaptureService } from '../core/browser-capture';

export function createBrowserCaptureRouter(capture: BrowserCaptureService): Router {
  const router = Router();

  router.post('/pair', (request, response) => {
    try {
      const body = (request.body ?? {}) as { token?: unknown; name?: unknown };
      if (typeof body.token !== 'string' || !body.token.trim()) throw new Error('Pairing token is required.');
      const name = typeof body.name === 'string' ? body.name : 'Browser extension';
      const result = capture.exchangePairingToken(body.token.trim(), name);
      response.status(201).json({
        key: result.key,
        pairing: {
          id: result.pairing.id,
          name: result.pairing.name,
          createdAt: result.pairing.createdAt,
        },
      });
    } catch (error) {
      response.status(401).json({ message: error instanceof Error ? error.message : 'Browser pairing failed.' });
    }
  });

  router.use((request, response, next) => {
    const authorization = request.header('authorization');
    const key = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    const pairing = capture.authenticateKey(key);
    if (!pairing) {
      response.status(401).json({ message: 'A valid browser pairing key is required.' });
      return;
    }
    response.locals.browserPairingId = pairing.id;
    next();
  });

  router.get('/status', (_request, response) => {
    response.json(capture.getStatus());
  });

  router.delete('/pairing', (_request, response) => {
    const pairingId = response.locals.browserPairingId as string;
    capture.revokePairing(pairingId);
    response.status(204).end();
  });

  return router;
}
