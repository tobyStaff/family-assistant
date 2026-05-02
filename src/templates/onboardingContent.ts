// src/templates/onboardingContent.ts
//
// Renders the onboarding wizard. The wizard is data-driven: which screen
// the user sees is determined by getNextOnboardingStep(userId), not by a
// stored step counter.

import type { OnboardingStep } from '../lib/onboardingState.js';

export interface OnboardingPageOptions {
  step: OnboardingStep;
  hostedEmailDomain: string;
  hostedEmailAddress: string | null;
  isDev?: boolean;
}

export function renderOnboardingPage(options: OnboardingPageOptions): string {
  const { step, hostedEmailDomain, hostedEmailAddress, isDev = false } = options;

  const screen =
    step === 'alias'
      ? renderAliasScreen(hostedEmailDomain)
      : step === 'children'
      ? renderChildrenScreen()
      : renderForwardScreen(hostedEmailAddress ?? `your-alias@${hostedEmailDomain}`);

  const devSkipLink = isDev && step !== 'done' ? renderDevSkipLink(step) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup - Family Assistant</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      background: linear-gradient(135deg, #2A5C82 0%, #1E4562 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #1E4562;
    }
    .card {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 600px;
      width: 100%;
      padding: 40px;
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #4A6B8A;
      margin-bottom: 28px;
      font-size: 15px;
      line-height: 1.5;
    }
    .progress {
      display: flex;
      gap: 8px;
      margin-bottom: 28px;
    }
    .progress-dot {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: #E0E7ED;
    }
    .progress-dot.active { background: #2A5C82; }
    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    input[type="text"] {
      width: 100%;
      padding: 12px 14px;
      border: 2px solid #E0E7ED;
      border-radius: 10px;
      font-size: 16px;
      font-family: inherit;
      transition: border-color 0.15s;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #2A5C82;
    }
    .field { margin-bottom: 16px; }
    .alias-input-wrapper {
      display: flex;
      align-items: stretch;
      border: 2px solid #E0E7ED;
      border-radius: 10px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .alias-input-wrapper:focus-within {
      border-color: #2A5C82;
    }
    .alias-input-wrapper input {
      border: none;
      flex: 1;
      min-width: 0;
    }
    .alias-input-wrapper input:focus { outline: none; }
    .alias-suffix {
      padding: 12px 14px;
      background: #F5F7FA;
      color: #4A6B8A;
      font-size: 15px;
      white-space: nowrap;
      display: flex;
      align-items: center;
    }
    .help-text {
      font-size: 13px;
      color: #4A6B8A;
      margin-top: 6px;
    }
    .error {
      background: #FEF2F2;
      color: #B91C1C;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      margin-bottom: 16px;
      display: none;
    }
    .error.visible { display: block; }
    .btn {
      background: #2A5C82;
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: background 0.15s;
      font-family: inherit;
    }
    .btn:hover:not(:disabled) { background: #1E4562; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: transparent;
      color: #2A5C82;
      border: 2px solid #E0E7ED;
      margin-bottom: 12px;
    }
    .btn-secondary:hover:not(:disabled) {
      background: #F5F7FA;
      border-color: #2A5C82;
    }
    .child-row {
      display: grid;
      grid-template-columns: 1fr 140px auto;
      gap: 8px;
      margin-bottom: 12px;
      align-items: start;
    }
    .child-row .remove-btn {
      background: #FEE2E2;
      border: none;
      color: #B91C1C;
      cursor: pointer;
      font-size: 20px;
      font-weight: 500;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      align-self: center;
      transition: background 0.15s, color 0.15s;
    }
    .child-row .remove-btn:hover {
      background: #DC2626;
      color: white;
    }
    .child-row .remove-btn:focus-visible {
      outline: 2px solid #DC2626;
      outline-offset: 2px;
    }
    /* Always keep at least one row — the first row can't be removed. */
    .child-row:first-child .remove-btn { display: none; }
    .alias-display {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #F5F7FA;
      border: 2px dashed #2A5C82;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 20px;
    }
    .alias-text {
      flex: 1;
      font-family: 'Courier New', monospace;
      font-size: 16px;
      word-break: break-all;
      min-width: 0;
    }
    .copy-icon-btn {
      flex-shrink: 0;
      background: transparent;
      border: none;
      color: #2A5C82;
      cursor: pointer;
      padding: 6px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .copy-icon-btn:hover { background: #E0E7ED; }
    .copy-icon-btn .icon-check { display: none; }
    .copy-icon-btn.copied { color: #15803D; }
    .copy-icon-btn.copied .icon-copy { display: none; }
    .copy-icon-btn.copied .icon-check { display: block; }
    .step-list {
      list-style: none;
      counter-reset: step;
      margin-bottom: 24px;
    }
    .step-list li {
      counter-increment: step;
      padding-left: 36px;
      position: relative;
      margin-bottom: 12px;
      line-height: 1.5;
      font-size: 15px;
    }
    .step-list li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 0;
      width: 24px;
      height: 24px;
      background: #2A5C82;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
    }
    .waiting {
      text-align: center;
      padding: 20px;
      background: #F5F7FA;
      border-radius: 10px;
      color: #4A6B8A;
      font-size: 14px;
    }
    .waiting-spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #E0E7ED;
      border-top-color: #2A5C82;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .dev-skip {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px dashed #E0E7ED;
      text-align: center;
    }
    .dev-skip-btn {
      background: transparent;
      border: none;
      color: #94A3B8;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      text-decoration: underline;
      padding: 4px 8px;
    }
    .dev-skip-btn:hover { color: #64748B; }

    @media (max-width: 480px) {
      body {
        padding: 12px;
        align-items: flex-start;
      }
      .card {
        padding: 24px 20px;
        border-radius: 16px;
      }
      h1 {
        font-size: 22px;
        line-height: 1.25;
      }
      .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }
      .alias-suffix {
        font-size: 13px;
        padding: 10px 10px;
      }
      input[type="text"] {
        font-size: 16px; /* keep 16px+ to suppress iOS auto-zoom on focus */
      }
      /* Stack the children form: name + remove on top row, year-group full-width below.
         For the first row (no remove button), the third column collapses to 0px. */
      .child-row {
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        column-gap: 8px;
        row-gap: 8px;
      }
      .child-row > input[name="real_name"] { grid-column: 1; grid-row: 1; }
      .child-row > input[name="year_group"] { grid-column: 1 / -1; grid-row: 2; }
      .child-row > .remove-btn { grid-column: 2; grid-row: 1; }
      .alias-text {
        font-size: 14px;
      }
      .step-list li {
        font-size: 14px;
        padding-left: 32px;
      }
      .copy-icon-btn {
        padding: 8px; /* slightly larger thumb target */
      }
    }
  </style>
</head>
<body>
  <div class="card">
    ${renderProgress(step)}
    ${screen}
    ${devSkipLink}
  </div>
</body>
</html>`;
}

function renderDevSkipLink(step: Exclude<OnboardingStep, 'done'>): string {
  return `
    <div class="dev-skip">
      <button type="button" class="dev-skip-btn" id="dev-skip-btn" data-step="${step}">
        Skip this step (dev only — restored on next login)
      </button>
    </div>
    <script>
      document.getElementById('dev-skip-btn').addEventListener('click', async () => {
        try {
          await fetch('/onboarding/dev-skip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: ${JSON.stringify(step)} }),
          });
          window.location.href = '/onboarding';
        } catch (err) {
          alert('Failed to skip step');
        }
      });
    </script>
  `;
}

function renderProgress(step: OnboardingStep): string {
  const order: OnboardingStep[] = ['alias', 'children', 'forward'];
  const idx = order.indexOf(step);
  return `<div class="progress">
    ${order.map((_, i) => `<div class="progress-dot${i <= idx ? ' active' : ''}"></div>`).join('')}
  </div>`;
}

function renderAliasScreen(domain: string): string {
  return `
    <h1>Choose your inbox address</h1>
    <p class="subtitle">This is the email address you'll forward school messages to. We'll turn them into a daily summary.</p>
    <div id="error" class="error"></div>
    <form id="alias-form">
      <div class="field">
        <label for="alias">Pick an alias</label>
        <div class="alias-input-wrapper">
          <input type="text" id="alias" name="alias" autocomplete="off" autocapitalize="off" autofocus required minlength="2" maxlength="30" placeholder="e.g. toby">
          <span class="alias-suffix">@${domain}</span>
        </div>
        <p class="help-text">Letters, numbers, dots, hyphens and underscores. 2-30 characters.</p>
      </div>
      <button type="submit" class="btn" id="submit-btn">Continue</button>
    </form>
    <script>
      const form = document.getElementById('alias-form');
      const errorBox = document.getElementById('error');
      const submitBtn = document.getElementById('submit-btn');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.classList.remove('visible');
        const alias = document.getElementById('alias').value.trim();
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
        try {
          const res = await fetch('/onboarding/set-alias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias }),
          });
          const data = await res.json();
          if (!res.ok) {
            errorBox.textContent = data.error || 'Could not save alias';
            errorBox.classList.add('visible');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue';
            return;
          }
          window.location.href = '/onboarding';
        } catch (err) {
          errorBox.textContent = 'Network error — please try again';
          errorBox.classList.add('visible');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continue';
        }
      });
    </script>
  `;
}

function renderChildrenScreen(): string {
  return `
    <h1>Add your children</h1>
    <p class="subtitle">We use these names to tag todos and events from school emails.</p>
    <div id="error" class="error"></div>
    <form id="children-form">
      <div id="children-list">
        ${renderChildRow()}
      </div>
      <button type="button" class="btn btn-secondary" id="add-child-btn">+ Add another child</button>
      <button type="submit" class="btn" id="submit-btn">Continue</button>
    </form>
    <template id="child-row-template">${renderChildRow()}</template>
    <script>
      const list = document.getElementById('children-list');
      const template = document.getElementById('child-row-template');
      const errorBox = document.getElementById('error');
      const submitBtn = document.getElementById('submit-btn');

      document.getElementById('add-child-btn').addEventListener('click', () => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = template.innerHTML.trim();
        list.appendChild(wrapper.firstElementChild);
      });

      // Remove a child row. CSS hides the button on the first child, so the
      // user can never delete the last remaining row.
      list.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) {
          e.target.closest('.child-row').remove();
        }
      });

      document.getElementById('children-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.classList.remove('visible');
        const rows = list.querySelectorAll('.child-row');
        const profiles = [];
        for (const row of rows) {
          const name = row.querySelector('input[name="real_name"]').value.trim();
          const yearGroup = row.querySelector('input[name="year_group"]').value.trim();
          if (name) {
            profiles.push({
              real_name: name,
              year_group: yearGroup || undefined,
            });
          }
        }
        if (profiles.length === 0) {
          errorBox.textContent = 'Add at least one child';
          errorBox.classList.add('visible');
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';
        try {
          const res = await fetch('/onboarding/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profiles }),
          });
          const data = await res.json();
          if (!res.ok) {
            errorBox.textContent = data.error || 'Could not save profiles';
            errorBox.classList.add('visible');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue';
            return;
          }
          window.location.href = '/onboarding';
        } catch (err) {
          errorBox.textContent = 'Network error — please try again';
          errorBox.classList.add('visible');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continue';
        }
      });
    </script>
  `;
}

function renderChildRow(): string {
  return `<div class="child-row">
    <input type="text" name="real_name" placeholder="Child's name" required>
    <input type="text" name="year_group" placeholder="Year group (optional)">
    <button type="button" class="remove-btn" aria-label="Remove">×</button>
  </div>`;
}

function renderForwardScreen(emailAddress: string): string {
  return `
    <h1>Forward your first emails</h1>
    <p class="subtitle">Send us the latest newsletter or bulletin from each of your children's schools. We'll process them overnight and email you a summary in the morning.</p>
    <div class="alias-display">
      <span class="alias-text">${emailAddress}</span>
      <button type="button" class="copy-icon-btn" id="copy-btn" aria-label="Copy address" title="Copy address">
        <svg class="icon-copy" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <svg class="icon-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
    </div>
    <ol class="step-list">
      <li>Open your inbox and find the most recent email from each school.</li>
      <li>Forward each one to <strong>${emailAddress}</strong>.</li>
      <li>Come back tomorrow morning — your first daily briefing will be waiting.</li>
    </ol>
    <div class="waiting">
      <span class="waiting-spinner"></span>
      <span id="waiting-text">Waiting for your first email…</span>
    </div>
    <script>
      const copyBtn = document.getElementById('copy-btn');
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(${JSON.stringify(emailAddress)});
          copyBtn.classList.add('copied');
          copyBtn.setAttribute('title', 'Copied!');
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.setAttribute('title', 'Copy address');
          }, 2000);
        } catch (err) {
          copyBtn.setAttribute('title', 'Press Ctrl+C to copy');
        }
      });

      async function pollEmails() {
        try {
          const res = await fetch('/onboarding/hosted-email-count');
          const data = await res.json();
          if (data.count > 0) {
            document.getElementById('waiting-text').textContent = 'Got it! Taking you to your dashboard…';
            setTimeout(() => { window.location.href = '/dashboard'; }, 800);
            return;
          }
        } catch (err) {
          // ignore, retry next tick
        }
        setTimeout(pollEmails, 5000);
      }
      pollEmails();
    </script>
  `;
}
