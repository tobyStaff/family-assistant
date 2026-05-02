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
}

export function renderOnboardingPage(options: OnboardingPageOptions): string {
  const { step, hostedEmailDomain, hostedEmailAddress } = options;

  const screen =
    step === 'alias'
      ? renderAliasScreen(hostedEmailDomain)
      : step === 'children'
      ? renderChildrenScreen()
      : renderForwardScreen(hostedEmailAddress ?? `your-alias@${hostedEmailDomain}`);

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
      background: transparent;
      border: none;
      color: #B91C1C;
      cursor: pointer;
      font-size: 18px;
      padding: 12px;
      align-self: center;
    }
    .alias-display {
      background: #F5F7FA;
      border: 2px dashed #2A5C82;
      border-radius: 10px;
      padding: 16px;
      font-family: 'Courier New', monospace;
      font-size: 16px;
      text-align: center;
      margin-bottom: 20px;
      word-break: break-all;
    }
    .copy-btn {
      background: transparent;
      border: none;
      color: #2A5C82;
      cursor: pointer;
      font-size: 13px;
      margin-top: 6px;
      text-decoration: underline;
    }
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
  </style>
</head>
<body>
  <div class="card">
    ${renderProgress(step)}
    ${screen}
  </div>
</body>
</html>`;
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

      list.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-btn')) {
          if (list.children.length > 1) {
            e.target.closest('.child-row').remove();
          }
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
    <div class="alias-display" id="alias-display">${emailAddress}</div>
    <button type="button" class="copy-btn" id="copy-btn">Copy address</button>
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
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy address'; }, 2000);
        } catch (err) {
          copyBtn.textContent = 'Press Ctrl+C to copy';
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
