// src/templates/metricsContent.ts

export interface MetricsContentOptions {
  aggregated: {
    total_runs: number;
    success_rate: number;
    avg_response_time_ms: number;
    avg_emails_total: number;
    avg_signal_ratio: number;
    extraction_success_rate: number;
    avg_financials: number;
    openai_runs: number;
    anthropic_runs: number;
  } | null;
  timeSeries: Array<{
    date: string;
    success_rate: number;
    avg_response_time_ms: number;
    avg_emails_total: number;
  }>;
  recent: Array<{
    timestamp?: Date;
    provider: string;
    emails_total: number;
    emails_signal: number;
    emails_noise: number;
    attachments_extracted?: number;
    attachments_total?: number;
    response_time_ms?: number;
    validation_passed: boolean;
  }>;
}

/**
 * Generate the metrics dashboard content HTML (without layout wrapper)
 */
export function renderMetricsContent(options: MetricsContentOptions): string {
  const { aggregated, timeSeries, recent } = options;

  if (!aggregated) {
    return `
      <div class="card" style="text-align: center; padding: 60px 20px;">
        <div style="font-size: 64px; margin-bottom: 20px;">📊</div>
        <h2 style="margin-bottom: 15px; color: #333;">No Metrics Yet</h2>
        <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 10px;">
          Your AI metrics dashboard will appear here once you've generated your first daily summary.
        </p>
        <p style="color: #666; font-size: 14px;">
          Metrics track AI performance, email processing quality, and extraction success rates over time.
        </p>
      </div>
    `;
  }

  // Prepare chart data
  const chartLabels = JSON.stringify(timeSeries.map(m => m.date));
  const chartSuccessRate = JSON.stringify(timeSeries.map(m => m.success_rate));
  const chartResponseTime = JSON.stringify(timeSeries.map(m => m.avg_response_time_ms));
  const chartEmailCount = JSON.stringify(timeSeries.map(m => m.avg_emails_total));

  return `
    <style>
      .metrics-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 15px;
        margin-bottom: 24px;
      }

      .metrics-stat-card {
        background: linear-gradient(135deg, var(--primary-color) 0%, #764ba2 100%);
        color: white;
        padding: 20px;
        border-radius: 12px;
        text-align: center;
      }

      .metrics-stat-label {
        font-size: 12px;
        opacity: 0.9;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .metrics-stat-value {
        font-size: 28px;
        font-weight: 700;
      }

      .metrics-stat-unit {
        font-size: 16px;
        opacity: 0.8;
        margin-left: 4px;
      }

      .chart-card {
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        margin-bottom: 20px;
      }

      .chart-card h3 {
        margin: 0 0 15px 0;
        font-size: 16px;
        color: #333;
      }

      .chart-wrapper {
        position: relative;
        height: 250px;
      }

      .recent-table {
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        overflow-x: auto;
      }

      .recent-table h3 {
        margin: 0 0 15px 0;
        font-size: 16px;
        color: #333;
      }

      .recent-table table {
        width: 100%;
        border-collapse: collapse;
      }

      .recent-table th {
        text-align: left;
        padding: 10px 12px;
        background: #f8f9fa;
        font-weight: 600;
        font-size: 12px;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .recent-table td {
        padding: 10px 12px;
        border-top: 1px solid #e0e0e0;
        font-size: 13px;
      }

      .metrics-badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
      }

      .metrics-badge-success {
        background: #d4edda;
        color: #155724;
      }

      .metrics-badge-error {
        background: #f8d7da;
        color: #721c24;
      }

      .metrics-badge-openai {
        background: #e3f2fd;
        color: #0d47a1;
      }

      .metrics-badge-anthropic {
        background: #f3e5f5;
        color: #4a148c;
      }

      .provider-split {
        display: flex;
        gap: 8px;
        justify-content: center;
        flex-wrap: wrap;
      }
    </style>

    <!-- Summary Stats -->
    <div class="metrics-stats-grid">
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Total Runs</div>
        <div class="metrics-stat-value">${aggregated.total_runs}</div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Success Rate</div>
        <div class="metrics-stat-value">${aggregated.success_rate.toFixed(1)}<span class="metrics-stat-unit">%</span></div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Avg Response Time</div>
        <div class="metrics-stat-value">${(aggregated.avg_response_time_ms / 1000).toFixed(1)}<span class="metrics-stat-unit">s</span></div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Avg Emails/Day</div>
        <div class="metrics-stat-value">${aggregated.avg_emails_total.toFixed(0)}</div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Signal Ratio</div>
        <div class="metrics-stat-value">${aggregated.avg_signal_ratio.toFixed(1)}<span class="metrics-stat-unit">%</span></div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Extraction Success</div>
        <div class="metrics-stat-value">${aggregated.extraction_success_rate.toFixed(1)}<span class="metrics-stat-unit">%</span></div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Avg Financials</div>
        <div class="metrics-stat-value">${aggregated.avg_financials.toFixed(1)}</div>
      </div>
      <div class="metrics-stat-card">
        <div class="metrics-stat-label">Provider Split</div>
        <div class="provider-split">
          <span class="metrics-badge metrics-badge-openai">OpenAI: ${aggregated.openai_runs}</span>
          <span class="metrics-badge metrics-badge-anthropic">Anthropic: ${aggregated.anthropic_runs}</span>
        </div>
      </div>
    </div>

    <!-- Success Rate Chart -->
    <div class="chart-card">
      <h3>Success Rate Over Time</h3>
      <div class="chart-wrapper">
        <canvas id="successChart"></canvas>
      </div>
    </div>

    <!-- Response Time Chart -->
    <div class="chart-card">
      <h3>Response Time Over Time</h3>
      <div class="chart-wrapper">
        <canvas id="responseTimeChart"></canvas>
      </div>
    </div>

    <!-- Email Count Chart -->
    <div class="chart-card">
      <h3>Email Volume Over Time</h3>
      <div class="chart-wrapper">
        <canvas id="emailCountChart"></canvas>
      </div>
    </div>

    <!-- Recent Runs Table -->
    <div class="recent-table">
      <h3>Recent Runs</h3>
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
              <td>${m.timestamp ? m.timestamp.toLocaleString() : 'N/A'}</td>
              <td><span class="metrics-badge metrics-badge-${m.provider}">${m.provider}</span></td>
              <td>${m.emails_total}</td>
              <td>${m.emails_signal} / ${m.emails_noise}</td>
              <td>${m.attachments_extracted || 0} / ${m.attachments_total || 0}</td>
              <td>${m.response_time_ms ? (m.response_time_ms / 1000).toFixed(1) + 's' : 'N/A'}</td>
              <td>
                <span class="metrics-badge metrics-badge-${m.validation_passed ? 'success' : 'error'}">
                  ${m.validation_passed ? 'Pass' : 'Fail'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <script id="metrics-chart-data" type="application/json">
      {
        "labels": ${chartLabels},
        "successRate": ${chartSuccessRate},
        "responseTime": ${chartResponseTime},
        "emailCount": ${chartEmailCount}
      }
    </script>
  `;
}

