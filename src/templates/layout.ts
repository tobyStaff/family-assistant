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
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --sidebar-width: 240px;
      --header-height: 64px;
      --primary-color: #667eea;
      --primary-dark: #5a67d8;
      --danger-color: #dc3545;
      --success-color: #28a745;
      --bg-dark: #1a1a2e;
      --bg-darker: #16213e;
      --bg-light: #f5f7fa;
      --text-light: #94a3b8;
      --text-white: #ffffff;
      --border-color: rgba(255, 255, 255, 0.1);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-light);
      min-height: 100vh;
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
      padding: 20px;
      border-bottom: 1px solid var(--border-color);
    }

    .sidebar-logo {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-white);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sidebar-nav {
      flex: 1;
      padding: 20px 0;
      overflow-y: auto;
    }

    .nav-section {
      margin-bottom: 20px;
    }

    .nav-section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-light);
      padding: 0 20px;
      margin-bottom: 10px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 20px;
      color: var(--text-light);
      text-decoration: none;
      transition: all 0.2s;
      border-left: 3px solid transparent;
    }

    .nav-item:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-white);
    }

    .nav-item.active {
      background: rgba(102, 126, 234, 0.15);
      color: var(--primary-color);
      border-left-color: var(--primary-color);
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
      padding: 20px;
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
      border-bottom: 1px solid #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      z-index: 50;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: #333;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .user-menu {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
    }

    .user-info {
      display: flex;
      flex-direction: column;
    }

    .user-name {
      font-size: 14px;
      font-weight: 600;
      color: #333;
    }

    .user-email {
      font-size: 12px;
      color: #666;
    }

    .role-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      margin-left: 8px;
    }

    .role-badge.super-admin {
      background: var(--danger-color);
      color: white;
    }

    .role-badge.admin {
      background: #f59e0b;
      color: white;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--primary-color);
      color: white;
    }

    .btn-primary:hover {
      background: var(--primary-dark);
    }

    .btn-danger {
      background: var(--danger-color);
      color: white;
    }

    .btn-danger:hover {
      background: #c82333;
    }

    .btn-outline {
      background: transparent;
      border: 1px solid #ddd;
      color: #666;
    }

    .btn-outline:hover {
      background: #f5f5f5;
      border-color: #ccc;
    }

    /* Main Content */
    .main {
      margin-left: var(--sidebar-width);
      margin-top: var(--header-height);
      min-height: calc(100vh - var(--header-height));
      padding: 24px;
    }

    /* Impersonation Banner */
    .impersonation-banner {
      background: var(--danger-color);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .impersonation-banner .btn {
      background: white;
      color: var(--danger-color);
    }

    /* Cards */
    .card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      padding: 24px;
      margin-bottom: 20px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
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
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .stat-label {
      font-size: 13px;
      color: #666;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: #333;
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
        📬 Inbox Manager
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
