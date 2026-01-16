// src/routes/metricsRoutes.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/session.js';
import { getUserId } from '../lib/userContext.js';
import { getAggregatedMetrics, getTimeSeriesMetrics, getRecentMetrics } from '../db/metricsDb.js';

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
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(request);

      const aggregated = getAggregatedMetrics(userId);
      const timeSeries = getTimeSeriesMetrics(userId);
      const recent = getRecentMetrics(userId);

      // If no metrics, show onboarding message
      if (!aggregated) {
        return reply.type('text/html').send(renderNoMetricsPage());
      }

      return reply.type('text/html').send(
        renderMetricsDashboard(aggregated, timeSeries, recent)
      );
    }
  );

  /**
   * GET /metrics/api
   * Get metrics data as JSON
   */
  fastify.get(
    '/metrics/api',
    { preHandler: requireAuth },
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

/**
 * Render "no metrics yet" page
 */
function renderNoMetricsPage(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Metrics Dashboard</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f7fa;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
    }
    h1 { color: #333; margin-bottom: 20px; }
    p { color: #666; font-size: 16px; line-height: 1.6; }
    .icon { font-size: 64px; margin-bottom: 20px; }
    a {
      display: inline-block;
      margin-top: 20px;
      padding: 12px 24px;
      background: #4285f4;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
    }
    a:hover { background: #357ae8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📊</div>
    <h1>No Metrics Yet</h1>
    <p>
      Your AI metrics dashboard will appear here once you've generated your first daily summary.
    </p>
    <p>
      Metrics track AI performance, email processing quality, and extraction success rates over time.
    </p>
    <a href="/dashboard">← Back to Dashboard</a>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Render metrics dashboard with charts
 */
function renderMetricsDashboard(
  aggregated: any,
  timeSeries: any[],
  recent: any[]
): string {
  // Prepare chart data
  const chartLabels = JSON.stringify(timeSeries.map(m => m.date));
  const chartSuccessRate = JSON.stringify(timeSeries.map(m => m.success_rate));
  const chartResponseTime = JSON.stringify(timeSeries.map(m => m.avg_response_time_ms));
  const chartEmailCount = JSON.stringify(timeSeries.map(m => m.avg_emails_total));

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f7fa;
      color: #333;
    }
    .header {
      max-width: 1200px;
      margin: 0 auto 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
    }
    .back-link {
      color: #4285f4;
      text-decoration: none;
      font-weight: 600;
    }
    .back-link:hover {
      text-decoration: underline;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .stat-label {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      color: #333;
    }
    .stat-unit {
      font-size: 18px;
      color: #999;
      margin-left: 4px;
    }
    .chart-container {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    .chart-container h2 {
      margin: 0 0 20px 0;
      font-size: 18px;
      color: #333;
    }
    .chart-wrapper {
      position: relative;
      height: 300px;
    }
    .recent-table {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 12px;
      background: #f8f9fa;
      font-weight: 600;
      font-size: 13px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    td {
      padding: 12px;
      border-top: 1px solid #e0e0e0;
      font-size: 14px;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success {
      background: #d4edda;
      color: #155724;
    }
    .badge-error {
      background: #f8d7da;
      color: #721c24;
    }
    .badge-openai {
      background: #e3f2fd;
      color: #0d47a1;
    }
    .badge-anthropic {
      background: #f3e5f5;
      color: #4a148c;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 AI Metrics Dashboard</h1>
    <a href="/dashboard" class="back-link">← Back to Dashboard</a>
  </div>

  <div class="container">
    <!-- Summary Stats -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Runs</div>
        <div class="stat-value">${aggregated.total_runs}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value">${aggregated.success_rate.toFixed(1)}<span class="stat-unit">%</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Response Time</div>
        <div class="stat-value">${(aggregated.avg_response_time_ms / 1000).toFixed(1)}<span class="stat-unit">s</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Emails/Day</div>
        <div class="stat-value">${aggregated.avg_emails_total.toFixed(0)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Signal Ratio</div>
        <div class="stat-value">${aggregated.avg_signal_ratio.toFixed(1)}<span class="stat-unit">%</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Extraction Success</div>
        <div class="stat-value">${aggregated.extraction_success_rate.toFixed(1)}<span class="stat-unit">%</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Financials</div>
        <div class="stat-value">${aggregated.avg_financials.toFixed(1)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Provider Split</div>
        <div class="stat-value" style="font-size: 18px;">
          <span class="badge badge-openai">OpenAI: ${aggregated.openai_runs}</span>
          <span class="badge badge-anthropic">Anthropic: ${aggregated.anthropic_runs}</span>
        </div>
      </div>
    </div>

    <!-- Success Rate Chart -->
    <div class="chart-container">
      <h2>Success Rate Over Time</h2>
      <div class="chart-wrapper">
        <canvas id="successChart"></canvas>
      </div>
    </div>

    <!-- Response Time Chart -->
    <div class="chart-container">
      <h2>Response Time Over Time</h2>
      <div class="chart-wrapper">
        <canvas id="responseTimeChart"></canvas>
      </div>
    </div>

    <!-- Email Count Chart -->
    <div class="chart-container">
      <h2>Email Volume Over Time</h2>
      <div class="chart-wrapper">
        <canvas id="emailCountChart"></canvas>
      </div>
    </div>

    <!-- Recent Runs Table -->
    <div class="recent-table">
      <h2 style="margin: 0 0 20px 0;">Recent Runs</h2>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Provider</th>
            <th>Emails</th>
            <th>Signal/Noise</th>
            <th>Attachments</th>
            <th>Response Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map(m => `
            <tr>
              <td>${new Date(m.timestamp).toLocaleString()}</td>
              <td><span class="badge badge-${m.provider}">${m.provider}</span></td>
              <td>${m.emails_total}</td>
              <td>${m.emails_signal} / ${m.emails_noise}</td>
              <td>${m.attachments_extracted || 0} / ${m.attachments_total || 0}</td>
              <td>${m.response_time_ms ? (m.response_time_ms / 1000).toFixed(1) + 's' : 'N/A'}</td>
              <td>
                <span class="badge badge-${m.validation_passed ? 'success' : 'error'}">
                  ${m.validation_passed ? '✓ Pass' : '✗ Fail'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    // Chart configuration
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true }
      }
    };

    // Success Rate Chart
    new Chart(document.getElementById('successChart'), {
      type: 'line',
      data: {
        labels: ${chartLabels},
        datasets: [{
          label: 'Success Rate (%)',
          data: ${chartSuccessRate},
          borderColor: '#4caf50',
          backgroundColor: 'rgba(76, 175, 80, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: chartOptions
    });

    // Response Time Chart
    new Chart(document.getElementById('responseTimeChart'), {
      type: 'line',
      data: {
        labels: ${chartLabels},
        datasets: [{
          label: 'Response Time (ms)',
          data: ${chartResponseTime},
          borderColor: '#2196f3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: chartOptions
    });

    // Email Count Chart
    new Chart(document.getElementById('emailCountChart'), {
      type: 'bar',
      data: {
        labels: ${chartLabels},
        datasets: [{
          label: 'Emails Processed',
          data: ${chartEmailCount},
          backgroundColor: '#ff9800',
        }]
      },
      options: chartOptions
    });
  </script>
</body>
</html>
  `.trim();
}
