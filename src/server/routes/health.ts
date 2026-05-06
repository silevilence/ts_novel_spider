import { Router } from 'express';

export interface HealthPayload {
  name: string;
  status: 'ok';
  timestamp: string;
}

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  const payload: HealthPayload = {
    name: 'ts-novel-spider',
    status: 'ok',
    timestamp: new Date().toISOString(),
  };

  response.json(payload);
});