// src/templates/layout.ts
import type { Role } from '../types/roles.js';
import { isAdmin, isSuperAdmin } from '../types/roles.js';

/**
 * Navigation item configuration
 */
interface NavItem {
  href: string;
  icon: string;
  label: string;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

/**
 * Layout options for rendering pages
 */
export interface LayoutOptions {
  title: string;
  currentPath: string;
  user: {
    name?: string;
    email: string;
    picture_url?: string;
  };
  userRoles: Role[];
  impersonating?: {
    email: string;
    name?: string;
  } | null;
  content: string;
  scripts?: string;
}

/**
 * Navigation items configuration
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { href: '/todos-view', icon: '📝', label: 'TODOs' },
  { href: '/events-view', icon: '📅', label: 'Events' },
  { href: '/child-profiles-manage', icon: '👶', label: 'Child Profiles' },
  { href: '/settings/senders', icon: '📨', label: 'Monitored Senders' },
  { href: '/settings/training', icon: '🎯', label: 'Relevance Training' },
  { href: '/settings', icon: '⚙️', label: 'Settings' },
];

const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin', icon: '🔧', label: 'Admin Dashboard', adminOnly: true },
  { href: '/analyses-view', icon: '🔍', label: 'Email Analyses', adminOnly: true },
  { href: '/emails-view', icon: '📧', label: 'Stored Emails', adminOnly: true },
  { href: '/metrics/dashboard', icon: '📊', label: 'AI Metrics', adminOnly: true },
  { href: '/health', icon: '💚', label: 'Health Check', adminOnly: true },
];

/**
 * Render the full page layout with sidebar and header
 */
export function renderLayout(options: LayoutOptions): string {
  const { title, currentPath, user, userRoles, impersonating, content, scripts } = options;
  const userIsAdmin = isAdmin(userRoles);
  const userIsSuperAdmin = isSuperAdmin(userRoles);

  const renderNavItem = (item: NavItem) => {
    const isActive = currentPath === item.href ||
      (item.href !== '/dashboard' && currentPath.startsWith(item.href));

    return `
      <a href="${item.href}" class="nav-item ${isActive ? 'active' : ''}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>
    `;
  };

  const mainNavItems = NAV_ITEMS.map(renderNavItem).join('');
  const adminNavItems = userIsAdmin
    ? ADMIN_NAV_ITEMS.map(renderNavItem).join('')
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Inbox Manager</title>

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      /* Layout */
      --sidebar-width: 260px;
      --header-height: 72px;

      /* Brand Colors */
      --primary-color: #2A5C82;
      --primary-dark: #1E4562;
      --primary-light: rgba(42, 92, 130, 0.1);
      --success-color: #4CAF50;
      --success-light: #E8F5E9;
      --warning-color: #F59E0B;
      --warning-light: #FFF8E1;
      --danger-color: #E53935;
      --danger-dark: #B71C1C;
      --danger-light: #FFEBEE;

      /* Backgrounds */
      --bg-dark: #1E4562;
      --bg-darker: #163348;
      --bg-light: #FAF9F6;
      --bg-card: #ffffff;
      --bg-muted: #F8F9FA;
      --sky: #E3F2FD;
      --warm-sand: #FFF8E1;
      --soft-mint: #E8F5E9;

      /* Text Colors */
      --text-primary: #1E4562;
      --text-secondary: #4A6B8A;
      --text-muted: #7A8FA3;
      --text-light: #94a3b8;
      --text-white: #ffffff;

      /* Borders */
      --border-light: #E0E7ED;
      --border-color: rgba(255, 255, 255, 0.1);

      /* Shadows */
      --shadow-sm: 0 2px 8px rgba(42, 92, 130, 0.06);
      --shadow-md: 0 4px 20px rgba(42, 92, 130, 0.08);
      --shadow-lg: 0 8px 30px rgba(42, 92, 130, 0.12);

      /* Border Radius */
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 20px;
      --radius-full: 9999px;

      /* Fonts */
      --font-display: 'Fraunces', Georgia, serif;
      --font-body: 'Plus Jakarta Sans', system-ui, sans-serif;
    }

    body {
      font-family: var(--font-body);
      background: var(--bg-light);
      min-height: 100vh;
    }

    .font-display {
      font-family: var(--font-display);
    }

