// src/routes/metricsRoutes.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdmin } from '../middleware/authorization.js';
import { getUserId } from '../lib/userContext.js';
import { getAggregatedMetrics, getTimeSeriesMetrics, getRecentMetrics } from '../db/metricsDb.js';
import { getUser } from '../db/userDb.js';
import type { Role } from '../types/roles.js';
import { renderLayout } from '../templates/layout.js';
import { renderMetricsContent, renderMetricsScripts } from '../templates/metricsContent.js';

/**
 * Metrics routes for AI performance dashboard
 */
export async function metricsRoutes(fastify: FastifyInstance) {
  /**
   * GET /metrics/dashboard
   * Display AI metrics dashboard (HTML)
   */
  fastify.get(
    '/metrics/dashboard',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const realUserId = (request as any).userId;
      const userRoles = (request as any).userRoles as Role[] || ['STANDARD'];

      // Check for impersonation
      const impersonatingUserId = request.cookies.impersonating_user_id
        ? fastify.unsignCookie(request.cookies.impersonating_user_id).value
        : null;

      const effectiveUserId = impersonatingUserId || realUserId;
      const effectiveUser = impersonatingUserId ? getUser(impersonatingUserId) : null;
      const realUser = getUser(realUserId);

      const aggregated = getAggregatedMetrics(effectiveUserId);
      const timeSeries = getTimeSeriesMetrics(effectiveUserId);
      const recent = getRecentMetrics(effectiveUserId);

      const content = renderMetricsContent({ aggregated, timeSeries, recent });
      const scripts = renderMetricsScripts();

      const html = renderLayout({
        title: 'AI Metrics',
        currentPath: '/metrics/dashboard',
        user: { email: realUser?.email || '', name: realUser?.name },
        userRoles,
        impersonating: effectiveUser ? { email: effectiveUser.email } : null,
        content,
        scripts,
      });

      return reply.type('text/html').send(html);
    }
  );

  /**
   * GET /metrics/api
   * Get metrics data as JSON
   */
  fastify.get(
    '/metrics/api',
    { preHandler: requireAdmin },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(request);

      const aggregated = getAggregatedMetrics(userId);
      const timeSeries = getTimeSeriesMetrics(userId);
      const recent = getRecentMetrics(userId);

      return reply.send({
        aggregated,
        timeSeries,
        recent,
      });
    }
  );
}
