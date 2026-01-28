// src/templates/analysesViewContent.ts

interface StoredEmailAnalysis {
  id: number;
  email_id: number;
  analysis_version: number;
  ai_provider: string;
  email_summary?: string;
  email_tone?: string;
  email_intent?: string;
  implicit_context?: string;
  quality_score?: number;
  confidence_avg?: number;
  events_extracted: number;
  todos_extracted: number;
  recurring_items: number;
  inferred_items: number;
  status: string;
  reviewed_by?: string;
  reviewed_at?: Date;
  review_notes?: string;
  analysis_error?: string;
  raw_extraction_json?: string;
  created_at: Date;
  updated_at: Date;
}

interface StoredEmail {
  subject?: string;
  from_name?: string;
  from_email?: string;
  body_text?: string;
}

interface AnalysisStats {
  total: number;
  pending: number;
  analyzed: number;
  approved: number;
  rejected: number;
  totalEvents: number;
  totalTodos: number;
  avgQualityScore: number | null;
}

export interface AnalysesViewContentOptions {
  analyses: StoredEmailAnalysis[];
  stats: AnalysisStats;
  emailMap: Map<number, StoredEmail>;
}

/**
 * Generate the analyses view content HTML (without layout wrapper)
 */
export function renderAnalysesViewContent(options: AnalysesViewContentOptions): string {
  const { analyses, stats, emailMap } = options;

  const analysesHtml = analyses.length > 0
    ? analyses.map((analysis) => {
        const email = emailMap.get(analysis.email_id);
        const emailBody = email?.body_text || '(No email body available)';
        const emailSubject = email?.subject || '(Unknown subject)';
        const emailFrom = email?.from_name || email?.from_email || '(Unknown sender)';

        return `
        <div class="analysis-card" data-analysis-id="${analysis.id}" data-email-id="${analysis.email_id}">
          <div class="analysis-header">
            <div class="analysis-summary">${escapeHtml(analysis.email_summary || '(No summary)')}</div>
            <div class="analysis-badges">
              <span class="badge badge-${analysis.status}">${analysis.status}</span>
              ${analysis.quality_score !== null ? `<span class="badge badge-quality">${(analysis.quality_score * 100).toFixed(0)}% Quality</span>` : ''}
            </div>
          </div>
          <div class="analysis-meta">
            <span>Email #${analysis.email_id}</span>
            <span>Provider: ${analysis.ai_provider}</span>
            <span>${formatDate(analysis.created_at)}</span>
          </div>
          <div class="email-info">
            <div class="detail"><strong>Subject:</strong> ${escapeHtml(emailSubject)}</div>
            <div class="detail"><strong>From:</strong> ${escapeHtml(emailFrom)}</div>
          </div>
          <div class="analysis-stats">
            <span class="stat">📅 ${analysis.events_extracted} events</span>
            <span class="stat">📝 ${analysis.todos_extracted} todos</span>
            <span class="stat">🔄 ${analysis.recurring_items} recurring</span>
            <span class="stat">💡 ${analysis.inferred_items} inferred</span>
          </div>
          <div class="analysis-details">
            <div class="detail"><strong>Tone:</strong> ${escapeHtml(analysis.email_tone || 'N/A')}</div>
            <div class="detail"><strong>Intent:</strong> ${escapeHtml(analysis.email_intent || 'N/A')}</div>
            ${analysis.implicit_context ? `<div class="detail"><strong>Context:</strong> ${escapeHtml(analysis.implicit_context)}</div>` : ''}
          </div>
          <details class="raw-email-details">
            <summary>View Raw Email</summary>
            <div class="raw-email-body">${escapeHtml(emailBody)}</div>
          </details>
          <details class="raw-ai-details">
            <summary>View AI Response</summary>
            <div class="raw-ai-body">${analysis.raw_extraction_json ? formatJsonForDisplay(analysis.raw_extraction_json) : '(No raw response available)'}</div>
          </details>
          ${analysis.analysis_error ? `<div class="analysis-error">Error: ${escapeHtml(analysis.analysis_error)}</div>` : ''}
          <div class="analysis-actions">
            <button class="btn btn-outline" onclick="reextractAttachments(${analysis.email_id}, ${analysis.id})">📎 Re-extract Attachments</button>
            <button class="btn btn-outline" onclick="reanalyzeEmail(${analysis.id})">🔄 Re-analyze</button>
            ${analysis.status === 'analyzed' ? `
              <button class="btn btn-primary" onclick="approveAnalysis(${analysis.id})">✅ Approve</button>
              <button class="btn btn-danger" onclick="rejectAnalysis(${analysis.id})">❌ Reject</button>
            ` : ''}
            <button class="btn btn-danger" data-analysis-id="${analysis.id}" onclick="deleteAnalysis(this)">🗑️ Delete</button>
          </div>
          <div class="reextract-result" id="reextract-result-${analysis.id}" style="display: none;"></div>
          <div class="reanalyze-result" id="reanalyze-result-${analysis.id}" style="display: none;"></div>
        </div>
      `;
      }).join('')
    : '<div class="empty-state">No analyses yet. Run analysis on emails to see results.</div>';

  return `
    <style>
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 15px;
        margin-bottom: 24px;
      }

      .stat-card {
        background: linear-gradient(135deg, var(--primary-color) 0%, #764ba2 100%);
        color: white;
        padding: 15px;
        border-radius: 12px;
        text-align: center;
      }

      .stat-number {
        font-size: 28px;
        font-weight: bold;
        margin-bottom: 5px;
      }

      .stat-label {
        font-size: 12px;
        opacity: 0.9;
      }

      .actions-bar {
        background: white;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .analysis-card {
        background: white;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 15px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: all 0.2s;
      }

      .analysis-card:hover {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }

      .analysis-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 15px;
        margin-bottom: 10px;
      }

      .analysis-summary {
        font-weight: 600;
        color: #333;
        font-size: 16px;
        flex: 1;
      }

      .analysis-badges {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }

      .badge {
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
      }

      .badge-pending { background: #fff3cd; color: #856404; }
      .badge-analyzed { background: #d1ecf1; color: #0c5460; }
      .badge-approved { background: #d4edda; color: #155724; }
      .badge-rejected { background: #f8d7da; color: #721c24; }
      .badge-reviewed { background: #e2e3e5; color: #383d41; }
      .badge-quality { background: var(--primary-color); color: white; }

      .analysis-meta {
        display: flex;
        gap: 15px;
        font-size: 13px;
        color: #666;
        margin-bottom: 10px;
      }

      .analysis-stats {
        display: flex;
        gap: 20px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }

      .stat {
        font-size: 13px;
        color: #555;
      }

      .analysis-details {
        font-size: 13px;
        color: #444;
        margin-bottom: 10px;
      }

      .detail {
        margin-bottom: 5px;
      }

      .email-info {
        font-size: 13px;
        color: #444;
        margin-bottom: 10px;
        padding: 8px;
        background: #f8f9fa;
        border-radius: 6px;
      }

      .raw-email-details,
      .raw-ai-details {
        margin-top: 10px;
      }

      .raw-email-details summary,
      .raw-ai-details summary {
        cursor: pointer;
        color: var(--primary-color);
        font-size: 13px;
        font-weight: 500;
      }

      .raw-ai-details summary {
        color: #17a2b8;
      }

      .raw-email-body,
      .raw-ai-body {
        margin-top: 10px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 6px;
        font-size: 12px;
        font-family: monospace;
        white-space: pre-wrap;
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid #e0e0e0;
      }

      .raw-ai-body {
        background: #e8f4f8;
        border-color: #b8daff;
      }

      .analysis-error {
        margin-top: 10px;
        padding: 10px;
        background: #f8d7da;
        color: #721c24;
        border-radius: 6px;
        font-size: 13px;
      }

      .analysis-actions {
        margin-top: 15px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .reanalyze-result,
      .reextract-result {
        margin-top: 10px;
        padding: 12px;
        border-radius: 6px;
        font-size: 13px;
      }

      .reanalyze-result.loading,
      .reextract-result.loading { background: #e3f2fd; color: #1565c0; }
      .reanalyze-result.success,
      .reextract-result.success { background: #d4edda; color: #155724; }
      .reanalyze-result.error,
      .reextract-result.error { background: #f8d7da; color: #721c24; }

      .empty-state {
        background: white;
        padding: 60px 20px;
        border-radius: 12px;
        text-align: center;
        color: #666;
        font-style: italic;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      #result {
        margin-top: 15px;
        padding: 15px;
        border-radius: 6px;
        display: none;
      }

      .result-success { background: #d4edda; color: #155724; }
      .result-error { background: #f8d7da; color: #721c24; }
    </style>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-number">${stats.total}</div>
        <div class="stat-label">Total</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.pending}</div>
        <div class="stat-label">Pending</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.analyzed}</div>
        <div class="stat-label">Analyzed</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.approved}</div>
        <div class="stat-label">Approved</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.totalEvents}</div>
        <div class="stat-label">Events</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.totalTodos}</div>
        <div class="stat-label">Todos</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${stats.avgQualityScore !== null ? (stats.avgQualityScore * 100).toFixed(0) + '%' : 'N/A'}</div>
        <div class="stat-label">Avg Quality</div>
      </div>
    </div>

    <div class="actions-bar">
      <button class="btn btn-primary" id="run-btn" onclick="runAnalysis()">
        🤖 Run Analysis on Unanalyzed Emails
      </button>
      <button class="btn btn-outline" onclick="window.location.reload()">
        🔄 Refresh
      </button>
      <div id="result"></div>
    </div>

    <h3 style="margin-bottom: 15px;">Analyses (${analyses.length})</h3>
    <div id="analyses-container">
      ${analysesHtml}
    </div>
  `;
}

