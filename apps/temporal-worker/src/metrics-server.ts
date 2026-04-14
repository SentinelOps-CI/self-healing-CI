import express from 'express';
import {
  AlertingService,
  createDefaultAlertingConfig,
} from './services/alerting';
import { getMetrics } from './services/metrics';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env['METRICS_PORT'] || 9090;

// Initialize alerting service
const alertingService = new AlertingService(createDefaultAlertingConfig());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'self-healing-ci-metrics',
    version: '1.0.0',
  });
});

// Readiness check endpoint
app.get('/ready', (_req, res) => {
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    service: 'self-healing-ci-metrics',
    version: '1.0.0',
  });
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    const metrics = await getMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    logger.error('Failed to get metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to get metrics',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Alert statistics endpoint
app.get('/alerts/stats', (_req, res) => {
  try {
    const stats = alertingService.getAlertStatistics();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get alert statistics', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to get alert statistics',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Active alerts endpoint
app.get('/alerts/active', (_req, res) => {
  try {
    const alerts = alertingService.getActiveAlerts();
    res.json(alerts);
  } catch (error) {
    logger.error('Failed to get active alerts', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to get active alerts',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Acknowledge alert endpoint
app.post('/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    const { alertId } = req.params;
    await alertingService.acknowledgeAlert(alertId);
    res.json({ success: true, message: 'Alert acknowledged' });
  } catch (error) {
    logger.error('Failed to acknowledge alert', {
      alertId: req.params.alertId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to acknowledge alert',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Resolve alert endpoint
app.post('/alerts/:alertId/resolve', async (req, res) => {
  try {
    const { alertId } = req.params;
    await alertingService.resolveAlert(alertId);
    res.json({ success: true, message: 'Alert resolved' });
  } catch (error) {
    logger.error('Failed to resolve alert', {
      alertId: req.params.alertId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to resolve alert',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Cleanup old alerts endpoint
app.post('/alerts/cleanup', (req, res) => {
  try {
    const maxAgeMs = req.body.maxAgeMs || 7 * 24 * 60 * 60 * 1000; // 7 days default
    alertingService.cleanupOldAlerts(maxAgeMs);
    res.json({ success: true, message: 'Old alerts cleaned up' });
  } catch (error) {
    logger.error('Failed to cleanup old alerts', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to cleanup old alerts',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// SLO compliance endpoint
app.get('/slo/:repository', (req, res) => {
  try {
    const { repository } = req.params;
    // This would typically query metrics to calculate current SLO compliance
    // For now, return a placeholder response
    res.json({
      repository,
      slos: {
        mttr: {
          p95: '≤ 5min',
          p99: '≤ 15min',
          current: 'calculating...',
          compliant: true,
        },
        diagnosis_accuracy: {
          target: '≥ 95%',
          current: 'calculating...',
          compliant: true,
        },
        proof_success_rate: {
          target: '≥ 95%',
          current: 'calculating...',
          compliant: true,
        },
        patch_success_rate: {
          target: '≥ 90%',
          current: 'calculating...',
          compliant: true,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get SLO compliance', {
      repository: req.params.repository,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: 'Failed to get SLO compliance',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Error handling middleware
app.use(
  (
    error: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error('Unhandled error in metrics server', {
      error: error.message,
      stack: error.stack,
      url: req.url,
      method: req.method,
    });

    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
);

// Start the server
export function startMetricsServer(): void {
  app.listen(PORT, () => {
    logger.info('Metrics server started', {
      port: PORT,
      endpoints: [
        '/health',
        '/ready',
        '/metrics',
        '/alerts/stats',
        '/alerts/active',
        '/alerts/:alertId/acknowledge',
        '/alerts/:alertId/resolve',
        '/alerts/cleanup',
        '/slo/:repository',
      ],
    });
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down metrics server gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down metrics server gracefully');
  process.exit(0);
});

// Export the app for testing
export { app };
