# Landing Page Build Plan

## Overview

Build a "Snug Simple" (2026 design trend) landing page for the Family AI Assistant inbox manager. Light mode, warm tones, trust-focused design.

---

## Technology Stack

| Technology | Purpose |
|------------|---------|
| Tailwind CSS | Utility-first styling with custom theme |
| Google Fonts | Fraunces (headlines) + Plus Jakarta Sans (body) |
| Framer Motion / CSS | Hover lift + scroll fade-in animations |
| Stripe Checkout | Payment integration for pricing tiers |
| Fastify SSR | Server-rendered HTML templates |

---

## Design Tokens

### Colors

```css
--bg-alabaster: #FAF9F6;        /* Main background - warm paper */
--primary-trust-blue: #2A5C82;  /* Primary text & buttons */
--secondary-sky: #E3F2FD;       /* Airy background blocks */
--accent-green: #4CAF50;        /* Success states, savings badges */
--bg-warm-sand: #FFF8E1;        /* WhatsApp card background */
--bg-soft-mint: #E8F5E9;        /* Calendar card background */
```

### Typography

- **Headlines:** Fraunces (Soft Serif) - human, literary feel
- **Body:** Plus Jakarta Sans - modern legibility

### UI Style ("Snug Simple" 2026)

- **Border Radius:** Ultra-rounded (`24px+`) on all cards
- **Shadows:** Soft, large-spread ambient shadows
- **Tactility:** Light skeuomorphism - buttons look raised and clickable

---

## Page Structure

```
┌─────────────────────────────────────────────────────────┐
│  STICKY TOP BAR                                         │
│  "Join our first 10 Founding Families. Lock in £5.49"  │
├─────────────────────────────────────────────────────────┤
│  HEADER NAV                                             │
│  Logo | Features | Pricing | [Sign in with Gmail]       │
├─────────────────────────────────────────────────────────┤
│  SECTION 1: HERO                                        │
│  ┌──────────────────┬─────────────────────────────────┐ │
│  │ Headline:        │                                 │ │
│  │ "Your Family's   │  Frosted Glass Email Preview   │ │
│  │  Peace of Mind,  │  (Mobile mockup showing         │ │
│  │  in One Daily    │   daily briefing with:          │ │
│  │  Email"          │   - Read time: 45s              │ │
│  │                  │   - Urgent actions (red dot)    │ │
│  │ Sub-headline     │   - Admin saved (green badge)   │ │
│  │ + CTA Button     │                                 │ │
│  └──────────────────┴─────────────────────────────────┘ │
│                                                         │
│  Live Counter: "X emails summarized for busy parents"   │
├─────────────────────────────────────────────────────────┤
│  SECTION 2: BENTO GRID - "Mental Load" Features         │
│  ┌────────────────┬────────────────┬────────────────┐   │
│  │ THE INBOX      │ THE GROUP CHAT │ THE CALENDAR   │   │
│  │ (Sky bg)       │ (Sand bg)      │ (Mint bg)      │   │
│  │                │                │                │   │
│  │ Consolidates   │ WhatsApp Noise │ Automated      │   │
│  │ 4 accounts.    │ Filter. Skip   │ Sync. Dates    │   │
│  │ We find the    │ the 40-msg     │ moved straight │   │
│  │ permission     │ 'lost jumper'  │ to calendar.   │   │
│  │ slips.         │ thread.        │ Conflict-free. │   │
│  └────────────────┴────────────────┴────────────────┘   │
├─────────────────────────────────────────────────────────┤
│  SECTION 3: FOUNDER STORY - "The Why"                   │
│                                                         │
│  "I'm building this because my own inbox was drowning   │
│   in school admin. Join the first cohort and help me    │
│   shape how we protect parental focus."                 │
├─────────────────────────────────────────────────────────┤
│  SECTION 4: PRICING TIERS                               │
│  ┌─────────────────┬─────────────────┬─────────────────┐│
│  │ EARLY BIRD      │ PRO             │ CONCIERGE       ││
│  │ [Founding       │                 │                 ││
│  │  Member Badge]  │                 │                 ││
│  │                 │                 │                 ││
│  │ £5.49/mo        │ £19.99/mo       │ £49.99/mo       ││
│  │ "The Essentials"│ "Stress-Killer" │ "Total Delegate"││
│  │                 │                 │                 ││
│  │ • 1 Inbox       │ • Unlimited     │ • Unlimited     ││
│  │ • Basic Alerts  │ • Full Analysis │ • Human-Verified││
│  │ • 8AM Weekdays  │ • 7AM Daily     │ • Custom Times  ││
│  │ • Links only    │ • AI Form Fill  │ • Full Support  ││
│  │                 │                 │                 ││
│  │ 4 of 10 slots   │ 5 of 10 slots   │ 2 of 10 slots   ││
│  │                 │                 │                 ││
│  │ [Start Trial]   │ [Start Trial]   │ [Start Trial]   ││
│  │ → Stripe        │ → Stripe        │ → Stripe        ││
│  └─────────────────┴─────────────────┴─────────────────┘│
├─────────────────────────────────────────────────────────┤
│  FOOTER                                                 │
│                                                         │
│  🔒 Bank-Grade Security                                 │
│  • AES-256 encryption for all data                      │
│  • Your children's data is never sold                   │
│  • GDPR compliant                                       │
│  • Delete your data anytime                             │
│                                                         │
│  Built by a parent, for parents                         │
│                                                         │
│  Links: Privacy Policy | Terms | Contact                │
└─────────────────────────────────────────────────────────┘
```

