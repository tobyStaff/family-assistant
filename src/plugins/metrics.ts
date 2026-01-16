// src/plugins/metrics.ts
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { register, collectDefaultMetrics, Gauge, Counter, Histogram } from 'prom-client';

/**
 * Metrics Plugin
 * Exposes Prometheus metrics at /metrics endpoint
 * Includes default Node.js metrics and custom application metrics
 */
async function metricsPlugin(fastify: FastifyInstance) {
  // Enable default metrics (heap, CPU, event loop, etc.)
  collectDefaultMetrics({
    register,
    prefix: 'inbox_manager_',
  });

  // Custom metric: Current heap usage
  const heapGauge = new Gauge({
    name: 'inbox_manager_heap_usage_bytes',
    help: 'Current heap memory usage in bytes',
    registers: [register],
  });

  // Custom metric: Request duration histogram
  const httpRequestDuration = new Histogram({
    name: 'inbox_manager_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  // Custom metric: Total requests counter
  const httpRequestsTotal = new Counter({
    name: 'inbox_manager_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  // Custom metric: Daily summaries sent
  const dailySummariesSent = new Counter({
    name: 'inbox_manager_daily_summaries_sent_total',
    help: 'Total number of daily summary emails sent',
    labelNames: ['status'],
    registers: [register],
  });

  // Custom metric: Emails processed
  const emailsProcessed = new Counter({
    name: 'inbox_manager_emails_processed_total',
    help: 'Total number of emails processed',
    labelNames: ['status'],
    registers: [register],
  });

  // Set initial heap value
  heapGauge.set(process.memoryUsage().heapUsed);

  // Update heap gauge periodically
  const heapInterval = setInterval(() => {
    const memUsage = process.memoryUsage();
    heapGauge.set(memUsage.heapUsed);
  }, 10000);

  // Hook to track request duration and count
  fastify.addHook('onRequest', async (request) => {
    (request as any).startTime = Date.now();
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const duration = (Date.now() - (request as any).startTime) / 1000;
    const route = request.routeOptions.url || request.url;
    const method = request.method;
    const statusCode = reply.statusCode.toString();

    httpRequestDuration.observe(
      {
        method,
        route,
        status_code: statusCode,
      },
      duration
    );

    httpRequestsTotal.inc({
      method,
      route,
      status_code: statusCode,
    });
  });

  // Expose metrics endpoint
  fastify.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  // Expose metric counters for use in other plugins
  fastify.decorate('metrics', {
    dailySummariesSent,
    emailsProcessed,
  });

  // Clean up interval on close
  fastify.addHook('onClose', async () => {
    clearInterval(heapInterval);
  });

  fastify.log.info('Metrics plugin registered - /metrics endpoint available');
}

// Export as Fastify plugin
export default fp(metricsPlugin, {
  name: 'metrics-plugin',
});
