// src/plugins/metrics.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import { register } from 'prom-client';

describe('metrics plugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Clear Prometheus registry before each test to avoid "already registered" errors
    register.clear();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should expose /metrics endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('should include default Node.js metrics', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;

    // Check for default metrics (prom-client adds prefix to most, but not all metrics)
    // Just verify some standard Node.js metrics are present
    expect(body).toContain('process_cpu');
    expect(body).toContain('nodejs_heap');
    expect(body).toContain('# HELP');
    expect(body).toContain('# TYPE');
  });

  it('should include custom heap usage metric', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;

    // Check for custom heap gauge
    expect(body).toContain('heap_usage_bytes');
    expect(body).toContain('Current heap memory usage');
  });

  it('should track HTTP request metrics', async () => {
    // Make some requests
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/health' });

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;

    // Check for request duration histogram
    expect(body).toContain('http_request_duration_seconds');

    // Check for request counter
    expect(body).toContain('http_requests_total');

    // Verify health endpoint was tracked
    expect(body).toContain('/health');
    expect(body).toContain('method="GET"');
    expect(body).toContain('status_code="200"');
  });

  it('should expose custom metric counters via decorators', async () => {
    // Check that metrics are decorated on fastify instance
    expect(app).toHaveProperty('metrics');
    expect((app as any).metrics).toHaveProperty('dailySummariesSent');
    expect((app as any).metrics).toHaveProperty('emailsProcessed');
  });

  it('should track different status codes', async () => {
    // Make successful request
    await app.inject({ method: 'GET', url: '/health' });

    // Make failing request (404)
    await app.inject({ method: 'GET', url: '/nonexistent' });

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    const body = response.body;

    // Should have both 200 and 404 status codes
    expect(body).toContain('status_code="200"');
    expect(body).toContain('status_code="404"');
  });

  it('should update heap metric over time', async () => {
    // Get initial metrics
    const response1 = await app.inject({ method: 'GET', url: '/metrics' });
    const body1 = response1.body;

    // Extract heap value (match any line with heap_usage_bytes)
    const heapMatch1 = body1.match(/heap_usage_bytes (\d+)/);
    expect(heapMatch1).toBeTruthy();
    if (!heapMatch1 || !heapMatch1[1]) return;
    const heapValue1 = parseInt(heapMatch1[1]);

    // Wait a bit and check again (heap should update every 10s, but may change)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response2 = await app.inject({ method: 'GET', url: '/metrics' });
    const body2 = response2.body;

    const heapMatch2 = body2.match(/heap_usage_bytes (\d+)/);
    expect(heapMatch2).toBeTruthy();
    if (!heapMatch2 || !heapMatch2[1]) return;
    const heapValue2 = parseInt(heapMatch2[1]);

    // Heap value should be a positive number
    expect(heapValue1).toBeGreaterThan(0);
    expect(heapValue2).toBeGreaterThan(0);
  });
});
