// src/templates/onboardingContent.ts

export interface OnboardingPageOptions {
  currentStep: number;
  gmailConnected: boolean | undefined;
  onboardingPath: string | null;
  userIsAdmin: boolean;
  hostedAlias: string | null;
  hostedEmailAddress: string;
  hostedConfirmationUrl: string | null;
}

export function renderOnboardingPage(options: OnboardingPageOptions): string {
  const {
    currentStep,
    gmailConnected,
    onboardingPath,
    userIsAdmin,
    hostedAlias,
    hostedEmailAddress,
    hostedConfirmationUrl,
  } = options;

  return `      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Setup - Family Assistant</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            background: linear-gradient(135deg, #2A5C82 0%, #1E4562 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 900px;
            width: 100%;
            padding: 40px;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #E0E7ED;
          }
          h1 {
            font-family: 'Fraunces', Georgia, serif;
            font-size: 28px;
            color: #1E4562;
            font-weight: 600;
          }
          .back-link {
            color: #2A5C82;
            text-decoration: none;
            font-size: 14px;
          }
          .back-link:hover {
            text-decoration: underline;
          }

          /* Steps indicator */
          .steps {
            display: flex;
            justify-content: space-between;
            margin-bottom: 40px;
            position: relative;
          }
          .steps::before {
            content: '';
            position: absolute;
            top: 20px;
            left: 0;
            right: 0;
            height: 2px;
            background: #E0E7ED;
            z-index: 0;
          }
          .step {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            z-index: 1;
            flex: 1;
          }
          .step-number {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #E0E7ED;
            color: #7A8FA3;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            margin-bottom: 8px;
          }
          .step.active .step-number {
            background: #2A5C82;
            color: white;
          }
          .step.completed .step-number {
            background: #4CAF50;
            color: white;
          }
          .step-label {
            font-size: 12px;
            color: #4A6B8A;
            text-align: center;
          }

          /* Content sections */
          .step-content {
            display: none;
          }
          .step-content.active {
            display: block;
          }

          /* Welcome screen */
          .welcome-content {
            text-align: center;
            padding: 40px 0;
          }
          .welcome-icon {
            font-size: 80px;
            margin-bottom: 20px;
          }
          .welcome-content h2 {
            font-family: 'Fraunces', Georgia, serif;
            font-size: 24px;
            color: #1E4562;
            margin-bottom: 16px;
            font-weight: 600;
          }
          .welcome-content p {
            font-size: 16px;
            color: #4A6B8A;
            line-height: 1.6;
            margin-bottom: 12px;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
          }
          .feature-list {
            text-align: left;
            max-width: 500px;
            margin: 30px auto;
            background: #FAF9F6;
            padding: 24px 28px;
            border-radius: 12px;
            border: 1px solid #E0E7ED;
          }
          .feature-list strong {
            display: block;
            margin-bottom: 12px;
            color: #1E4562;
          }
          .feature-list ul {
            padding-left: 24px;
            margin: 0;
          }
          .feature-list li {
            padding: 8px 0;
            color: #4A6B8A;
          }

          /* Analysis screen */
          .analysis-content {
            text-align: center;
            padding: 60px 0;
          }
          .spinner {
            border: 4px solid #E0E7ED;
            border-top: 4px solid #2A5C82;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .analysis-status {
            font-size: 18px;
            color: #1E4562;
            margin-bottom: 12px;
          }
          .analysis-detail {
            font-size: 14px;
            color: #4A6B8A;
          }

          /* Enhanced Loading States */
          .loading-container {
            text-align: center;
            padding: 40px 20px;
          }
          .loading-dots {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            margin-bottom: 20px;
          }
          .loading-dots .dot {
            width: 12px;
            height: 12px;
            background: #2A5C82;
            border-radius: 50%;
            animation: bounce 1.4s ease-in-out infinite both;
          }
          .loading-dots .dot:nth-child(1) { animation-delay: -0.32s; }
          .loading-dots .dot:nth-child(2) { animation-delay: -0.16s; }
          .loading-dots .dot:nth-child(3) { animation-delay: 0s; }
          @keyframes bounce {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
          }
          .loading-title {
            font-size: 18px;
            font-weight: 600;
            color: #1E4562;
            margin-bottom: 8px;
          }
          .loading-subtitle {
            font-size: 14px;
            color: #4A6B8A;
            margin-bottom: 20px;
          }
          .loading-time-estimate {
            font-size: 13px;
            color: #7A8FA3;
            background: #FAF9F6;
            padding: 8px 16px;
            border-radius: 20px;
            display: inline-block;
            margin-top: 8px;
          }
          .progress-container {
            width: 100%;
            max-width: 400px;
            margin: 0 auto 16px;
          }
          .progress-bar-bg {
            height: 8px;
            background: #E0E7ED;
            border-radius: 4px;
            overflow: hidden;
          }
          .progress-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #2A5C82 0%, #1E4562 100%);
            border-radius: 4px;
            width: 0%;
            transition: width 0.5s ease-out;
          }
          .progress-percent {
            font-size: 13px;
            color: #2A5C82;
            font-weight: 600;
            margin-top: 8px;
          }

          /* Review screen */
          .review-header {
            margin-bottom: 30px;
          }
          .review-header h2 {
            font-family: 'Fraunces', Georgia, serif;
            font-size: 22px;
            color: #1E4562;
            margin-bottom: 8px;
            font-weight: 600;
          }
          .review-header p {
            color: #4A6B8A;
            font-size: 14px;
          }
          .child-cards {
            display: grid;
            gap: 20px;
            margin-bottom: 30px;
          }
          .child-card {
            background: #FAF9F6;
            border: 2px solid #E0E7ED;
            border-radius: 12px;
            padding: 20px;
            position: relative;
          }
          .child-card.low-confidence {
            border-color: #F59E0B;
            background: #FFF8E1;
          }
          .confidence-badge {
            position: absolute;
            top: 16px;
            right: 16px;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
          }
          .confidence-high {
            background: #E8F5E9;
            color: #2E7D32;
          }
          .confidence-medium {
            background: #FFF8E1;
            color: #8B6914;
          }
          .confidence-low {
            background: #FFEBEE;
            color: #B71C1C;
          }
          .card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
          }
          .card-icon {
            font-size: 32px;
          }
          .card-title {
            font-family: 'Fraunces', Georgia, serif;
            font-size: 20px;
            font-weight: 600;
            color: #1E4562;
          }
          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
          }
          .form-group {
            margin-bottom: 16px;
          }
          .form-group label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: #4A6B8A;
            margin-bottom: 6px;
          }
          .form-group input,
          .form-group select {
            width: 100%;
            padding: 10px 12px;
            border: 2px solid #E0E7ED;
            border-radius: 8px;
            font-size: 14px;
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            transition: border-color 0.2s;
          }
          .form-group input:focus,
          .form-group select:focus {
            outline: none;
            border-color: #2A5C82;
          }
          .help-text {
            font-size: 12px;
            color: #7A8FA3;
            margin-top: 4px;
          }
          .example-emails {
            margin-top: 16px;
            padding-top: 16px;
            border-top: 1px solid #E0E7ED;
          }
          .example-emails summary {
            cursor: pointer;
            font-size: 13px;
            color: #2A5C82;
            font-weight: 500;
            user-select: none;
          }
          .example-emails ul {
            margin-top: 8px;
            padding-left: 20px;
          }
          .example-emails li {
            font-size: 13px;
            color: #4A6B8A;
            padding: 4px 0;
          }
          .btn-remove-card {
            background: #E53935;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            margin-top: 12px;
            font-weight: 600;
            transition: all 0.2s;
          }
          .btn-remove-card:hover {
            background: #B71C1C;
          }

          /* Buttons */
          .button-group {
            display: flex;
            gap: 12px;
            justify-content: center;
            margin-top: 30px;
          }
          .btn {
            padding: 14px 32px;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
          }
          .btn-primary {
            background: #2A5C82;
            color: white;
          }
          .btn-primary:hover {
            background: #1E4562;
            box-shadow: 0 4px 12px rgba(42, 92, 130, 0.3);
          }
          .btn-primary:disabled {
            background: #E0E7ED;
            color: #7A8FA3;
            cursor: not-allowed;
            box-shadow: none;
          }
          .btn-secondary {
            background: #4A6B8A;
            color: white;
          }
          .btn-secondary:hover {
            background: #3A5670;
          }
          .btn-add {
            background: #4CAF50;
            color: white;
            padding: 10px 20px;
            font-size: 14px;
          }
          .btn-add:hover {
            background: #388E3C;
            box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
          }

          /* Messages */
          .message {
            padding: 12px 16px;
            border-radius: 12px;
            margin-bottom: 20px;
            display: none;
            font-weight: 500;
          }
          .message.success {
            background: #E8F5E9;
            color: #2E7D32;
            border: 1px solid #C8E6C9;
            display: block;
          }
          .message.error {
            background: #FFEBEE;
            color: #B71C1C;
            border: 1px solid #FFCDD2;
            display: block;
          }
          .message.warning {
            background: #FFF8E1;
            color: #8B6914;
            border: 1px solid #FFE082;
            display: block;
          }

          /* Empty state */
          .empty-state {
            text-align: center;
            padding: 60px 40px;
            background: #FAF9F6;
            border-radius: 12px;
            border: 2px dashed #E0E7ED;
          }
          .empty-state-icon {
            font-size: 64px;
            margin-bottom: 16px;
          }
          .empty-state h3 {
            font-family: 'Fraunces', Georgia, serif;
            font-size: 20px;
            color: #1E4562;
            margin-bottom: 8px;
            font-weight: 600;
          }
          .empty-state p {
            color: #4A6B8A;
            font-size: 14px;
            margin-bottom: 20px;
          }

          /* Mobile Responsive */
          @media (max-width: 768px) {
            body {
              padding: 12px;
              align-items: flex-start;
            }
            .container {
              padding: 24px 20px;
              border-radius: 16px;
              margin-top: 12px;
            }
            .header {
              margin-bottom: 20px;
              padding-bottom: 16px;
            }
            h1 {
              font-size: 24px;
            }
            .steps {
              margin-bottom: 28px;
            }
            .steps::before {
              top: 16px;
            }
            .step-number {
              width: 32px;
              height: 32px;
              font-size: 14px;
            }
            .step-label {
              font-size: 11px;
            }
            .welcome-content {
              padding: 24px 0;
            }
            .welcome-icon {
              font-size: 60px;
              margin-bottom: 16px;
            }
            .welcome-content h2 {
              font-size: 20px;
              line-height: 1.3;
            }
            .welcome-content p {
              font-size: 15px;
            }
            .feature-list {
              padding: 20px;
              margin: 24px auto;
            }
            .feature-list ul {
              padding-left: 20px;
            }
            .feature-list li {
              font-size: 14px;
              padding: 6px 0;
            }
            .form-row {
              grid-template-columns: 1fr;
              gap: 0;
            }
            .form-group input,
            .form-group select {
              font-size: 16px; /* Prevents iOS zoom on focus */
            }
            .button-group {
              flex-direction: column;
              gap: 10px;
              margin-top: 24px;
            }
            .btn {
              width: 100%;
              padding: 14px 24px;
              font-size: 15px;
            }
            .btn-add {
              width: auto;
              align-self: flex-start;
            }
            .child-card {
              padding: 16px;
            }
            .card-header {
              margin-bottom: 16px;
            }
            .card-title {
              font-size: 18px;
            }
            .confidence-badge {
              position: static;
              display: inline-block;
              margin-bottom: 12px;
            }
            .review-header h2 {
              font-size: 20px;
            }
            .empty-state {
              padding: 40px 24px;
            }
            .empty-state-icon {
              font-size: 48px;
            }
            .empty-state h3 {
              font-size: 18px;
            }
            .loading-title {
              font-size: 16px;
            }
            .loading-subtitle {
              font-size: 13px;
            }
            .progress-container {
              max-width: 100%;
            }
          }

          @media (max-width: 480px) {
            body {
              padding: 8px;
            }
            .container {
              padding: 20px 16px;
              border-radius: 12px;
            }
            h1 {
              font-size: 22px;
            }
            .step-number {
              width: 28px;
              height: 28px;
              font-size: 13px;
            }
            .step-label {
              font-size: 10px;
            }
            .welcome-content h2 {
              font-size: 18px;
            }
            .feature-list {
              padding: 16px;
            }
            .feature-list li {
              font-size: 13px;
            }
          }

          /* Path selection cards */
          .path-cards {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin: 30px 0;
          }
          @media (max-width: 600px) {
            .path-cards {
              grid-template-columns: 1fr;
            }
          }
          .path-card {
            border: 2px solid #E0E7ED;
            border-radius: 16px;
            padding: 24px;
            cursor: pointer;
            transition: all 0.2s;
            background: white;
            text-align: left;
            position: relative;
          }
          .path-card:hover {
            border-color: #2A5C82;
            box-shadow: 0 4px 16px rgba(42, 92, 130, 0.12);
          }
          .path-card-badge {
            position: absolute;
            top: 16px;
            right: 16px;
            padding: 3px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .badge-recommended {
            background: #E8F5E9;
            color: #2E7D32;
          }
          .badge-beta {
            background: #E3F2FD;
            color: #1565C0;
          }
          .path-card-icon {
            font-size: 40px;
            margin-bottom: 12px;
          }
          .path-card h3 {
            font-family: 'Fraunces', Georgia, serif;
            font-size: 18px;
            color: #1E4562;
            margin-bottom: 8px;
            font-weight: 600;
          }
          .path-card p {
            font-size: 13px;
            color: #4A6B8A;
            line-height: 1.5;
            margin-bottom: 16px;
          }
          .path-card ul {
            padding-left: 18px;
            margin-bottom: 20px;
          }
          .path-card ul li {
            font-size: 13px;
            color: #4A6B8A;
            padding: 3px 0;
          }
          .path-card .btn {
            width: 100%;
            text-align: center;
          }
          .path-card-disabled {
            opacity: 0.45;
            cursor: default;
            pointer-events: none;
          }
          .path-card-disabled:hover {
            border-color: #E0E7ED;
            box-shadow: none;
          }

          /* Alias setup */
          .alias-input-group {
            display: flex;
            align-items: center;
            gap: 0;
            border: 2px solid #E0E7ED;
            border-radius: 10px;
            overflow: hidden;
            max-width: 520px;
            margin: 0 auto 8px;
          }
          .alias-input-group:focus-within {
            border-color: #2A5C82;
          }
          .alias-input-group input {
            flex: 1;
            padding: 12px 14px;
            border: none;
            outline: none;
            font-size: 16px;
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            background: white;
          }
          .alias-input-group .alias-suffix {
            padding: 12px 14px;
            background: #F5F7FA;
            color: #4A6B8A;
            font-size: 14px;
            white-space: nowrap;
            border-left: 2px solid #E0E7ED;
          }

          /* Copy to clipboard */
          .copy-box {
            display: flex;
            align-items: center;
            gap: 10px;
            background: #F5F7FA;
            border: 2px solid #E0E7ED;
            border-radius: 10px;
            padding: 12px 16px;
            max-width: 500px;
            margin: 0 auto 20px;
          }
          .copy-box .copy-value {
            flex: 1;
            font-size: 15px;
            font-weight: 600;
            color: #1E4562;
            word-break: break-all;
          }
          .btn-copy {
            flex-shrink: 0;
            background: #2A5C82;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
          }
          .btn-copy:hover {
            background: #1E4562;
          }

          /* Email counter */
          .email-counter {
            text-align: center;
            margin: 24px 0;
          }
          .counter-ring {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            border: 6px solid #E0E7ED;
            font-size: 28px;
            font-weight: 700;
            color: #1E4562;
            margin-bottom: 8px;
            position: relative;
          }
          .counter-ring.ready {
            border-color: #4CAF50;
            color: #2E7D32;
          }
          .counter-label {
            font-size: 14px;
            color: #4A6B8A;
          }

          /* Forwarding instructions */
          .forwarding-steps {
            text-align: left;
            max-width: 560px;
            margin: 20px auto;
            background: #FAF9F6;
            border: 1px solid #E0E7ED;
            border-radius: 12px;
            padding: 20px 24px;
          }
          .forwarding-steps h4 {
            font-size: 14px;
            font-weight: 600;
            color: #1E4562;
            margin-bottom: 12px;
          }
          .forwarding-steps ol {
            padding-left: 22px;
            margin: 0;
          }
          .forwarding-steps li {
            font-size: 13px;
            color: #4A6B8A;
            padding: 5px 0;
            line-height: 1.5;
          }
          .forwarding-steps code {
            background: #E8F0F8;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            color: #1E4562;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Family Assistant</h1>
            ${userIsAdmin ? `
            <form method="POST" action="/admin/skip-onboarding" style="margin:0">
              <button type="submit" style="background:none;border:none;color:#9CA3AF;font-size:13px;cursor:pointer;padding:0;font-family:inherit">
                Skip setup →
              </button>
            </form>` : ''}
          </div>

          <div id="message" class="message"></div>
          <!-- debug: onboarding_step=${currentStep} gmail_connected=${gmailConnected} onboarding_path=${onboardingPath} -->
          <script>let ONBOARDING_PATH = '${onboardingPath ?? ''}';</script>

          <!-- Steps indicator -->
          <div class="steps" id="steps-indicator" ${!onboardingPath && currentStep <= 1 ? 'style="display:none"' : ''}>
            <div class="step ${currentStep >= 1 ? (currentStep >= 2 ? 'completed' : 'active') : ''}" id="step-indicator-1">
              <div class="step-number">1</div>
              <div class="step-label" id="step-label-1">Children</div>
            </div>
            <div class="step ${currentStep >= 2 ? (currentStep >= 3 ? 'completed' : 'active') : ''}" id="step-indicator-2">
              <div class="step-number">2</div>
              <div class="step-label" id="step-label-2">${onboardingPath === 'hosted' ? 'Alias' : 'Connect'}</div>
            </div>
            <div class="step ${currentStep >= 3 ? (currentStep >= 5 ? 'completed' : 'active') : ''}" id="step-indicator-3">
              <div class="step-number">3</div>
              <div class="step-label" id="step-label-3">${onboardingPath === 'hosted' ? 'Emails' : 'Senders'}</div>
            </div>
            <div class="step ${currentStep >= 5 ? 'active' : ''}" id="step-indicator-4">
              <div class="step-number">4</div>
              <div class="step-label">Briefing</div>
            </div>
          </div>

          <!-- Path selection screen (shown before path is chosen) -->
          <div class="step-content ${!onboardingPath && currentStep <= 1 ? 'active' : ''}" id="step-path-select">
            <div class="welcome-content">
              <div class="welcome-icon">✉️</div>
              <h2>How would you like to receive your school emails?</h2>
              <p>Choose how to connect your school inbox to Family Assistant.</p>

              <div class="path-cards">
                <div class="path-card">
                  <span class="path-card-badge badge-recommended">Recommended</span>
                  <div class="path-card-icon">📬</div>
                  <h3>Hosted Email</h3>
                  <p>Forward school emails to a dedicated address we manage for you.</p>
                  <ul>
                    <li>No Gmail permission required</li>
                    <li>Works with any email provider</li>
                    <li>You control exactly what we see</li>
                  </ul>
                  <button class="btn btn-primary" onclick="choosePath('hosted')">Get Started</button>
                </div>
                <div class="path-card${userIsAdmin ? '' : ' path-card-disabled'}">
                  <span class="path-card-badge badge-beta">Beta</span>
                  <div class="path-card-icon">📧</div>
                  <h3>Connect Gmail</h3>
                  <p>Grant read access to your Gmail inbox so we can scan for school emails.</p>
                  <ul>
                    <li>Scans existing inbox automatically</li>
                    <li>Requires Gmail OAuth permission</li>
                    <li>You choose which senders to include</li>
                  </ul>
                  <button class="btn btn-secondary" onclick="choosePath('gmail')" ${userIsAdmin ? '' : 'disabled'}>${userIsAdmin ? 'Connect Gmail' : 'Coming Soon'}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Hosted: Alias setup -->
          <div class="step-content ${onboardingPath === 'hosted' && currentStep === 2 ? 'active' : ''}" id="step-alias">
            <div class="welcome-content">
              <div class="welcome-icon">📬</div>
              <h2>Choose your email alias</h2>
              <p>This is where you'll forward school emails. Pick something memorable.</p>

              <div class="alias-input-group">
                <input type="text" id="alias-input" placeholder="yourname" oninput="updateAliasPreview(this.value)" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
                <span class="alias-suffix">@inbox.getfamilyassistant.com</span>
              </div>
              <div id="alias-feedback" style="font-size:13px;color:#7A8FA3;margin-bottom:20px;text-align:center;"></div>

              <div class="button-group">
                <button class="btn btn-primary" onclick="setAlias()" id="alias-btn" disabled>Continue</button>
              </div>
            </div>
          </div>

          <!-- Hosted: Forward emails -->
          <div class="step-content ${onboardingPath === 'hosted' && currentStep === 3 ? 'active' : ''}" id="step-forward-emails">
            <div class="welcome-content">
              <div class="welcome-icon">📬</div>
              <h2>Forward school emails to your inbox</h2>
              <p>Forward at least <strong>3</strong> school emails to your Family Assistant address. We'll detect them automatically.</p>

              <div class="copy-box">
                <span class="copy-value" id="hosted-alias-display">${hostedAlias ? `${hostedAlias}@inbox.getfamilyassistant.com` : ''}</span>
                <button class="btn-copy" onclick="copyAlias()">Copy</button>
              </div>

              <div class="email-counter">
                <div class="counter-ring" id="forward-counter-ring">
                  <span id="forward-counter-num">0</span>
                </div>
                <div class="counter-label" id="forward-counter-label">of 3 emails received</div>
              </div>

              <p style="font-size:13px;color:#4A6B8A;margin-bottom:20px;">We check every 5 seconds.</p>

              <div class="button-group" id="forward-btn-group">
                <button class="btn btn-primary" onclick="processHostedEmails()" id="process-btn" disabled>Continue</button>
              </div>
              <div id="process-loading" style="display:none;"></div>
            </div>
          </div>

          <!-- Step 2 (Gmail path): Welcome + Connect Gmail -->
          <div class="step-content ${onboardingPath === 'gmail' && currentStep === 2 ? 'active' : ''}" id="step-welcome">
            <div class="welcome-content">
              <div class="welcome-icon">👋</div>
              <h2>Welcome! Let's set up your family assistant in 4 steps.</h2>
              <p>To build your daily briefing, our AI needs to look for school signals in your inbox.</p>

              <div class="feature-list">
                <strong>You stay in control:</strong>
                <ul>
                  <li>We only process senders you explicitly approve in the next step</li>
                  <li>We do not store any messages other than from your approved senders</li>
                  <li>We do not sell your data to a 3rd party</li>
                  <li>We extract school events, todos, and key info</li>
                </ul>
              </div>

              <div class="button-group">
                <a href="/auth/google/connect-gmail" class="btn btn-primary" style="text-decoration:none;">Connect your Gmail inbox</a>
              </div>
            </div>
          </div>

          <!-- Step 3 (Gmail path): Gmail connected, scan inbox -->
          <div class="step-content ${onboardingPath === 'gmail' && currentStep === 3 ? 'active' : ''}" id="step-scan">
            <div class="welcome-content">
              <div class="welcome-icon">✅</div>
              <h2>Gmail connected!</h2>
              <p>Now let's scan your inbox to find school and family-related senders.</p>
              <p>You'll choose which senders to include or exclude.</p>

              <div id="scan-initial" class="button-group">
                <button class="btn btn-primary" onclick="scanInbox()" id="scan-btn">Scan Inbox</button>
              </div>
              <div id="scan-loading" style="display:none;"></div>
            </div>
          </div>

          <!-- Step 3: Sender selection (Gmail path only) -->
          <div class="step-content ${onboardingPath === 'gmail' && currentStep === 3 ? 'active' : ''}" id="step-senders">
            <div class="review-header">
              <h2 id="sender-step-title">Select senders to monitor</h2>
              <p id="sender-step-subtitle">These look like school and family contacts.</p>
            </div>

            <!-- Progress bar -->
            <div id="sender-progress" style="background:#FAF9F6;border-radius:12px;padding:16px;margin-bottom:24px;border:1px solid #E0E7ED;">
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;margin-bottom:8px;gap:4px;">
                <span id="progress-count" style="font-weight:600;font-size:14px;color:#1E4562;">0 senders included</span>
                <span id="progress-hint" style="font-size:12px;color:#7A8FA3;">Select senders to monitor</span>
              </div>
              <div style="height:6px;background:#E0E7ED;border-radius:3px;overflow:hidden;">
                <div id="progress-bar" style="height:100%;background:#2A5C82;border-radius:3px;transition:width 0.3s;width:0%;"></div>
              </div>
            </div>

            <div id="sender-list">
              <!-- Sender sections rendered by JS -->
            </div>

            <div class="button-group">
              <button class="btn btn-primary" onclick="continueToSubStepB()" id="substep-continue-btn">Continue</button>
              <button class="btn btn-primary" onclick="saveSenders()" id="save-senders-btn" style="display:none;">Confirm sender selection</button>
            </div>
          </div>

          <!-- Step 3b: School confirmation -->
          <div class="step-content" id="step-schools">
            <div class="review-header">
              <h2>Confirm your schools</h2>
              <p>We detected these from your selected senders. Edit if needed.</p>
            </div>
            <div id="school-list"></div>
            <button class="btn btn-add" onclick="addSchoolManually()">+ Add school</button>
            <div class="button-group">
              <button class="btn btn-primary" onclick="confirmSchools()" id="confirm-schools-btn">Continue</button>
            </div>
          </div>

          <!-- Step 4: Train AI - grade extracted items -->
          <div class="step-content" id="step-train">
            <div class="review-header">
              <h2>Train your assistant</h2>
              <p>Help us understand what's relevant to you. Grade these extracted items from your emails.</p>
            </div>

            <div id="train-loading" style="display:none;"></div>

            <div id="train-items" style="display:none;">
              <div style="background:#FAF9F6;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #E0E7ED;">
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;">
                  <span id="train-progress" style="font-weight:600;font-size:14px;color:#1E4562;">0 of 0 items graded</span>
                  <span style="font-size:13px;color:#7A8FA3;">Tap Relevant or Not Relevant</span>
                </div>
              </div>

              <div id="train-items-list" class="child-cards"></div>

              <div id="train-empty" style="display:none;text-align:center;padding:40px;background:#FAF9F6;border-radius:12px;border:2px dashed #E0E7ED;">
                <div style="font-size:48px;margin-bottom:16px;">📭</div>
                <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">No items found</h3>
                <p style="color:#4A6B8A;font-size:14px;">We couldn't extract any todos or events from your emails. You can skip this step.</p>
              </div>
            </div>

            <div class="button-group">
              <button class="btn btn-secondary" onclick="skipTraining()" id="skip-train-btn">Skip for now</button>
              <button class="btn btn-primary" onclick="saveTrainingAndContinue()" id="save-train-btn" disabled>Continue</button>
            </div>
          </div>

          <!-- Step 5: Extracting children / analyzing -->
          <div class="step-content" id="step-analyzing">
            <div id="analyze-loading"></div>
          </div>

          <!-- Step 1: Add children manually -->
          <div class="step-content ${currentStep === 1 && !!onboardingPath ? 'active' : ''}" id="step-children">
            <div class="review-header">
              <h2>Add your children</h2>
              <p>Enter a profile for each child whose school emails you want to track.</p>
            </div>

            <div id="child-cards-container" class="child-cards"></div>

            <button class="btn btn-add" onclick="addManualChild()">+ Add Child Manually</button>

            <div class="button-group">
              <button class="btn btn-primary" onclick="confirmProfiles()" id="confirm-btn">Confirm & Save</button>
            </div>
          </div>

          <!-- Step 7: Complete -->
          <div class="step-content ${currentStep >= 5 ? 'active' : ''}" id="step-complete">
            <div class="welcome-content">
              <div class="welcome-icon">✅</div>
              <h2>Setup almost complete!</h2>

              <p>Your family assistant is ready. Generate your first briefing email to see it in action.</p>

              <div class="button-group" id="send-email-group">
                <button class="btn btn-primary" onclick="generateFirstEmail()" id="first-email-btn">Generate My First Briefing</button>
              </div>

              <div id="first-email-loading" style="display:none;"></div>
              <div id="first-email-result" style="display:none;margin-top:20px;"></div>

            </div>
          </div>
        </div>

        <script>
          let allSenders = [];
          let senderPage = 0;
          const SENDERS_PER_PAGE = 5;
          let senderSelections = {}; // email -> 'include' | 'exclude'
          let senderSubStep = 'A';
          let rerankedMidSenders = [];
          let detectedSchools = []; // { name: string, year_groups: string[] }
          let analysisResult = null;
          let childrenData = [];
          let hostedEmailCount = 0;
          let hostedEmailFull = '${hostedEmailAddress}';

          // ============================================================
          // PATH SELECTION
          // ============================================================
          async function choosePath(path) {
            try {
              const res = await fetch('/onboarding/choose-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Failed');

              // Update global path
              ONBOARDING_PATH = path;

              // Show step indicator
              document.getElementById('steps-indicator').style.display = '';

              // Both paths start with children entry
              document.getElementById('step-label-1').textContent = 'Children';
              if (path === 'hosted') {
                document.getElementById('step-label-2').textContent = 'Alias';
                document.getElementById('step-label-3').textContent = 'Emails';
              } else {
                document.getElementById('step-label-2').textContent = 'Connect';
                document.getElementById('step-label-3').textContent = 'Senders';
              }
              document.getElementById('step-indicator-1').classList.add('active');
              addManualChild();
              showStep('step-children');
            } catch (err) {
              showMessage('error', 'Failed to set path: ' + err.message);
            }
          }

          // ============================================================
          // HOSTED: ALIAS SETUP
          // ============================================================
          const RESERVED_ALIASES = ['admin', 'support', 'help', 'info', 'contact', 'mail', 'email', 'noreply', 'no-reply', 'postmaster', 'webmaster', 'abuse'];
          let aliasCheckTimer = null;

          function updateAliasPreview(value) {
            const btn = document.getElementById('alias-btn');
            const feedback = document.getElementById('alias-feedback');
            const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]/g, '');

            if (value !== cleaned) {
              document.getElementById('alias-input').value = cleaned;
            }

            // Clear any pending availability check
            if (aliasCheckTimer) clearTimeout(aliasCheckTimer);

            if (!cleaned) {
              btn.disabled = true;
              feedback.textContent = '';
              return;
            }

            if (cleaned.length < 2) {
              btn.disabled = true;
              feedback.textContent = 'Too short — minimum 2 characters';
              feedback.style.color = '#E53935';
              return;
            }

            if (cleaned.length > 30) {
              btn.disabled = true;
              feedback.textContent = 'Too long — maximum 30 characters';
              feedback.style.color = '#E53935';
              return;
            }

            if (RESERVED_ALIASES.includes(cleaned)) {
              btn.disabled = true;
              feedback.textContent = 'This alias is reserved — try another';
              feedback.style.color = '#E53935';
              return;
            }

            // Local validation passed — debounce the availability check
            btn.disabled = true;
            feedback.textContent = 'Checking availability…';
            feedback.style.color = '#7A8FA3';

            aliasCheckTimer = setTimeout(async () => {
              try {
                const res = await fetch(\`/api/settings/check-alias?alias=\${encodeURIComponent(cleaned)}\`);
                const data = await res.json();
                if (data.available) {
                  feedback.textContent = cleaned + '@inbox.getfamilyassistant.com ✓';
                  feedback.style.color = '#2E7D32';
                  btn.disabled = false;
                } else {
                  feedback.textContent = data.reason || 'Already taken — try another';
                  feedback.style.color = '#E53935';
                  btn.disabled = true;
                }
              } catch {
                // Network error — allow submission and let server validate
                feedback.textContent = cleaned + '@inbox.getfamilyassistant.com';
                feedback.style.color = '#2E7D32';
                btn.disabled = false;
              }
            }, 400);
          }

          async function setAlias() {
            const alias = document.getElementById('alias-input').value.toLowerCase().trim();
            const btn = document.getElementById('alias-btn');
            const feedback = document.getElementById('alias-feedback');

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const res = await fetch('/onboarding/set-alias', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ alias }),
              });
              const data = await res.json();

              if (res.status === 409) {
                feedback.textContent = 'This alias is taken — try another';
                feedback.style.color = '#E53935';
                btn.disabled = false;
                btn.textContent = 'Continue';
                return;
              }
              if (!res.ok) {
                feedback.textContent = data.error || 'Invalid alias';
                feedback.style.color = '#E53935';
                btn.disabled = false;
                btn.textContent = 'Continue';
                return;
              }

              // Success — show forward emails screen
              hostedEmailFull = data.email;
              document.getElementById('hosted-alias-display').textContent = data.email;
              document.querySelectorAll('.hosted-email-display').forEach(function(el) { el.textContent = data.email; });
              document.getElementById('step-indicator-2').classList.add('completed');
              document.getElementById('step-indicator-3').classList.add('active');
              showStep('step-forward-emails');
              startEmailCountPolling();
            } catch (err) {
              feedback.textContent = 'Error: ' + err.message;
              feedback.style.color = '#E53935';
              btn.disabled = false;
              btn.textContent = 'Continue';
            }
          }

          function copyAlias() {
            const text = document.getElementById('hosted-alias-display').textContent;
            navigator.clipboard.writeText(text).then(() => {
              const btn = document.querySelector('.btn-copy');
              const orig = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = orig; }, 2000);
            });
          }

          function copyHostedEmail(btn) {
            navigator.clipboard.writeText(hostedEmailFull).then(() => {
              const orig = btn.textContent;
              btn.textContent = 'Copied!';
              setTimeout(() => { btn.textContent = orig; }, 2000);
            });
          }

          // ============================================================
          // HOSTED: EMAIL COUNT POLLING
          // ============================================================
          let emailCountInterval = null;

          function startEmailCountPolling() {
            pollEmailCount();
            emailCountInterval = setInterval(pollEmailCount, 5000);
          }

          async function pollEmailCount() {
            try {
              const res = await fetch('/onboarding/hosted-email-count');
              const data = await res.json();
              const count = data.count ?? 0;
              hostedEmailCount = count;

              const numEl = document.getElementById('forward-counter-num');
              const ringEl = document.getElementById('forward-counter-ring');
              const labelEl = document.getElementById('forward-counter-label');
              const continueBtn = document.getElementById('process-btn');

              if (numEl) numEl.textContent = count;
              if (count >= 3) {
                if (ringEl) ringEl.classList.add('ready');
                if (labelEl) labelEl.textContent = 'of 3 emails received — ready!';
                if (continueBtn) continueBtn.disabled = false;
              }
            } catch (err) {
              console.error('Email count poll error:', err);
            }
          }

          // ============================================================
          // HOSTED: PROCESS EMAILS
          // ============================================================
          let processHostedPollInterval = null;

          async function processHostedEmails() {
            if (emailCountInterval) {
              clearInterval(emailCountInterval);
              emailCountInterval = null;
            }

            const processBtn = document.getElementById('process-btn');
            const loadingContainer = document.getElementById('process-loading');
            const buttonGroup = processBtn.closest('.button-group');

            buttonGroup.style.display = 'none';
            loadingContainer.innerHTML = createLoadingHTML(
              'process-hosted',
              'Analysing your emails...',
              'Extracting todos and events from your school emails',
              'This typically takes 1-2 minutes'
            );
            loadingContainer.style.display = 'block';
            startFakeProgress('process-hosted', 90000);

            try {
              const res = await fetch('/onboarding/process-hosted-emails', { method: 'POST' });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Failed to start');

              pollProcessHostedStatus();
            } catch (err) {
              completeProgress('process-hosted');
              loadingContainer.style.display = 'none';
              buttonGroup.style.display = '';
              showMessage('error', 'Processing failed: ' + err.message);
            }
          }

          async function pollProcessHostedStatus() {
            const loadingContainer = document.getElementById('process-loading');

            processHostedPollInterval = setInterval(async () => {
              try {
                const res = await fetch('/onboarding/process-hosted-emails/status');
                const data = await res.json();

                if (data.status === 'pending') {
                  updateLoadingText('process-hosted', 'Starting...', 'Checking emails');
                } else if (data.status === 'scanning') {
                  updateLoadingText('process-hosted', 'Checking emails...', 'Verifying emails are ready');
                } else if (data.status === 'complete') {
                  clearInterval(processHostedPollInterval);
                  processHostedPollInterval = null;
                  completeProgress('process-hosted');
                  updateLoadingText('process-hosted', 'Emails ready!',
                    \`\${data.emailCount || 0} emails ready for analysis\`);

                  // Emails ready — advance to briefing step
                  document.getElementById('step-indicator-3').classList.add('completed');
                  document.getElementById('step-indicator-4').classList.add('active');
                  setTimeout(() => {
                    loadingContainer.style.display = 'none';
                    showStep('step-complete');
                  }, 1200);
                } else if (data.status === 'failed') {
                  clearInterval(processHostedPollInterval);
                  processHostedPollInterval = null;
                  completeProgress('process-hosted');
                  loadingContainer.style.display = 'none';
                  showMessage('error', 'Processing failed: ' + (data.error || 'Unknown error'));
                }
              } catch (err) {
                console.error('Process hosted poll error:', err);
              }
            }, 2000);
          }

          function showStep(stepId) {
            document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
            document.getElementById(stepId).classList.add('active');
          }

          function showMessage(type, text) {
            const msg = document.getElementById('message');
            msg.className = 'message ' + type;
            msg.textContent = text;
            setTimeout(() => { msg.className = 'message'; }, 5000);
          }

          // --- Enhanced Loading State ---
          let progressIntervals = {};

          function createLoadingHTML(id, title, subtitle, timeEstimate) {
            return \`
              <div class="loading-container" id="\${id}">
                <div class="loading-dots">
                  <div class="dot"></div>
                  <div class="dot"></div>
                  <div class="dot"></div>
                </div>
                <div class="loading-title" id="\${id}-title">\${title}</div>
                <div class="loading-subtitle" id="\${id}-subtitle">\${subtitle}</div>
                <div class="progress-container">
                  <div class="progress-bar-bg">
                    <div class="progress-bar-fill" id="\${id}-progress"></div>
                  </div>
                  <div class="progress-percent" id="\${id}-percent">0%</div>
                </div>
                <div class="loading-time-estimate">\${timeEstimate}</div>
              </div>
            \`;
          }

          function startFakeProgress(id, durationMs, onComplete) {
            const progressEl = document.getElementById(id + '-progress');
            const percentEl = document.getElementById(id + '-percent');
            if (!progressEl || !percentEl) return;

            let progress = 0;
            const startTime = Date.now();

            // Clear any existing interval
            if (progressIntervals[id]) clearInterval(progressIntervals[id]);

            progressIntervals[id] = setInterval(() => {
              const elapsed = Date.now() - startTime;
              const expectedDuration = durationMs;

              // Fake progress: fast at first, then slow down
              // Never reaches 100% until explicitly completed
              const targetProgress = Math.min(95, (elapsed / expectedDuration) * 100);

              // Ease the progress - faster at start, slower near end
              if (progress < targetProgress) {
                const increment = Math.max(0.5, (targetProgress - progress) * 0.1);
                progress = Math.min(targetProgress, progress + increment);
              }

              progressEl.style.width = progress + '%';
              percentEl.textContent = Math.round(progress) + '%';
            }, 100);
          }

          function completeProgress(id) {
            if (progressIntervals[id]) {
              clearInterval(progressIntervals[id]);
              delete progressIntervals[id];
            }
            const progressEl = document.getElementById(id + '-progress');
            const percentEl = document.getElementById(id + '-percent');
            if (progressEl) progressEl.style.width = '100%';
            if (percentEl) percentEl.textContent = '100%';
          }

          function updateLoadingText(id, title, subtitle) {
            const titleEl = document.getElementById(id + '-title');
            const subtitleEl = document.getElementById(id + '-subtitle');
            if (titleEl && title) titleEl.textContent = title;
            if (subtitleEl && subtitle) subtitleEl.textContent = subtitle;
          }

          // --- Inbox scan ---
          let scanPollInterval = null;

          async function scanInbox() {
            // Hide button, show loading
            document.getElementById('scan-initial').style.display = 'none';
            const loadingContainer = document.getElementById('scan-loading');
            loadingContainer.innerHTML = createLoadingHTML(
              'scan',
              'Scanning your inbox...',
              'Looking for school and family contacts',
              'This typically takes about a minute'
            );
            loadingContainer.style.display = 'block';
            startFakeProgress('scan', 90000); // 90 second estimate for background scan

            try {
              // Start the background scan
              const res = await fetch('/onboarding/scan-inbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              });
              const data = await res.json();

              if (!res.ok) {
                // If Gmail not connected, redirect back to step 1
                if (res.status === 401 || data.error === 'Gmail not connected') {
                  completeProgress('scan');
                  showMessage('error', data.message || 'Gmail connection lost. Please reconnect.');
                  loadingContainer.style.display = 'none';
                  document.getElementById('scan-initial').style.display = '';
                  setTimeout(() => { showStep('step-welcome'); }, 2000);
                  return;
                }
                throw new Error(data.message || 'Scan failed');
              }

              // Start polling for status
              pollScanStatus();
            } catch (err) {
              completeProgress('scan');
              showMessage('error', 'Scan failed: ' + err.message);
              loadingContainer.style.display = 'none';
              document.getElementById('scan-initial').style.display = '';
            }
          }

          async function pollScanStatus() {
            const loadingContainer = document.getElementById('scan-loading');

            scanPollInterval = setInterval(async () => {
              try {
                const res = await fetch('/onboarding/scan-inbox/status');
                const data = await res.json();
                console.log('Scan status poll:', data.status, data);

                if (data.status === 'pending') {
                  updateLoadingText('scan', 'Starting scan...', 'Preparing to scan your inbox');
                } else if (data.status === 'scanning') {
                  updateLoadingText('scan', 'Scanning your inbox...', 'Fetching emails from Gmail');
                } else if (data.status === 'ranking') {
                  updateLoadingText('scan', 'Analyzing senders...', 'Using AI to identify relevant contacts');
                } else if (data.status === 'complete') {
                  clearInterval(scanPollInterval);
                  scanPollInterval = null;

                  const senders = data.senders || [];
                  completeProgress('scan');
                  updateLoadingText('scan', 'Scan complete!', 'Found ' + senders.length + ' senders');

                  allSenders = senders;
                  senderPage = 0;
                  senderSubStep = 'A';
                  rerankedMidSenders = [];

                  // step-indicator-2 (Connect) is already completed (server-rendered at step 3)
                  // step-indicator-3 (Senders) is already active; just show senders
                  setTimeout(() => {
                    renderSenderPage();
                    showStep('step-senders');
                  }, 800);
                } else if (data.status === 'failed') {
                  clearInterval(scanPollInterval);
                  scanPollInterval = null;

                  completeProgress('scan');
                  showMessage('error', 'Scan failed: ' + (data.error || 'Unknown error'));
                  loadingContainer.style.display = 'none';
                  document.getElementById('scan-initial').style.display = '';
                } else {
                  console.log('Unknown scan status:', data.status);
                }
              } catch (err) {
                // Network error - keep polling
                console.error('Poll error:', err);
              }
            }, 2000); // Poll every 2 seconds
          }

          function getCategoryBadge(category) {
            if (category === 'school') return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#E8F5E9;color:#2E7D32;">School</span>';
            if (category === 'activity') return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#E3F2FD;color:#1565C0;">Activity</span>';
            return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#F8F9FA;color:#4A6B8A;">Other</span>';
          }

          function renderSenderCard(sender) {
            const isIncluded = senderSelections[sender.email] === 'include';
            const domain = sender.email.split('@')[1] || '';
            return \`
              <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;padding:12px 16px;background:\${isIncluded ? '#E8F5E9' : '#fff'};border:2px solid \${isIncluded ? '#4CAF50' : '#E0E7ED'};border-radius:8px;margin-bottom:6px;transition:all 0.2s;gap:8px;">
                <div style="flex:1;min-width:200px;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-weight:600;font-size:14px;color:#1E4562;word-break:break-word;">\${sender.name}</span>
                    \${getCategoryBadge(sender.category || 'other')}
                  </div>
                  <div style="font-size:12px;color:#7A8FA3;margin-top:2px;word-break:break-word;">\${domain} — \${sender.subjects.slice(0,2).join(' | ')}</div>
                </div>
                <button onclick="toggleSender('\${sender.email}')"
                  style="flex-shrink:0;padding:8px 20px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;\${isIncluded
                    ? 'background:#4CAF50;color:white;'
                    : 'background:#E0E7ED;color:#4A6B8A;'}"
                >\${isIncluded ? 'Included' : 'Include'}</button>
              </div>
            \`;
          }

          function renderSenderPage() {
            const high = allSenders.filter(s => (s.relevance ?? 0) >= 0.7);
            const mid = allSenders.filter(s => (s.relevance ?? 0) >= 0.4 && (s.relevance ?? 0) < 0.7);
            const low = allSenders.filter(s => (s.relevance ?? 0) < 0.4);

            const container = document.getElementById('sender-list');
            const titleEl = document.getElementById('sender-step-title');
            const subtitleEl = document.getElementById('sender-step-subtitle');
            const continueBtn = document.getElementById('substep-continue-btn');
            const confirmBtn = document.getElementById('save-senders-btn');
            let html = '';

            if (senderSubStep === 'A') {
              // Sub-step A: show only high-relevance senders
              titleEl.textContent = 'Select senders to monitor';
              subtitleEl.textContent = 'These look like school and family contacts.';
              continueBtn.style.display = '';
              confirmBtn.style.display = 'none';

              if (high.length > 0) {
                html += \`<div style="margin-bottom:20px;">
                  <h3 style="font-size:15px;color:#2E7D32;margin-bottom:10px;padding-left:4px;border-left:3px solid #4CAF50;padding-left:10px;">Likely school & family (\${high.length})</h3>
                  \${high.map(s => renderSenderCard(s)).join('')}
                </div>\`;
              } else {
                html += \`<div style="text-align:center;padding:40px;background:#FAF9F6;border-radius:12px;border:2px dashed #E0E7ED;">
                  <div style="font-size:48px;margin-bottom:16px;">📬</div>
                  <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">No high-confidence senders found</h3>
                  <p style="color:#4A6B8A;font-size:14px;">Click Continue to review all senders.</p>
                </div>\`;
              }
            } else {
              // Sub-step B: show re-ranked mid-tier (top 15) + collapsed rest
              titleEl.textContent = 'Review more senders';
              subtitleEl.textContent = 'Based on your selections, here are more senders that might be relevant.';
              continueBtn.style.display = 'none';
              confirmBtn.style.display = '';

              const displayMid = rerankedMidSenders.length > 0 ? rerankedMidSenders : mid;
              const topSenders = displayMid.slice(0, 15);
              const restSenders = displayMid.slice(15);

              if (topSenders.length > 0) {
                html += \`<div style="margin-bottom:20px;">
                  <h3 style="font-size:15px;color:#8B6914;margin-bottom:10px;padding-left:4px;border-left:3px solid #F59E0B;padding-left:10px;">Possibly relevant (\${topSenders.length})</h3>
                  \${topSenders.map(s => renderSenderCard(s)).join('')}
                </div>\`;
              }

              const otherSenders = [...restSenders, ...low];
              if (otherSenders.length > 0) {
                html += \`<details style="margin-bottom:20px;">
                  <summary style="font-size:15px;color:#4A6B8A;margin-bottom:10px;cursor:pointer;padding-left:4px;border-left:3px solid #E0E7ED;padding-left:10px;">Other senders (\${otherSenders.length})</summary>
                  <div style="margin-top:10px;">
                    \${otherSenders.map(s => renderSenderCard(s)).join('')}
                  </div>
                </details>\`;
              }

              if (topSenders.length === 0 && otherSenders.length === 0) {
                html += \`<div style="text-align:center;padding:40px;background:#FAF9F6;border-radius:12px;border:2px dashed #E0E7ED;">
                  <div style="font-size:48px;margin-bottom:16px;">✅</div>
                  <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">No additional senders</h3>
                  <p style="color:#4A6B8A;font-size:14px;">All senders were shown in the previous step. Click Confirm to continue.</p>
                </div>\`;
              }
            }

            container.innerHTML = html;
            updateProgress();
          }

          function toggleSender(email) {
            if (senderSelections[email] === 'include') {
              delete senderSelections[email];
            } else {
              senderSelections[email] = 'include';
            }
            renderSenderPage();
          }

          async function continueToSubStepB() {
            const btn = document.getElementById('substep-continue-btn');
            btn.disabled = true;
            btn.textContent = 'Loading...';

            try {
              // Gather approved senders from sub-step A selections
              const approved = allSenders.filter(s => senderSelections[s.email] === 'include');
              const mid = allSenders.filter(s => (s.relevance ?? 0) >= 0.4 && (s.relevance ?? 0) < 0.7);

              if (mid.length > 0 && approved.length > 0) {
                const res = await fetch('/onboarding/rerank-senders', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ approvedSenders: approved, candidateSenders: mid }),
                });
                const data = await res.json();
                if (res.ok && data.senders) {
                  rerankedMidSenders = data.senders;
                } else {
                  // Fallback to original ordering
                  rerankedMidSenders = mid;
                }
              } else {
                rerankedMidSenders = mid;
              }

              senderSubStep = 'B';
              renderSenderPage();
            } catch (err) {
              // Fallback to original ordering on error
              rerankedMidSenders = allSenders.filter(s => (s.relevance ?? 0) >= 0.4 && (s.relevance ?? 0) < 0.7);
              senderSubStep = 'B';
              renderSenderPage();
            }
          }

          function updateProgress() {
            const count = Object.values(senderSelections).filter(s => s === 'include').length;
            document.getElementById('progress-count').textContent = count + ' sender' + (count !== 1 ? 's' : '') + ' included';

            let hint = 'Select senders to monitor';
            let pct = 0;
            if (count >= 8) { hint = 'Excellent — your briefings will be comprehensive'; pct = 100; }
            else if (count >= 4) { hint = 'Great coverage'; pct = 75; }
            else if (count >= 1) { hint = 'Good start — keep going for better briefings'; pct = 40; }
            document.getElementById('progress-hint').textContent = hint;
            document.getElementById('progress-bar').style.width = pct + '%';
          }

          async function saveSenders() {
            // Require at least one include
            const includedCount = Object.values(senderSelections).filter(s => s === 'include').length;
            if (includedCount === 0) {
              showMessage('error', 'Please include at least one sender');
              return;
            }

            const btn = document.getElementById('save-senders-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              // Unselected senders are implicitly excluded
              const senders = allSenders.map(s => ({
                email: s.email,
                name: s.name,
                status: senderSelections[s.email] === 'include' ? 'include' : 'exclude',
              }));

              const res = await fetch('/onboarding/save-senders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senders }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Save failed');

              // Skip schools/training — go straight to briefing step
              document.getElementById('step-indicator-3').classList.add('completed');
              document.getElementById('step-indicator-4').classList.add('active');
              showStep('step-complete');
            } catch (err) {
              showMessage('error', 'Save failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Confirm sender selection';
            }
          }

          // --- School confirmation ---
          function buildSchoolList() {
            const schoolMap = {};
            // Aggregate school_name and year_hints from included senders
            for (const sender of allSenders) {
              if (senderSelections[sender.email] !== 'include') continue;
              const name = (sender.school_name || '').trim();
              if (!name) continue;
              if (!schoolMap[name]) {
                schoolMap[name] = { name, year_groups: [] };
              }
              if (sender.year_hints && Array.isArray(sender.year_hints)) {
                for (const hint of sender.year_hints) {
                  const h = hint.trim();
                  if (h && !schoolMap[name].year_groups.includes(h)) {
                    schoolMap[name].year_groups.push(h);
                  }
                }
              }
            }
            detectedSchools = Object.values(schoolMap);
          }

          function renderSchoolCards() {
            const container = document.getElementById('school-list');
            if (detectedSchools.length === 0) {
              container.innerHTML = \`
                <div style="text-align:center;padding:40px 20px;background:#FAF9F6;border-radius:12px;border:2px dashed #E0E7ED;margin-bottom:20px;">
                  <div style="font-size:48px;margin-bottom:16px;">🏫</div>
                  <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">No schools detected</h3>
                  <p style="color:#4A6B8A;font-size:14px;">We couldn't detect any schools. You can add them manually or skip this step.</p>
                </div>
              \`;
              return;
            }
            container.innerHTML = detectedSchools.map((school, i) => \`
              <div style="background:#FAF9F6;border:2px solid #E0E7ED;border-radius:12px;padding:16px;margin-bottom:10px;">
                <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:12px;">
                  <div style="flex:1;min-width:200px;">
                    <div class="form-group" style="margin-bottom:10px;">
                      <label>School name</label>
                      <input type="text" value="\${school.name}" onchange="updateSchool(\${i}, 'name', this.value)" style="width:100%;padding:10px 12px;border:2px solid #E0E7ED;border-radius:8px;font-size:16px;">
                    </div>
                    <div class="form-group" style="margin-bottom:0;">
                      <label>Year groups (comma-separated)</label>
                      <input type="text" value="\${school.year_groups.join(', ')}" onchange="updateSchoolYears(\${i}, this.value)" placeholder="e.g. Year 3, Reception" style="width:100%;padding:10px 12px;border:2px solid #E0E7ED;border-radius:8px;font-size:16px;">
                    </div>
                  </div>
                  <button onclick="removeSchool(\${i})" style="flex-shrink:0;background:#E53935;color:white;border:none;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">Remove</button>
                </div>
              </div>
            \`).join('');
          }

          function updateSchool(i, field, val) {
            detectedSchools[i][field] = val;
          }

          function updateSchoolYears(i, val) {
            detectedSchools[i].year_groups = val.split(',').map(s => s.trim()).filter(Boolean);
          }

          function removeSchool(i) {
            detectedSchools.splice(i, 1);
            renderSchoolCards();
          }

          function addSchoolManually() {
            detectedSchools.push({ name: '', year_groups: [] });
            renderSchoolCards();
          }

          function confirmSchools() {
            // Filter out empty names
            detectedSchools = detectedSchools.filter(s => s.name.trim());
            // Mark Senders step as completed and continue to training step
            document.getElementById('step-indicator-2').classList.add('completed');
            document.getElementById('step-indicator-3').classList.add('active');
            showStep('step-train');
            startTrainingExtraction();
          }

          // --- Training step ---
          let trainingItems = [];
          let trainingGrades = {}; // id -> true/false
          let extractPollInterval = null;

          async function startTrainingExtraction() {
            const loadingContainer = document.getElementById('train-loading');
            loadingContainer.innerHTML = createLoadingHTML(
              'train-extract',
              'Extracting items from your emails...',
              'Finding todos and events to review',
              'This typically takes 1-2 minutes'
            );
            loadingContainer.style.display = 'block';
            document.getElementById('train-items').style.display = 'none';
            startFakeProgress('train-extract', 90000); // 90 second estimate for background job

            try {
              const res = await fetch('/onboarding/extract-for-training', { method: 'POST' });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Extraction failed');

              // Start polling for status
              pollExtractionStatus();
            } catch (err) {
              completeProgress('train-extract');
              document.getElementById('train-loading').style.display = 'none';
              document.getElementById('train-items').style.display = 'block';
              document.getElementById('train-items-list').style.display = 'none';
              document.getElementById('train-empty').style.display = 'block';
              document.getElementById('train-empty').innerHTML = \`
                <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">Extraction failed</h3>
                <p style="color:#4A6B8A;font-size:14px;margin-bottom:20px;">\${err.message || 'Something went wrong. Please try again.'}</p>
                <button class="btn btn-primary" onclick="retryTrainingExtraction()" style="margin-bottom:12px;">Retry</button>
              \`;
              document.getElementById('save-train-btn').disabled = false;
              document.getElementById('save-train-btn').textContent = 'Skip this step';
            }
          }

          async function pollExtractionStatus() {
            extractPollInterval = setInterval(async () => {
              try {
                const res = await fetch('/onboarding/extract-for-training/status');
                const data = await res.json();

                if (data.status === 'pending') {
                  updateLoadingText('train-extract', 'Starting extraction...', 'Preparing to analyze your emails');
                } else if (data.status === 'scanning') {
                  updateLoadingText('train-extract', 'Extracting items...', 'Analyzing emails for todos and events');
                } else if (data.status === 'ranking') {
                  updateLoadingText('train-extract', 'Processing items...', 'Almost done');
                } else if (data.status === 'complete') {
                  clearInterval(extractPollInterval);
                  extractPollInterval = null;

                  completeProgress('train-extract');
                  trainingItems = data.items || [];

                  updateLoadingText('train-extract', 'Extraction complete!', 'Found ' + trainingItems.length + ' items');

                  setTimeout(() => {
                    document.getElementById('train-loading').style.display = 'none';
                    document.getElementById('train-items').style.display = 'block';

                    if (trainingItems.length === 0) {
                      document.getElementById('train-items-list').style.display = 'none';
                      document.getElementById('train-empty').style.display = 'block';
                      document.getElementById('save-train-btn').disabled = false;
                      document.getElementById('save-train-btn').textContent = 'Continue';
                    } else {
                      document.getElementById('train-items-list').style.display = 'block';
                      document.getElementById('train-empty').style.display = 'none';
                      renderTrainingItems();
                    }
                  }, 800);
                } else if (data.status === 'failed') {
                  clearInterval(extractPollInterval);
                  extractPollInterval = null;

                  completeProgress('train-extract');
                  document.getElementById('train-loading').style.display = 'none';
                  document.getElementById('train-items').style.display = 'block';
                  document.getElementById('train-items-list').style.display = 'none';
                  document.getElementById('train-empty').style.display = 'block';
                  document.getElementById('train-empty').innerHTML = \`
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">Extraction failed</h3>
                    <p style="color:#4A6B8A;font-size:14px;margin-bottom:20px;">\${data.error || 'Something went wrong. Please try again.'}</p>
                    <button class="btn btn-primary" onclick="retryTrainingExtraction()" style="margin-bottom:12px;">Retry</button>
                  \`;
                  document.getElementById('save-train-btn').disabled = false;
                  document.getElementById('save-train-btn').textContent = 'Skip this step';
                }
              } catch (err) {
                // Network error - keep polling
                console.error('Poll error:', err);
              }
            }, 2000); // Poll every 2 seconds
          }

          function retryTrainingExtraction() {
            document.getElementById('train-empty').innerHTML = \`
              <div style="font-size:48px;margin-bottom:16px;">📭</div>
              <h3 style="font-size:18px;color:#1E4562;margin-bottom:8px;">No items found</h3>
              <p style="color:#4A6B8A;font-size:14px;">We couldn't extract any todos or events from your emails. You can skip this step.</p>
            \`;
            startTrainingExtraction();
          }

          function renderTrainingItems() {
            const container = document.getElementById('train-items-list');
            container.innerHTML = trainingItems.map(item => {
              const graded = trainingGrades[item.id] !== undefined;
              const isRelevant = trainingGrades[item.id] === true;
              const isNotRelevant = trainingGrades[item.id] === false;
              const icon = item.item_type === 'todo' ? '✅' : '📅';
              return \`
                <div style="background:\${graded ? (isRelevant ? '#E8F5E9' : '#FFEBEE') : '#fff'};border:2px solid \${graded ? (isRelevant ? '#4CAF50' : '#E53935') : '#E0E7ED'};border-radius:12px;padding:16px;margin-bottom:8px;transition:all 0.2s;">
                  <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <div style="flex:1;min-width:180px;">
                      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;">
                        <span style="font-size:18px;flex-shrink:0;">\${icon}</span>
                        <span style="font-weight:600;font-size:14px;color:#1E4562;word-break:break-word;">\${item.item_text}</span>
                      </div>
                      <div style="font-size:12px;color:#7A8FA3;word-break:break-word;">From: \${item.source_sender || 'Unknown'}</div>
                      <div style="font-size:12px;color:#7A8FA3;margin-top:2px;word-break:break-word;">\${item.source_subject || ''}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                      <button onclick="gradeItem(\${item.id}, true)" style="padding:8px 14px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;\${isRelevant ? 'background:#4CAF50;color:white;' : 'background:#E8F5E9;color:#2E7D32;'}">Relevant</button>
                      <button onclick="gradeItem(\${item.id}, false)" style="padding:8px 14px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;\${isNotRelevant ? 'background:#E53935;color:white;' : 'background:#FFEBEE;color:#B71C1C;'}">Not Relevant</button>
                    </div>
                  </div>
                </div>
              \`;
            }).join('');
            updateTrainingProgress();
          }

          function gradeItem(id, isRelevant) {
            trainingGrades[id] = isRelevant;
            renderTrainingItems();
          }

          function updateTrainingProgress() {
            const graded = Object.keys(trainingGrades).length;
            const total = trainingItems.length;
            document.getElementById('train-progress').textContent = \`\${graded} of \${total} items graded\`;

            // Enable continue if at least half are graded or all are graded
            const minRequired = Math.min(5, Math.ceil(total / 2));
            document.getElementById('save-train-btn').disabled = graded < minRequired;
          }

          async function saveTrainingAndContinue() {
            const btn = document.getElementById('save-train-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const grades = Object.entries(trainingGrades).map(([id, isRelevant]) => ({
                id: parseInt(id),
                isRelevant,
              }));

              if (grades.length > 0) {
                const res = await fetch('/onboarding/save-feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ grades }),
                });
                if (!res.ok) {
                  const data = await res.json();
                  throw new Error(data.message || 'Save failed');
                }
              }

              // Continue to child extraction
              startChildExtraction();
            } catch (err) {
              showMessage('error', 'Save failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Continue';
            }
          }

          function skipTraining() {
            startChildExtraction();
          }

          // --- Child extraction ---
          let analyzePollInterval = null;

          async function startChildExtraction() {
            // Mark Train step as completed and Children step as active
            document.getElementById('step-indicator-3').classList.add('completed');
            document.getElementById('step-indicator-4').classList.add('active');
            showStep('step-analyzing');

            const loadingContainer = document.getElementById('analyze-loading');
            loadingContainer.innerHTML = createLoadingHTML(
              'analyze',
              'Detecting your children...',
              'Analyzing emails to find child names and schools',
              'This typically takes 1-2 minutes'
            );
            startFakeProgress('analyze', 90000); // 90 second estimate

            try {
              const res = await fetch('/onboarding/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  aiProvider: 'openai',
                  schoolContext: detectedSchools.filter(s => s.name.trim()),
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Analysis failed');

              // Start polling for status
              pollAnalyzeStatus();
            } catch (err) {
              completeProgress('analyze');
              showMessage('error', 'Analysis failed: ' + err.message);
              showStep('step-schools');
            }
          }

          async function pollAnalyzeStatus() {
            analyzePollInterval = setInterval(async () => {
              try {
                const res = await fetch('/onboarding/analyze/status');
                const data = await res.json();

                console.log('Analyze status poll:', data.status, data);

                if (data.status === 'pending') {
                  updateLoadingText('analyze', 'Starting analysis...', 'Preparing to analyze your emails');
                } else if (data.status === 'scanning') {
                  updateLoadingText('analyze', 'Analyzing emails...', 'Finding child names and schools');
                } else if (data.status === 'ranking') {
                  updateLoadingText('analyze', 'Processing results...', 'Almost done');
                } else if (data.status === 'complete') {
                  clearInterval(analyzePollInterval);
                  analyzePollInterval = null;

                  completeProgress('analyze');
                  analysisResult = data.result;
                  childrenData = analysisResult.children.map(child => ({
                    real_name: child.name,
                    display_name: '',
                    year_group: child.year_group || '',
                    school_name: child.school_name || '',
                    confidence: child.confidence,
                    example_emails: child.example_emails || [],
                    notes: '',
                  }));

                  updateLoadingText('analyze',
                    'Found ' + childrenData.length + ' child' + (childrenData.length !== 1 ? 'ren' : '') + '!',
                    'Analyzed ' + analysisResult.email_count_analyzed + ' emails'
                  );

                  setTimeout(() => {
                    renderChildCards();
                    showStep('step-children');
                  }, 1000);
                } else if (data.status === 'failed') {
                  clearInterval(analyzePollInterval);
                  analyzePollInterval = null;

                  completeProgress('analyze');
                  showMessage('error', 'Analysis failed: ' + (data.error || 'Something went wrong'));
                  showStep('step-schools');
                }
              } catch (err) {
                // Network error - keep polling
                console.error('Analyze poll error:', err);
              }
            }, 2000); // Poll every 2 seconds
          }

          // --- Child cards ---
          function renderChildCards() {
            const container = document.getElementById('child-cards-container');
            if (childrenData.length === 0) {
              container.innerHTML = \`
                <div class="empty-state">
                  <div class="empty-state-icon">🤷</div>
                  <h3>No children detected</h3>
                  <p>We couldn't find any child names. You can add children manually below.</p>
                </div>
              \`;
              return;
            }
            container.innerHTML = childrenData.map((child, i) => {
              const isManual = !child.example_emails || child.example_emails.length === 0;
              return \`
                <div class="child-card" data-index="\${i}">
                  <div class="card-header"><div class="card-icon">👶</div><div class="card-title">\${child.real_name || 'New Child'}</div></div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Name *</label>
                      <input type="text" value="\${child.real_name}" onchange="updateChild(\${i}, 'real_name', this.value)" placeholder="e.g., Jamie" style="color:#1E4562;">
                    </div>
                    <div class="form-group">
                      <label>Display Name (optional)</label>
                      <input type="text" value="\${child.display_name}" onchange="updateChild(\${i}, 'display_name', this.value)" placeholder="e.g., Child A" style="color:#1E4562;">
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Year Group</label>
                      <input type="text" value="\${child.year_group}" onchange="updateChild(\${i}, 'year_group', this.value)" placeholder="e.g., Year 3" style="color:#1E4562;">
                    </div>
                    <div class="form-group">
                      <label>School Name</label>
                      <input type="text" value="\${child.school_name}" onchange="updateChild(\${i}, 'school_name', this.value)" placeholder="e.g., Westfield Primary" style="color:#1E4562;">
                    </div>
                  </div>
                  \${!isManual ? \`<details class="example-emails">
                    <summary>View example emails (\${child.example_emails.length})</summary>
                    <ul>\${child.example_emails.map(e => \`<li>\${e}</li>\`).join('')}</ul>
                  </details>\` : ''}
                  <button class="btn-remove-card" onclick="removeChild(\${i})">Remove</button>
                </div>
              \`;
            }).join('');
          }

          function updateChild(i, field, val) { childrenData[i][field] = val; }

          function removeChild(i) {
            if (confirm('Remove this child profile?')) {
              childrenData.splice(i, 1);
              renderChildCards();
            }
          }

          function addManualChild() {
            childrenData.push({
              real_name: '', display_name: '', year_group: '',
              school_name: '',
              confidence: 1.0, example_emails: [], notes: '',
            });
            renderChildCards();
          }

          async function confirmProfiles() {
            const invalid = childrenData.filter(c => !c.real_name || !c.real_name.trim());
            if (invalid.length > 0) { showMessage('error', 'Please provide a name for all children'); return; }

            const btn = document.getElementById('confirm-btn');
            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {
              const profiles = childrenData.map(c => ({
                real_name: c.real_name.trim(),
                display_name: c.display_name.trim() || undefined,
                year_group: c.year_group.trim() || undefined,
                school_name: c.school_name.trim() || undefined,
                notes: c.notes?.trim() || undefined,
              }));

              const res = await fetch('/onboarding/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profiles }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Save failed');

              // Advance to step 2: hosted → alias, gmail → connect gmail
              document.getElementById('step-indicator-1').classList.add('completed');
              document.getElementById('step-indicator-2').classList.add('active');
              if (ONBOARDING_PATH === 'hosted') {
                showStep('step-alias');
              } else {
                showStep('step-welcome');
              }
            } catch (err) {
              showMessage('error', 'Save failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = 'Confirm & Save';
            }
          }

          // --- First email ---
          let emailGenPollInterval = null;

          async function generateFirstEmail() {
            const btn = document.getElementById('first-email-btn');
            const sendGroup = document.getElementById('send-email-group');
            const loadingContainer = document.getElementById('first-email-loading');
            const result = document.getElementById('first-email-result');

            sendGroup.style.display = 'none';
            loadingContainer.innerHTML = createLoadingHTML(
              'first-email',
              'Generating your first summary...',
              'Fetching emails and creating your briefing',
              'This typically takes 1-2 minutes'
            );
            loadingContainer.style.display = 'block';
            startFakeProgress('first-email', 120000); // 120 second estimate for background job

            try {
              const res = await fetch('/onboarding/generate-first-email', { method: 'POST' });
              const data = await res.json();
              if (!res.ok) throw new Error(data.message || 'Failed to start');

              // Start polling for status
              pollEmailGenStatus();
            } catch (err) {
              completeProgress('first-email');
              loadingContainer.style.display = 'none';
              sendGroup.style.display = '';
              result.style.display = 'block';
              result.innerHTML = '<div class="message error">Failed: ' + err.message + '</div>';
            }
          }

          async function pollEmailGenStatus() {
            const loadingContainer = document.getElementById('first-email-loading');
            const sendGroup = document.getElementById('send-email-group');
            const result = document.getElementById('first-email-result');

            emailGenPollInterval = setInterval(async () => {
              try {
                const res = await fetch('/onboarding/generate-first-email/status');
                const data = await res.json();

                if (data.status === 'pending') {
                  updateLoadingText('first-email', 'Starting...', 'Preparing to generate your email');
                } else if (data.status === 'scanning') {
                  updateLoadingText('first-email', 'Fetching emails...', 'Gathering your recent emails');
                } else if (data.status === 'ranking') {
                  updateLoadingText('first-email', 'Sending email...', 'Almost done!');
                } else if (data.status === 'complete') {
                  clearInterval(emailGenPollInterval);
                  emailGenPollInterval = null;

                  completeProgress('first-email');
                  updateLoadingText('first-email', 'Email sent!', 'Check your inbox');

                  setTimeout(() => {
                    loadingContainer.style.display = 'none';
                    result.style.display = 'block';
                    const recipientList = (data.recipients || []).join(', ');
                    result.innerHTML = '<div class="message success">Email sent to ' + recipientList + '</div><div class="button-group" style="margin-top:16px;"><a href="/dashboard" class="btn btn-primary">Go to Dashboard</a></div>';
                  }, 1000);
                } else if (data.status === 'failed') {
                  clearInterval(emailGenPollInterval);
                  emailGenPollInterval = null;

                  completeProgress('first-email');
                  loadingContainer.style.display = 'none';
                  sendGroup.style.display = '';
                  result.style.display = 'block';
                  result.innerHTML = '<div class="message error">Failed: ' + (data.error || 'Unknown error') + '</div>';
                }
              } catch (err) {
                // Network error - keep polling
                console.error('Poll error:', err);
              }
            }, 2000); // Poll every 2 seconds
          }

          // Auto-init: restore state on page reload
          (function() {
            const path = '${onboardingPath ?? ''}';
            const step = ${currentStep};
            if (path === 'hosted' && step === 3) {
              // Reload on forward-emails step — resume email count polling
              startEmailCountPolling();
            }
            if (step === 1) {
              // Reload on children step — start with one blank card
              const container = document.getElementById('child-cards-container');
              if (container && container.children.length === 0) {
                addManualChild();
              }
            }
          })();
        </script>
      </body>
      </html>
`;
}