/**
 * Generate the analyses view JavaScript
 */
export function renderAnalysesViewScripts(): string {
  return `
    <script>
      async function runAnalysis() {
        const btn = document.getElementById('run-btn');
        const resultDiv = document.getElementById('result');

        btn.disabled = true;
        btn.textContent = '⏳ Running...';
        resultDiv.style.display = 'none';

        try {
          const response = await fetch('/api/analyses/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: 20 })
          });

          const data = await response.json();

          if (response.ok && data.success) {
            resultDiv.className = 'result-success';
            resultDiv.innerHTML = \`
              <strong>✅ Analysis complete!</strong><br>
              Processed: \${data.processed} | Successful: \${data.successful} | Failed: \${data.failed}<br>
              Events created: \${data.eventsCreated} | Todos created: \${data.todosCreated}
            \`;
            setTimeout(() => window.location.reload(), 2000);
          } else {
            throw new Error(data.message || data.error || 'Analysis failed');
          }
        } catch (error) {
          resultDiv.className = 'result-error';
          resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
        } finally {
          resultDiv.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '🤖 Run Analysis on Unanalyzed Emails';
        }
      }

      async function approveAnalysis(id) {
        try {
          const response = await fetch('/api/analyses/' + id + '/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });

          if (response.ok) {
            window.location.reload();
          } else {
            alert('Failed to approve analysis');
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }

      async function rejectAnalysis(id) {
        const notes = prompt('Rejection reason (optional):');
        try {
          const response = await fetch('/api/analyses/' + id + '/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes })
          });

          if (response.ok) {
            window.location.reload();
          } else {
            alert('Failed to reject analysis');
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }

      async function deleteAnalysis(btn) {
        const analysisId = btn.dataset.analysisId;
        const card = btn.closest('.analysis-card');
        const summary = card.querySelector('.analysis-summary')?.textContent || 'this analysis';

        if (!confirm('Delete analysis?\\n\\n"' + summary.substring(0, 100) + '..."')) {
          return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ Deleting...';

        try {
          const response = await fetch('/api/analyses/' + analysisId, {
            method: 'DELETE'
          });

          if (response.ok) {
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0';
            card.style.transform = 'translateX(-20px)';
            setTimeout(() => card.remove(), 300);
          } else {
            const data = await response.json();
            throw new Error(data.error || 'Delete failed');
          }
        } catch (error) {
          alert('Error deleting analysis: ' + error.message);
          btn.disabled = false;
          btn.textContent = '🗑️ Delete';
        }
      }

      async function reextractAttachments(emailId, analysisId) {
        const resultDiv = document.getElementById('reextract-result-' + analysisId);
        const card = document.querySelector('[data-analysis-id="' + analysisId + '"]');
        const btn = card.querySelector('.btn-outline');

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '⏳ Extracting...';
        resultDiv.style.display = 'block';
        resultDiv.className = 'reextract-result loading';
        resultDiv.innerHTML = 'Re-extracting attachments with AI Vision... This may take a moment.';

        try {
          const response = await fetch('/admin/emails/' + emailId + '/reextract-attachments', {
            method: 'POST'
          });

          const data = await response.json();

          if (response.ok && data.success) {
            resultDiv.className = 'reextract-result success';
            let resultHtml = '<strong>✅ ' + data.message + '</strong><br>';
            if (data.results && data.results.length > 0) {
              resultHtml += '<ul style="margin: 8px 0; padding-left: 20px;">';
              for (const r of data.results) {
                const status = r.success ? '✅' : '❌';
                const preview = r.extractedText ? r.extractedText.substring(0, 100) + '...' : (r.error || 'No text');
                resultHtml += '<li><strong>' + status + ' ' + r.filename + '</strong>: ' + preview + '</li>';
              }
              resultHtml += '</ul>';
            }
            resultHtml += '<em>You can now click Re-analyze to process the new content.</em>';
            resultDiv.innerHTML = resultHtml;
          } else {
            throw new Error(data.message || data.error || 'Re-extraction failed');
          }
        } catch (error) {
          resultDiv.className = 'reextract-result error';
          resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      }

      async function reanalyzeEmail(analysisId) {
        const resultDiv = document.getElementById('reanalyze-result-' + analysisId);
        const card = document.querySelector('[data-analysis-id="' + analysisId + '"]');
        const btn = card.querySelector('.btn-outline');

        btn.disabled = true;
        btn.textContent = '⏳ Analyzing...';
        resultDiv.style.display = 'block';
        resultDiv.className = 'reanalyze-result loading';
        resultDiv.innerHTML = 'Running AI analysis... This may take a moment.';

        try {
          const response = await fetch('/api/analyses/' + analysisId + '/reanalyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });

          const data = await response.json();

          if (response.ok && data.success) {
            resultDiv.className = 'reanalyze-result success';
            resultDiv.innerHTML = \`
              <strong>✅ Re-analysis complete!</strong><br>
              <strong>New Summary:</strong> \${data.analysis?.emailSummary || 'N/A'}<br>
              <strong>Tone:</strong> \${data.analysis?.emailTone || 'N/A'} | <strong>Intent:</strong> \${data.analysis?.emailIntent || 'N/A'}<br>
              <strong>Quality:</strong> \${data.qualityScore ? (data.qualityScore * 100).toFixed(0) + '%' : 'N/A'}<br>
              <strong>Events:</strong> \${data.eventsCreated} | <strong>Todos:</strong> \${data.todosCreated}<br>
              <em>Refreshing page in 3 seconds...</em>
            \`;
            setTimeout(() => window.location.reload(), 3000);
          } else {
            throw new Error(data.message || data.error || 'Re-analysis failed');
          }
        } catch (error) {
          resultDiv.className = 'reanalyze-result error';
          resultDiv.innerHTML = '<strong>❌ Error:</strong> ' + error.message;
          btn.disabled = false;
          btn.textContent = '🔄 Re-analyze';
        }
      }
    </script>
  `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
}

/**
 * Format JSON string for display
 */
function formatJsonForDisplay(jsonString: string): string {
  try {
    const parsed = JSON.parse(jsonString);
    return escapeHtml(JSON.stringify(parsed, null, 2));
  } catch {
    return escapeHtml(jsonString);
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
