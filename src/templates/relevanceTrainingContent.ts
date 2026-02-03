// src/templates/relevanceTrainingContent.ts

/**
 * Generate the relevance training page content
 */
export function renderRelevanceTrainingContent(): string {
  return `
    <style>
      .tabs {
        display: flex;
        border-bottom: 2px solid #e0e0e0;
        margin-bottom: 20px;
      }
      .tab {
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 600;
        color: #666;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
        transition: all 0.2s;
      }
      .tab:hover {
        color: #333;
        background: #f8f9fa;
      }
      .tab.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
      }
      .tab-count {
        display: inline-block;
        background: #e0e0e0;
        color: #666;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        margin-left: 8px;
      }
      .tab.active .tab-count {
        background: var(--primary-color);
        color: white;
      }
      .tab-content {
        display: none;
      }
      .tab-content.active {
        display: block;
      }
      .feedback-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        border-radius: 8px;
        margin-bottom: 8px;
        transition: all 0.2s;
      }
      .feedback-item.relevant {
        background: #f0fff0;
        border: 1px solid #c3e6c3;
      }
      .feedback-item.not-relevant {
        background: #fff5f5;
        border: 1px solid #f5c6cb;
      }
      .feedback-item.ungraded {
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
      }
      .feedback-info {
        flex: 1;
        min-width: 0;
        margin-right: 12px;
      }
      .feedback-text {
        font-size: 14px;
        font-weight: 500;
        color: #333;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .feedback-type {
        font-size: 18px;
      }
      .feedback-source {
        font-size: 12px;
        color: #888;
      }
      .feedback-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      .feedback-actions button {
        padding: 8px 14px;
        border-radius: 6px;
        border: none;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .btn-relevant {
        background: #e8f5e9;
        color: #28a745;
      }
      .btn-relevant:hover, .btn-relevant.active {
        background: #28a745;
        color: white;
      }
      .btn-not-relevant {
        background: #ffebee;
        color: #dc3545;
      }
      .btn-not-relevant:hover, .btn-not-relevant.active {
        background: #dc3545;
        color: white;
      }
      .btn-delete {
        background: #6c757d;
        color: white;
      }
      .btn-delete:hover {
        background: #5a6268;
      }
      .stats-bar {
        display: flex;
        gap: 24px;
        background: #f8f9fa;
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 24px;
      }
      .stat-item {
        text-align: center;
      }
      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: #333;
      }
      .stat-label {
        font-size: 12px;
        color: #888;
        margin-top: 2px;
      }
      .stat-item.relevant .stat-value { color: #28a745; }
      .stat-item.not-relevant .stat-value { color: #dc3545; }
      .stat-item.ungraded .stat-value { color: #ffc107; }
      .empty-tab {
        text-align: center;
        padding: 40px;
        color: #888;
        font-size: 14px;
      }
      .back-link {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #666;
        text-decoration: none;
        font-size: 14px;
        margin-bottom: 20px;
      }
      .back-link:hover {
        color: var(--primary-color);
      }
      .message {
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        display: none;
      }
      .message.success {
        display: block;
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      .message.error {
        display: block;
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
    </style>

    <a href="/settings" class="back-link">← Back to Settings</a>

    <h2 style="margin-bottom: 8px;">Relevance Training</h2>
    <p style="color: #666; font-size: 14px; margin-bottom: 24px;">
      Grade extracted items to help train the AI on what's relevant to your family. Items marked as relevant will be prioritized in future briefings.
    </p>

    <div id="message" class="message"></div>

    <div id="loading" style="text-align:center;padding:40px;color:#888;">Loading training data...</div>

    <div id="training-container" style="display:none;">
      <div class="stats-bar">
        <div class="stat-item">
          <div class="stat-value" id="stat-total">0</div>
          <div class="stat-label">Total Items</div>
        </div>
        <div class="stat-item relevant">
          <div class="stat-value" id="stat-relevant">0</div>
          <div class="stat-label">Relevant</div>
        </div>
        <div class="stat-item not-relevant">
          <div class="stat-value" id="stat-not-relevant">0</div>
          <div class="stat-label">Not Relevant</div>
        </div>
        <div class="stat-item ungraded">
          <div class="stat-value" id="stat-ungraded">0</div>
          <div class="stat-label">Ungraded</div>
        </div>
      </div>

      <div class="tabs">
        <div class="tab active" onclick="switchTab('all')" id="tab-all">
          All <span class="tab-count" id="count-all">0</span>
        </div>
        <div class="tab" onclick="switchTab('ungraded')" id="tab-ungraded">
          Ungraded <span class="tab-count" id="count-ungraded">0</span>
        </div>
        <div class="tab" onclick="switchTab('relevant')" id="tab-relevant">
          Relevant <span class="tab-count" id="count-relevant">0</span>
        </div>
        <div class="tab" onclick="switchTab('not-relevant')" id="tab-not-relevant">
          Not Relevant <span class="tab-count" id="count-not-relevant">0</span>
        </div>
      </div>

      <div id="feedback-list"></div>
    </div>
  `;
}