/**
 * Generate the metrics dashboard JavaScript
 */
export function renderMetricsScripts(): string {
  return `
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        const dataEl = document.getElementById('metrics-chart-data');
        if (!dataEl) return;

        const chartData = JSON.parse(dataEl.textContent);

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
        const successCtx = document.getElementById('successChart');
        if (successCtx) {
          new Chart(successCtx, {
            type: 'line',
            data: {
              labels: chartData.labels,
              datasets: [{
                label: 'Success Rate (%)',
                data: chartData.successRate,
                borderColor: '#4caf50',
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                tension: 0.4,
                fill: true
              }]
            },
            options: chartOptions
          });
        }

        // Response Time Chart
        const responseCtx = document.getElementById('responseTimeChart');
        if (responseCtx) {
          new Chart(responseCtx, {
            type: 'line',
            data: {
              labels: chartData.labels,
              datasets: [{
                label: 'Response Time (ms)',
                data: chartData.responseTime,
                borderColor: '#2196f3',
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                tension: 0.4,
                fill: true
              }]
            },
            options: chartOptions
          });
        }

        // Email Count Chart
        const emailCtx = document.getElementById('emailCountChart');
        if (emailCtx) {
          new Chart(emailCtx, {
            type: 'bar',
            data: {
              labels: chartData.labels,
              datasets: [{
                label: 'Emails Processed',
                data: chartData.emailCount,
                backgroundColor: '#ff9800',
              }]
            },
            options: chartOptions
          });
        }
      });
    </script>
  `;
}