    /* Sidebar */
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--sidebar-width);
      background: linear-gradient(180deg, var(--bg-dark) 0%, var(--bg-darker) 100%);
      color: var(--text-white);
      display: flex;
      flex-direction: column;
      z-index: 100;
    }

    .sidebar-header {
      padding: 24px;
      border-bottom: 1px solid var(--border-color);
    }

    .sidebar-logo {
      font-family: var(--font-display);
      font-size: 22px;
      font-weight: 600;
      color: var(--text-white);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .sidebar-logo-icon {
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    .sidebar-nav {
      flex: 1;
      padding: 24px 0;
      overflow-y: auto;
    }

    .nav-section {
      margin-bottom: 24px;
    }

    .nav-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: rgba(255, 255, 255, 0.4);
      padding: 0 24px;
      margin-bottom: 12px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 24px;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      transition: all 0.2s ease;
      border-left: 3px solid transparent;
      margin: 2px 0;
    }

    .nav-item:hover {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-white);
    }

    .nav-item.active {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-white);
      border-left-color: var(--text-white);
    }

    .nav-icon {
      font-size: 18px;
      width: 24px;
      text-align: center;
    }

    .nav-label {
      font-size: 14px;
      font-weight: 500;
    }

    .sidebar-footer {
      padding: 20px 24px;
      border-top: 1px solid var(--border-color);
    }

    /* Header */
    .header {
      position: fixed;
      top: 0;
      left: var(--sidebar-width);
      right: 0;
      height: var(--header-height);
      background: white;
      border-bottom: 1px solid rgba(42, 92, 130, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      z-index: 50;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .page-title {
      font-family: var(--font-display);
      font-size: 24px;
      font-weight: 600;
      color: var(--primary-dark);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .user-menu {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 8px 16px;
      background: var(--sky);
      border-radius: 16px;
    }

    .user-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      object-fit: cover;
      border: 2px solid white;
    }

    .user-info {
      display: flex;
      flex-direction: column;
    }

    .user-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--primary-dark);
    }

    .user-email {
      font-size: 12px;
      color: var(--primary-color);
      opacity: 0.7;
    }

    .role-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      margin-left: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .role-badge.super-admin {
      background: var(--danger-color);
      color: white;
    }

    .role-badge.admin {
      background: var(--warm-sand);
      color: #8B6914;
    }

    .btn {
      padding: 10px 18px;
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }

    .btn:active {
      transform: scale(0.98);
    }

    .btn-primary {
      background: var(--primary-color);
      color: white;
    }

    .btn-primary:hover {
      background: var(--primary-dark);
      box-shadow: 0 4px 12px rgba(42, 92, 130, 0.3);
    }

    .btn-danger {
      background: var(--danger-color);
      color: white;
    }

    .btn-danger:hover {
      background: var(--danger-dark);
      box-shadow: 0 4px 12px rgba(229, 115, 115, 0.3);
    }

    .btn-outline {
      background: white;
      border: 2px solid rgba(42, 92, 130, 0.2);
      color: var(--primary-color);
    }

    .btn-outline:hover {
      background: var(--sky);
      border-color: rgba(42, 92, 130, 0.3);
    }

    /* Main Content */
    .main {
      margin-left: var(--sidebar-width);
      margin-top: var(--header-height);
      min-height: calc(100vh - var(--header-height));
      padding: 32px;
    }

    /* Impersonation Banner */
    .impersonation-banner {
      background: linear-gradient(135deg, var(--danger-color) 0%, var(--danger-dark) 100%);
      color: white;
      padding: 14px 24px;
      border-radius: var(--radius-lg);
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(229, 115, 115, 0.3);
    }

    .impersonation-banner .btn {
      background: white;
      color: var(--danger-color);
    }

    /* Cards */
    .card {
      background: var(--bg-card);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
      padding: 28px;
      margin-bottom: 24px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .card-title {
      font-family: var(--font-display);
      font-size: 20px;
      font-weight: 600;
      color: var(--primary-dark);
    }

    /* Grid */
    .grid {
      display: grid;
      gap: 20px;
    }

    .grid-2 {
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }

    .grid-3 {
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    }

    /* Stats */
    .stat-card {
      background: var(--bg-card);
      border-radius: var(--radius-lg);
      padding: 24px;
      box-shadow: var(--shadow-md);
    }

    .stat-label {
      font-size: 13px;
      color: var(--primary-color);
      opacity: 0.7;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .stat-value {
      font-family: var(--font-display);
      font-size: 32px;
      font-weight: 700;
      color: var(--primary-dark);
    }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
      }

      .header {
        left: 0;
      }

      .main {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="/dashboard" class="sidebar-logo">
        <span class="sidebar-logo-icon">📬</span>
        <span>Family Assistant</span>
      </a>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section">
        <div class="nav-section-title">Main</div>
        ${mainNavItems}
      </div>

      ${userIsAdmin ? `
      <div class="nav-section">
        <div class="nav-section-title">Admin</div>
        ${adminNavItems}
      </div>
      ` : ''}
    </nav>

    <div class="sidebar-footer">
      <form action="/logout" method="POST">
        <button type="submit" class="btn btn-outline" style="width: 100%;">
          🚪 Logout
        </button>
      </form>
    </div>
  </aside>

  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <h1 class="page-title">${title}</h1>
    </div>

    <div class="header-right">
      <div class="user-menu">
        <img src="${user.picture_url || 'https://via.placeholder.com/36'}"
             alt="${user.name || 'User'}"
             class="user-avatar">
        <div class="user-info">
          <div class="user-name">
            ${user.name || 'User'}
            ${userIsSuperAdmin ? '<span class="role-badge super-admin">SUPER ADMIN</span>' :
              userIsAdmin ? '<span class="role-badge admin">ADMIN</span>' : ''}
          </div>
          <div class="user-email">${user.email}</div>
        </div>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="main">
    ${impersonating ? `
    <div class="impersonation-banner">
      <div>
        <strong>👁️ Viewing as:</strong> ${impersonating.email} ${impersonating.name ? `(${impersonating.name})` : ''}
      </div>
      <form action="/admin/stop-impersonation" method="POST" style="margin: 0;">
        <button type="submit" class="btn">Stop Impersonating</button>
      </form>
    </div>
    ` : ''}

    ${content}
  </main>

  ${scripts || ''}
</body>
</html>
  `.trim();
}
