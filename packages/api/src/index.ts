import type { PingData } from '@rapid/shared';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Express, type Request, type Response } from 'express';
import packageJson from '../package.json' with { type: 'json' };

dotenv.config();

const app: Express = express();

const PORT = Number(process.env['PORT']) || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/v1/ping', (_req: Request, res: Response) => {
  const pingData: PingData = {
    version: packageJson.version
  };
  res.status(200).json(pingData);
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Export app for testing
export { app };

// Start server only when run directly
if (process.env['NODE_ENV'] !== 'test') {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}