/**
 * Generate the relevance training page scripts
 */
export function renderRelevanceTrainingScripts(): string {
  return `
    <script>
      let feedbackItems = [];
      let currentTab = 'all';

      function showMessage(text, type) {
        const msg = document.getElementById('message');
        msg.textContent = text;
        msg.className = 'message ' + type;
        setTimeout(() => { msg.className = 'message'; }, 4000);
      }

      function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        renderFeedbackList();
      }

      async function loadFeedback() {
        try {
          const response = await fetch('/api/relevance-feedback');
          const data = await response.json();

          document.getElementById('loading').style.display = 'none';
          document.getElementById('training-container').style.display = 'block';

          feedbackItems = data.items || [];

          // Update stats
          if (data.stats) {
            document.getElementById('stat-total').textContent = data.stats.total;
            document.getElementById('stat-relevant').textContent = data.stats.relevant;
            document.getElementById('stat-not-relevant').textContent = data.stats.notRelevant;
            document.getElementById('stat-ungraded').textContent = data.stats.ungraded;
          }

          renderFeedbackList();
        } catch (error) {
          document.getElementById('loading').textContent = 'Failed to load training data';
        }
      }

      function getFilteredItems() {
        switch (currentTab) {
          case 'ungraded':
            return feedbackItems.filter(i => i.is_relevant === null);
          case 'relevant':
            return feedbackItems.filter(i => i.is_relevant === 1);
          case 'not-relevant':
            return feedbackItems.filter(i => i.is_relevant === 0);
          default:
            return feedbackItems;
        }
      }

      function renderFeedbackList() {
        const filtered = getFilteredItems();

        // Update tab counts
        document.getElementById('count-all').textContent = feedbackItems.length;
        document.getElementById('count-ungraded').textContent = feedbackItems.filter(i => i.is_relevant === null).length;
        document.getElementById('count-relevant').textContent = feedbackItems.filter(i => i.is_relevant === 1).length;
        document.getElementById('count-not-relevant').textContent = feedbackItems.filter(i => i.is_relevant === 0).length;

        const listEl = document.getElementById('feedback-list');

        if (filtered.length === 0) {
          listEl.innerHTML = '<div class="empty-tab">No items in this category.</div>';
          return;
        }

        listEl.innerHTML = filtered.map(item => {
          const icon = item.item_type === 'todo' ? '✅' : '📅';
          const isRelevant = item.is_relevant === 1;
          const isNotRelevant = item.is_relevant === 0;
          const statusClass = isRelevant ? 'relevant' : isNotRelevant ? 'not-relevant' : 'ungraded';

          return \`
            <div class="feedback-item \${statusClass}">
              <div class="feedback-info">
                <div class="feedback-text">
                  <span class="feedback-type">\${icon}</span>
                  <span>\${item.item_text}</span>
                </div>
                <div class="feedback-source">
                  \${item.source_sender || 'Unknown sender'}
                  \${item.source_subject ? \` · \${item.source_subject.substring(0, 50)}\${item.source_subject.length > 50 ? '...' : ''}\` : ''}
                </div>
              </div>
              <div class="feedback-actions">
                <button class="btn-relevant \${isRelevant ? 'active' : ''}" onclick="gradeFeedback(\${item.id}, true)" title="Mark as relevant">✓ Relevant</button>
                <button class="btn-not-relevant \${isNotRelevant ? 'active' : ''}" onclick="gradeFeedback(\${item.id}, false)" title="Mark as not relevant">✗ Not Relevant</button>
                <button class="btn-delete" onclick="deleteFeedback(\${item.id})" title="Delete">🗑</button>
              </div>
            </div>
          \`;
        }).join('');
      }

      async function gradeFeedback(id, isRelevant) {
        try {
          const response = await fetch('/api/relevance-feedback/' + id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isRelevant }),
          });

          if (response.ok) {
            const item = feedbackItems.find(i => i.id === id);
            if (item) {
              item.is_relevant = isRelevant ? 1 : 0;
            }
            // Refresh to update stats
            loadFeedback();
          } else {
            showMessage('Failed to update item', 'error');
          }
        } catch (error) {
          showMessage('Failed to update item', 'error');
        }
      }

      async function deleteFeedback(id) {
        if (!confirm('Delete this training item?')) return;

        try {
          const response = await fetch('/api/relevance-feedback/' + id, {
            method: 'DELETE',
          });

          if (response.ok) {
            feedbackItems = feedbackItems.filter(i => i.id !== id);
            loadFeedback();
            showMessage('Item deleted', 'success');
          } else {
            showMessage('Failed to delete item', 'error');
          }
        } catch (error) {
          showMessage('Failed to delete item', 'error');
        }
      }

      loadFeedback();
    </script>
  `;
}