---

## Key Decisions

| Item | Decision |
|------|----------|
| Sign in button | Header nav only (links to `/auth/google`) |
| Pricing CTAs | Link to Stripe Checkout |
| Counter | Live - total emails analyzed from DB |
| Footer | Include security/trust messaging |

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `tailwind.config.js` | Custom theme with Trust Blue palette |
| `postcss.config.js` | PostCSS configuration for Tailwind |
| `src/styles/landing.css` | Tailwind input file |
| `public/styles/landing.css` | Generated Tailwind output |
| `src/routes/landingRoutes.ts` | Landing page route handler |
| `src/routes/checkoutRoutes.ts` | Stripe checkout session API |
| `src/templates/landingPage.ts` | Main HTML template |
| `src/templates/components/pricingCard.ts` | Pricing card component |
| `src/templates/components/bentoCard.ts` | Bento grid card component |
| `src/templates/components/emailPreview.ts` | Frosted glass email mockup |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add Tailwind, PostCSS, autoprefixer deps + build script |
| `src/app.ts` | Register landing routes |

---

## Live Counter Implementation

Query total processed emails from database:

```typescript
const result = await db.get('SELECT COUNT(*) as count FROM processed_emails');
const totalEmails = result?.count || 0;
```

Display in hero section:
> **"12,847 emails summarized for busy parents"**

---

## Stripe Integration

### Price IDs (to create in Stripe Dashboard)

```typescript
const STRIPE_PRICES = {
  earlyBird: 'price_xxx_early_bird',    // £5.49/mo
  pro: 'price_xxx_pro',                  // £19.99/mo
  concierge: 'price_xxx_concierge'       // £49.99/mo
};
```

### Checkout Flow

1. User clicks "Start Trial" on pricing card
2. Request to `/api/checkout?plan=earlyBird`
3. Server creates Stripe Checkout session
4. Redirect user to Stripe hosted checkout
5. On success, redirect to `/auth/google` to create account

---

## Animations & Interactions

### Hover Lift (Light Skeuomorphism)

```css
.card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 25px 50px -12px rgba(42, 92, 130, 0.15);
}
```

### Scroll Fade-In

Using Intersection Observer or framer-motion:
- Elements fade in and slide up slightly as they enter viewport
- Staggered animation for grid items

---

## Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| Mobile (<640px) | Single column, stacked sections |
| Tablet (640-1024px) | 2-column bento grid |
| Desktop (>1024px) | Full 3-column layouts, split hero |

---

## Implementation Steps

1. [x] **Setup Tailwind** - Install deps, create config files
2. [x] **Create custom theme** - Trust Blue palette, fonts, spacing
3. [x] **Build base template** - HTML structure with header/footer
4. [x] **Build Hero section** - Split layout with frosted email preview
5. [x] **Build Bento Grid** - 3 feature cards with hover lift
6. [x] **Build Founder Story** - Personal "why" section
7. [x] **Build Pricing section** - 3-tier cards with Stripe links
8. [x] **Build Footer** - Trust badges, security copy, links
9. [x] **Add live counter** - Query DB, display in hero
10. [x] **Wire up Stripe** - Create checkout routes (placeholder - needs Stripe package)
11. [x] **Add animations** - Scroll fade-in, hover lift effects
12. [ ] **Test responsive** - Mobile-first adjustments
13. [x] **Register routes** - Update app.ts

---

## Notes

- Design follows "Snug Simple" 2026 trend - warm, light, trustworthy
- Emphasis on reducing "mental load" for parents
- Scarcity messaging for founding members (X of 10 slots)
- Live email counter builds social proof
