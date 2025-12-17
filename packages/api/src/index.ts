import { formatDate, type HealthData } from '@rapid/shared';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';

dotenv.config();

const app = express();

const PORT = Number(process.env['PORT']) || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/v1/health', (_req: Request, res: Response) => {
  const healthData: HealthData = {
    status: 'healthy',
    timestamp: formatDate(new Date()),
    uptime: process.uptime()
  };
  res.status(200).json(healthData);
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
