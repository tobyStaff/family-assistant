// src/templates/sendersContent.ts

/**
 * Generate the senders management page content
 */
export function renderSendersContent(): string {
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
      .sender-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        border-radius: 8px;
        margin-bottom: 8px;
        transition: all 0.2s;
      }
      .sender-item.included {
        background: #f0fff0;
        border: 1px solid #c3e6c3;
      }
      .sender-item.excluded {
        background: #fff5f5;
        border: 1px solid #f5c6cb;
      }
      .sender-info {
        flex: 1;
        min-width: 0;
      }
      .sender-name {
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin-bottom: 2px;
      }
      .sender-email {
        font-size: 12px;
        color: #888;
      }
      .sender-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
      }
      .sender-actions button {
        padding: 6px 14px;
        border-radius: 6px;
        border: none;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .btn-include {
        background: #28a745;
        color: white;
      }
      .btn-include:hover {
        background: #218838;
      }
      .btn-exclude {
        background: #ffc107;
        color: #333;
      }
      .btn-exclude:hover {
        background: #e0a800;
      }
      .btn-delete {
        background: #dc3545;
        color: white;
      }
      .btn-delete:hover {
        background: #c82333;
      }
      .add-sender-form {
        background: #f8f9fa;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 24px;
      }
      .add-sender-form label {
        display: block;
        font-weight: 600;
        font-size: 14px;
        color: #333;
        margin-bottom: 12px;
      }
      .form-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }
      .form-row input {
        flex: 1;
        min-width: 180px;
        padding: 12px 14px;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-size: 14px;
      }
      .form-row input:focus {
        outline: none;
        border-color: var(--primary-color);
      }
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

    <h2 style="margin-bottom: 8px;">Monitored Senders</h2>
    <p style="color: #666; font-size: 14px; margin-bottom: 24px;">
      Manage which email senders we monitor for school and family information.
    </p>

    <div id="message" class="message"></div>

    <div class="add-sender-form">
      <label>Add a new sender</label>
      <div class="form-row">
        <input type="email" id="newSenderEmail" placeholder="sender@example.com">
        <input type="text" id="newSenderName" placeholder="Display name (optional)">
        <button class="btn btn-primary" onclick="addSender()">Add to Included</button>
      </div>
    </div>

    <div id="loading" style="text-align:center;padding:40px;color:#888;">Loading senders...</div>

    <div id="senders-container" style="display:none;">
      <div class="tabs">
        <div class="tab active" onclick="switchTab('included')" id="tab-included">
          Included <span class="tab-count" id="count-included">0</span>
        </div>
        <div class="tab" onclick="switchTab('excluded')" id="tab-excluded">
          Excluded <span class="tab-count" id="count-excluded">0</span>
        </div>
      </div>

      <div class="tab-content active" id="content-included">
        <div id="list-included"></div>
      </div>

      <div class="tab-content" id="content-excluded">
        <div id="list-excluded"></div>
      </div>
    </div>
  `;
}

/**
 * Generate the senders management page scripts
 */
export function renderSendersScripts(): string {
  return `
    <script>
      let senderFilters = [];
      let currentTab = 'included';

      function showMessage(text, type) {
        const msg = document.getElementById('message');
        msg.textContent = text;
        msg.className = 'message ' + type;
        setTimeout(() => { msg.className = 'message'; }, 4000);
      }

      function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        document.getElementById('content-' + tab).classList.add('active');
      }

      async function loadSenders() {
        try {
          const response = await fetch('/api/sender-filters');
          const data = await response.json();

          document.getElementById('loading').style.display = 'none';
          document.getElementById('senders-container').style.display = 'block';

          senderFilters = data.filters || [];
          renderSenders();
        } catch (error) {
          document.getElementById('loading').textContent = 'Failed to load senders';
        }
      }

      function renderSenders() {
        const included = senderFilters.filter(f => f.status === 'include');
        const excluded = senderFilters.filter(f => f.status === 'exclude');

        // Update counts
        document.getElementById('count-included').textContent = included.length;
        document.getElementById('count-excluded').textContent = excluded.length;

        // Render included list
        const includedEl = document.getElementById('list-included');
        if (included.length === 0) {
          includedEl.innerHTML = '<div class="empty-tab">No included senders. Add senders above to start monitoring their emails.</div>';
        } else {
          includedEl.innerHTML = included.map(s => \`
            <div class="sender-item included">
              <div class="sender-info">
                <div class="sender-name">\${s.sender_name || s.sender_email}</div>
                \${s.sender_name ? \`<div class="sender-email">\${s.sender_email}</div>\` : ''}
              </div>
              <div class="sender-actions">
                <button class="btn-exclude" onclick="updateSender('\${s.sender_email}', 'exclude')">Exclude</button>
                <button class="btn-delete" onclick="deleteSender('\${s.sender_email}')">Delete</button>
              </div>
            </div>
          \`).join('');
        }

        // Render excluded list
        const excludedEl = document.getElementById('list-excluded');
        if (excluded.length === 0) {
          excludedEl.innerHTML = '<div class="empty-tab">No excluded senders.</div>';
        } else {
          excludedEl.innerHTML = excluded.map(s => \`
            <div class="sender-item excluded">
              <div class="sender-info">
                <div class="sender-name">\${s.sender_name || s.sender_email}</div>
                \${s.sender_name ? \`<div class="sender-email">\${s.sender_email}</div>\` : ''}
              </div>
              <div class="sender-actions">
                <button class="btn-include" onclick="updateSender('\${s.sender_email}', 'include')">Include</button>
                <button class="btn-delete" onclick="deleteSender('\${s.sender_email}')">Delete</button>
              </div>
            </div>
          \`).join('');
        }
      }

      async function addSender() {
        const emailInput = document.getElementById('newSenderEmail');
        const nameInput = document.getElementById('newSenderName');
        const email = emailInput.value.trim().toLowerCase();
        const name = nameInput.value.trim();

        if (!email || !email.includes('@')) {
          showMessage('Please enter a valid email address', 'error');
          return;
        }

        try {
          const response = await fetch('/api/sender-filters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, name: name || undefined, status: 'include' }),
          });

          if (response.ok) {
            emailInput.value = '';
            nameInput.value = '';
            showMessage('Sender added', 'success');
            loadSenders();
          } else {
            const data = await response.json();
            showMessage(data.error || 'Failed to add sender', 'error');
          }
        } catch (error) {
          showMessage('Failed to add sender', 'error');
        }
      }

      async function updateSender(email, newStatus) {
        try {
          const response = await fetch('/api/sender-filters/' + encodeURIComponent(email), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          });

          if (response.ok) {
            const filter = senderFilters.find(f => f.sender_email === email);
            if (filter) filter.status = newStatus;
            renderSenders();
            showMessage('Sender updated', 'success');
          } else {
            showMessage('Failed to update sender', 'error');
          }
        } catch (error) {
          showMessage('Failed to update sender', 'error');
        }
      }

      async function deleteSender(email) {
        if (!confirm('Remove this sender?')) return;

        try {
          const response = await fetch('/api/sender-filters/' + encodeURIComponent(email), {
            method: 'DELETE',
          });

          if (response.ok) {
            senderFilters = senderFilters.filter(f => f.sender_email !== email);
            renderSenders();
            showMessage('Sender removed', 'success');
          } else {
            showMessage('Failed to remove sender', 'error');
          }
        } catch (error) {
          showMessage('Failed to remove sender', 'error');
        }
      }

      // Handle enter key in form
      document.getElementById('newSenderEmail').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addSender(); }
      });
      document.getElementById('newSenderName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addSender(); }
      });

      loadSenders();
    </script>
  `;
}
