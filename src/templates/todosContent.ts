// src/templates/todosContent.ts
import { getTodoTypeEmoji, getTodoTypeLabel, TodoType } from '../types/extraction.js';
import { getPaymentButtonInfo, isValidAmount } from '../utils/paymentProviders.js';

interface TodoItem {
  id: number;
  description: string;
  type: TodoType;
  status: string;
  amount?: string;
  due_date?: string | Date;
  child_name?: string;
  confidence?: number;
  completed_at?: string | Date;
  auto_completed?: boolean;
  recurring?: boolean;
  recurrence_pattern?: string;
  source_email_id?: string;
  action_url?: string;
}

interface SourceEmail {
  subject?: string;
  from_email?: string;
  date: string | Date;
  body_text?: string;
  snippet?: string;
}

export interface TodosContentOptions {
  todos: TodoItem[];
  sourceEmails: Map<string, SourceEmail>;
  children: string[];
  types: string[];
}

/**
 * Generate the todos content HTML (without layout wrapper)
 */
export function renderTodosContent(options: TodosContentOptions): string {
  const { todos, sourceEmails, children, types } = options;

  const pendingCount = todos.filter(t => t.status === 'pending').length;
  const doneCount = todos.filter(t => t.status === 'done').length;

  const todosHtml = todos.length === 0 ? `
    <div class="empty-state">
      <div class="empty-state-icon">✨</div>
      <div class="empty-state-text">No todos yet! Run the email processor to extract action items.</div>
    </div>
  ` : todos.map(todo => {
    const paymentBtn = getPaymentButtonInfo(todo as any);

    // Format due date safely
    let dueDateHtml = '';
    if (todo.due_date) {
      const date = new Date(todo.due_date);
      if (!isNaN(date.getTime())) {
        dueDateHtml = `<div class="meta-item">⏰ Due: ${date.toLocaleDateString()}</div>`;
      }
    }

    // Recurrence info
    const recurrenceHtml = (todo.recurring && todo.recurrence_pattern)
      ? `<div class="meta-item">🔄 ${todo.recurrence_pattern}</div>`
      : '';

    // Completed at info
    let completedHtml = '';
    if (todo.completed_at) {
      const completedDate = new Date(todo.completed_at);
      completedHtml = `<div class="meta-item">✅ Completed: ${completedDate.toLocaleDateString()}${todo.auto_completed ? ' <span class="auto-completed-badge">Auto</span>' : ''}</div>`;
    }

    // Source email content
    let sourceEmailHtml = '';
    if (todo.source_email_id && sourceEmails.has(todo.source_email_id)) {
      const email = sourceEmails.get(todo.source_email_id)!;
      const safeSubject = escapeHtml(email.subject || '');
      const safeFrom = escapeHtml(email.from_email || '');
      const safeBody = escapeHtml(email.body_text || email.snippet || '');
      sourceEmailHtml = `
        <div class="source-email-content" id="source-email-${todo.id}">
          <div class="source-email-header">📧 ${safeSubject}</div>
          <div class="source-email-meta">
            <strong>From:</strong> ${safeFrom}<br>
            <strong>Date:</strong> ${new Date(email.date).toLocaleString()}
          </div>
          <div class="source-email-body">${safeBody}</div>
        </div>
      `;
    }

    return `
      <div class="todo-card ${todo.status === 'done' ? 'done' : ''}"
           data-type="${todo.type}"
           data-child="${todo.child_name || ''}"
           data-status="${todo.status}">
        <div class="todo-header">
          <div>
            <span class="type-badge type-${todo.type}">
              ${getTodoTypeEmoji(todo.type)} ${getTodoTypeLabel(todo.type)}
            </span>
            ${isValidAmount(todo.amount) ? `<span class="amount-badge">${todo.amount}</span>` : ''}
          </div>
        </div>
        <div class="todo-description">${escapeHtml(todo.description)}</div>
        <div class="todo-meta">
          ${dueDateHtml}
          ${recurrenceHtml}
          ${todo.child_name ? `<div class="meta-item">👶 ${escapeHtml(todo.child_name)}</div>` : ''}
          ${todo.confidence ? `<div class="meta-item">🎯 ${Math.round(todo.confidence * 100)}% confidence</div>` : ''}
          ${completedHtml}
        </div>
        <div class="todo-actions">
          ${todo.status === 'pending' ? `
            <button class="btn btn-primary" onclick="markAsDone(${todo.id})">✓ Mark Done</button>
          ` : `
            <button class="btn btn-outline" onclick="markAsPending(${todo.id})">↩ Mark Pending</button>
          `}
          ${paymentBtn ? `<a href="${paymentBtn.url}" target="_blank" class="btn btn-primary">${paymentBtn.label}</a>` : ''}
          <button class="btn btn-danger" onclick="deleteTodo(${todo.id})">🗑️ Delete</button>
          ${todo.source_email_id && sourceEmails.has(todo.source_email_id) ? `
            <button class="btn btn-outline source-email-toggle" onclick="toggleSourceEmail(${todo.id})">📧 View Source</button>
          ` : ''}
        </div>
        ${sourceEmailHtml}
      </div>
    `;
  }).join('');

  return `
    <style>
      .filters {
        background: white;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 24px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .filter-group {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
        margin-bottom: 12px;
      }

      .filter-group:last-child {
        margin-bottom: 0;
      }

      .filter-label {
        font-weight: 600;
        color: #333;
        margin-right: 8px;
        min-width: 100px;
      }

      .filter-btn {
        padding: 8px 16px;
        border: 2px solid #e0e0e0;
        background: white;
        border-radius: 20px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .filter-btn:hover {
        border-color: var(--primary-color);
        background: #f5f7ff;
      }

      .filter-btn.active {
        background: var(--primary-color);
        color: white;
        border-color: var(--primary-color);
      }

      .stats {
        display: flex;
        gap: 16px;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
      }

      .stat {
        padding: 8px 16px;
        background: #f8f9fa;
        border-radius: 8px;
        font-size: 13px;
        color: #666;
      }

      .stat strong {
        color: #333;
        font-weight: 600;
      }

      .todo-list {
        display: grid;
        gap: 16px;
      }

      .todo-card {
        background: white;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        border-left: 4px solid var(--primary-color);
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .todo-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      }

      .todo-card.done {
        opacity: 0.6;
        border-left-color: var(--success-color);
      }

      .todo-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 12px;
      }

      .type-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
      }

      .type-PAY { background: #ffebee; color: #c62828; }
      .type-BUY { background: #e3f2fd; color: #1565c0; }
      .type-PACK { background: #f3e5f5; color: #6a1b9a; }
      .type-SIGN { background: #fff3e0; color: #e65100; }
      .type-FILL { background: #e8f5e9; color: #2e7d32; }
      .type-READ { background: #fce4ec; color: #ad1457; }
      .type-REMIND { background: #f5f5f5; color: #616161; }

      .amount-badge {
        background: var(--danger-color);
        color: white;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 600;
        margin-left: 8px;
      }

      .auto-completed-badge {
        background: #6c757d;
        color: white;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 500;
        margin-left: 8px;
      }

      .todo-description {
        font-size: 16px;
        color: #333;
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .todo-meta {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        font-size: 13px;
        color: #666;
        margin-bottom: 12px;
      }

      .meta-item {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .todo-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }

      .source-email-toggle {
        font-size: 12px;
      }

      .source-email-content {
        display: none;
        margin-top: 12px;
        padding: 12px;
        background: #f8f9fa;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        font-size: 13px;
      }

      .source-email-content.visible {
        display: block;
      }

      .source-email-header {
        font-weight: 600;
        color: #333;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e0e0e0;
      }

      .source-email-meta {
        color: #666;
        margin-bottom: 8px;
      }

      .source-email-body {
        white-space: pre-wrap;
        font-family: monospace;
        font-size: 12px;
        max-height: 300px;
        overflow-y: auto;
        background: white;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #e0e0e0;
      }

      .empty-state {
        background: white;
        border-radius: 12px;
        padding: 60px 20px;
        text-align: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .empty-state-icon {
        font-size: 64px;
        margin-bottom: 16px;
      }

      .empty-state-text {
        color: #666;
        font-size: 18px;
      }
    </style>

    <div class="filters">
      <div class="filter-group">
        <span class="filter-label">Filter by Type:</span>
        <button class="filter-btn active" onclick="filterByType('all')">All</button>
        ${types.map(type => `
          <button class="filter-btn" onclick="filterByType('${type}')">${getTodoTypeEmoji(type as TodoType)} ${type}</button>
        `).join('')}
      </div>

      ${children.length > 0 ? `
        <div class="filter-group">
          <span class="filter-label">Filter by Child:</span>
          <button class="filter-btn active" onclick="filterByChild('all')">All</button>
          ${children.map(child => `
            <button class="filter-btn" onclick="filterByChild('${escapeHtml(child)}')">👶 ${escapeHtml(child)}</button>
          `).join('')}
        </div>
      ` : ''}

      <div class="filter-group">
        <span class="filter-label">Status:</span>
        <button class="filter-btn active" onclick="filterByStatus('all')">All</button>
        <button class="filter-btn" onclick="filterByStatus('pending')">⏳ Pending</button>
        <button class="filter-btn" onclick="filterByStatus('done')">✅ Done</button>
      </div>

      <div class="stats">
        <div class="stat">Total: <strong id="stat-total">${todos.length}</strong></div>
        <div class="stat">Pending: <strong id="stat-pending">${pendingCount}</strong></div>
        <div class="stat">Done: <strong id="stat-done">${doneCount}</strong></div>
      </div>
    </div>

    <div class="todo-list" id="todo-list">
      ${todosHtml}
    </div>
  `;
}

