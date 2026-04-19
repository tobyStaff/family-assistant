// src/templates/mobileDetailLayout.ts

/**
 * Minimal mobile-first layout for the progressive-detail pages (L2/L3).
 * No sidebar — these pages are reached from email, so the chrome is deliberately light.
 * Palette matches the daily summary email (#2A5C82 / #FAF9F6 / Plus Jakarta Sans).
 */
export function renderMobileLayout(opts: {
  title: string;
  breadcrumb?: string;
  content: string;
  footer?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeAttr(opts.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1E4562;
      background-color: #FAF9F6;
      margin: 0;
      padding: 0;
    }
    .page {
      max-width: 640px;
      margin: 0 auto;
      padding: 16px;
    }
    @media screen and (min-width: 520px) {
      .page { padding: 32px 24px; }
    }
    .breadcrumb {
      font-size: 13px;
      color: #4A6B8A;
      margin-bottom: 16px;
      word-wrap: break-word;
    }
    .breadcrumb a {
      color: #2A5C82;
      text-decoration: none;
      border-bottom: 1px dotted #2A5C82;
    }
    .card {
      background: #ffffff;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    @media screen and (min-width: 520px) {
      .card { padding: 28px; }
    }
    h1, h2, h3 {
      font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
      color: #1E4562;
      margin-top: 0;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
    h2 { font-size: 18px; font-weight: 600; margin-bottom: 12px; }
    h3 { font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; color: #4A6B8A; margin-bottom: 10px; }
    a { color: #2A5C82; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #E0E7ED;
      text-align: center;
      color: #7A8FA3;
      font-size: 12px;
    }
    .meta-line {
      font-size: 14px;
      color: #4A6B8A;
      margin: 4px 0;
    }
    .child-badge {
      display: inline-block;
      background: #E3F2FD;
      color: #2A5C82;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 12px;
      margin-left: 4px;
    }
    .btn {
      display: inline-block;
      padding: 10px 18px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      border: 0;
      cursor: pointer;
      font-family: inherit;
    }
    .btn-primary { background-color: #2A5C82; color: #ffffff; }
    .btn-danger  { background-color: #ef5350; color: #ffffff; }
    .btn-ghost   { background: transparent; color: #2A5C82; border: 1px solid #2A5C82; }
    form.inline-action { display: inline-block; margin: 4px 6px 0 0; }
    .struck { text-decoration: line-through; opacity: 0.55; }
    .source-breadcrumb {
      border-left: 3px solid #2A5C82;
      padding: 10px 14px;
      background: #F4F7FA;
      border-radius: 0 6px 6px 0;
      font-size: 13px;
    }
    .source-breadcrumb .label {
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.4px;
      color: #7A8FA3;
      display: block;
      margin-bottom: 4px;
    }
    .related-list { list-style: none; padding: 0; margin: 0; }
    .related-list li { padding: 8px 0; border-bottom: 1px solid #EDF0F3; font-size: 14px; }
    .related-list li:last-child { border-bottom: 0; }
    .email-body p { margin: 0 0 12px 0; }
    .email-body a { word-break: break-word; }
    .extracted-block {
      background: #F4F7FA;
      border-radius: 6px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: #4A6B8A;
      max-height: 400px;
      overflow-y: auto;
    }
    .attachments-list { list-style: none; padding: 0; margin: 0; }
    .attachments-list li { padding: 6px 0; font-size: 14px; }
  </style>
</head>
<body>
  <div class="page">
    ${opts.breadcrumb ? `<div class="breadcrumb">${opts.breadcrumb}</div>` : ''}
    ${opts.content}
    <div class="footer">${opts.footer ?? 'Family Assistant'}</div>
  </div>
</body>
</html>`;
}

function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[c] || c));
}