/**
 * Generate the todos JavaScript
 */
export function renderTodosScripts(): string {
  return `
    <script>
      function toggleSourceEmail(todoId) {
        const content = document.getElementById('source-email-' + todoId);
        if (content) {
          content.classList.toggle('visible');
          const btn = event.target;
          btn.textContent = content.classList.contains('visible') ? '📧 Hide Source' : '📧 View Source';
        }
      }

      let currentTypeFilter = 'all';
      let currentChildFilter = 'all';
      let currentStatusFilter = 'all';

      function filterByType(type) {
        currentTypeFilter = type;
        updateFilters();
        applyFilters();
      }

      function filterByChild(child) {
        currentChildFilter = child;
        updateFilters();
        applyFilters();
      }

      function filterByStatus(status) {
        currentStatusFilter = status;
        updateFilters();
        applyFilters();
      }

      function updateFilters() {
        // Reset all buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
          btn.classList.remove('active');
        });

        // Mark active buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
          const text = btn.textContent.trim();

          // Type filter
          if (currentTypeFilter === 'all' && btn.onclick?.toString().includes("filterByType('all')")) {
            btn.classList.add('active');
          } else if (text.includes(currentTypeFilter) && btn.onclick?.toString().includes('filterByType')) {
            btn.classList.add('active');
          }

          // Child filter
          if (currentChildFilter === 'all' && btn.onclick?.toString().includes("filterByChild('all')")) {
            btn.classList.add('active');
          } else if (text.includes(currentChildFilter) && btn.onclick?.toString().includes('filterByChild')) {
            btn.classList.add('active');
          }

          // Status filter
          if (currentStatusFilter === 'all' && btn.onclick?.toString().includes("filterByStatus('all')")) {
            btn.classList.add('active');
          } else if (currentStatusFilter === 'pending' && text.includes('Pending')) {
            btn.classList.add('active');
          } else if (currentStatusFilter === 'done' && text.includes('Done')) {
            btn.classList.add('active');
          }
        });
      }

      function applyFilters() {
        const cards = document.querySelectorAll('.todo-card');
        let visibleCount = 0;
        let pendingCount = 0;
        let doneCount = 0;

        cards.forEach(card => {
          const type = card.dataset.type;
          const child = card.dataset.child;
          const status = card.dataset.status;

          const typeMatch = currentTypeFilter === 'all' || type === currentTypeFilter;
          const childMatch = currentChildFilter === 'all' || child === currentChildFilter;
          const statusMatch = currentStatusFilter === 'all' || status === currentStatusFilter;

          if (typeMatch && childMatch && statusMatch) {
            card.style.display = 'block';
            visibleCount++;
            if (status === 'pending') pendingCount++;
            if (status === 'done') doneCount++;
          } else {
            card.style.display = 'none';
          }
        });

        // Update stats
        document.getElementById('stat-total').textContent = visibleCount;
        document.getElementById('stat-pending').textContent = pendingCount;
        document.getElementById('stat-done').textContent = doneCount;
      }

      async function markAsDone(id) {
        try {
          const response = await fetch('/todos/' + id + '/done', {
            method: 'PATCH'
          });
          if (response.ok) {
            location.reload();
          } else {
            alert('Failed to mark todo as done');
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }

      async function markAsPending(id) {
        try {
          const response = await fetch('/todos/' + id + '/pending', {
            method: 'PATCH'
          });
          if (response.ok) {
            location.reload();
          } else {
            alert('Failed to mark todo as pending');
          }
        } catch (error) {
          alert('Error: ' + error.message);
        }
      }

      async function deleteTodo(id) {
        if (!confirm('Are you sure you want to delete this todo?')) return;

        try {
          const response = await fetch('/todos/' + id, {
            method: 'DELETE'
          });
          if (response.ok) {
            location.reload();
          } else {
            alert('Failed to delete todo');
          }
        } catch (error) {
          alert('Error: ' + error.message);
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
