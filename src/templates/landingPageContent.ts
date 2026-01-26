// src/templates/landingPageContent.ts
// Edit this file to update landing page text content

export const LANDING_PAGE_CONTENT = {
  // Meta & SEO
  meta: {
    title: "Family Filter AI - Your Family's Peace of Mind, in One Daily Email",
    description:
      "Exchange the morning panic for a morning coffee. We distill the noise of school emails and WhatsApp threads into a single, 60-second briefing.",
  },

  // Brand
  brand: {
    name: 'Family Filter AI',
    tagline:
      'Built by a parent, for parents. Reclaim your headspace from school admin overload.',
  },

  // Promo Bar
  promoBar: {
    emoji: '🚀',
    text: 'Join our first 10 Founding Families. Lock in the £5.49 rate',
    highlight: 'for life',
  },

  // Navigation
  nav: {
    features: 'Features',
    pricing: 'Pricing',
    signIn: 'Sign in with Gmail',
  },

  // Hero Section
  hero: {
    headline: "Your Family's Peace of Mind, in One Daily Email.",
    subheadline:
      "No more digging through 50 emails, 500-word newsletters and 50 group-chat messages. We filter the school noise so you can focus on what matters.",
    cta: 'Start Your 7-Day Peace-of-Mind Trial',
    liveCounter: 'admin hours recovered for busy parents',
  },

  // Email Preview Mockup
  emailPreview: {
    time: 'Today, 7:00 AM',
    readTime: '45s read',
    title: 'Your Daily Family Briefing',
    urgentItem: {
      title: 'Action Required: Permission Slip',
      description: 'Year 4 Science Museum Trip - Reply needed by 3pm today',
    },
    calendarItem: {
      title: 'Auto-Synced to Calendar',
      description: 'Parents Evening - Thu 6pm (No work conflicts found)',
    },
    timeSaved: '18 min admin time saved today',
  },

  // Features Section
  features: {
    sectionTitle: 'Reduce Your Mental Load',
    sectionSubtitle: 'Three ways we help you reclaim your focus',
    cards: [
      {
        title: 'The Digital Sieve',
        description:
          '<strong>The End of the Admin Scroll.</strong> Our AI acts as a sieve for your primary inbox, catching the "must-acts"—like hidden forms and fees—while letting the newsletters and spam fall away.',
      },
      {
        title: 'Group Chat Guardian',
        description:
          "<strong>WhatsApp Noise Filter.</strong> Skip the 40-message 'lost jumper' thread. We monitor your school groups to surface only the deadlines and events that actually require your attention.",
      },
      {
        title: 'Automated Focus',
        description:
          '<strong>Seamless Calendar Sync.</strong> Dates extracted from school communications are moved straight to your calendar. No manual entry, no forgotten kit days, no conflicts.',
      },
    ],
  },

  // Founder Story Section
  founderStory: {
    emoji: '👋',
    title: "Why I'm Building This",
    quote:
      "I'm building this because I hit my breaking point. Last Tuesday, I spent 15 minutes reading a 4-page 'Headteacher Update' just to find the one sentence mentioning it was 'Odd Socks Day.' Between the 3,000-word newsletters, 47 unread WhatsApps about a lost water bottle, and the constant fear of missing a permission slip—I realized I wasn't just a parent; I was an unpaid, full-time logistics manager.",
    callToAction:
      '<strong>Join the first cohort</strong> of 10 families. Help me build a tool that means we never have to read a 12-paragraph email about a cake sale ever again.',
  },

  // Pricing Section
  pricing: {
    sectionTitle: 'Early Bird Pricing',
    sectionSubtitle: 'Lock in founding member rates before we launch publicly',
    tiers: [
      {
        name: 'Early Bird',
        subtitle: 'The Essentials',
        price: '£5.49',
        period: '/month',
        badge: 'Founding Member Rate',
        features: [
          '1 Primary Inbox Sieve',
          'Basic WhatsApp Alerts',
          '8 AM Weekday Briefing',
          'One-Click Action Links',
        ],
        cta: 'Start 7-Day Trial',
        slotsRemaining: '4 of 10 slots remaining',
        highlighted: true,
      },
      {
        name: 'Professional',
        subtitle: 'The Stress-Killer',
        price: '£19.99',
        period: '/month',
        badge: 'Most Popular',
        features: [
          '<strong>Unlimited</strong> Inbox Sourcing',
          '<strong>Full Context</strong> WhatsApp Analysis',
          '7 AM <strong>Daily</strong> Briefing',
          '<strong>AI Form Filling</strong> Assistant',
        ],
        cta: 'Start 7-Day Trial',
        slotsRemaining: '5 of 10 slots remaining',
        highlighted: false,
      },
      {
        name: 'Concierge',
        subtitle: 'The Total Delegate',
        price: '£49.99',
        period: '/month',
        badge: null,
        features: [
          '<strong>Priority</strong> AI Processing',
          '<strong>Human-in-the-Loop</strong> Verification',
          '<strong>Real-time</strong> SMS Alerts',
          '<strong>Full Admin Support</strong>',
        ],
        cta: 'Start 7-Day Trial',
        slotsRemaining: '2 of 10 slots remaining',
        highlighted: false,
      },
    ],
  },

  // Footer
  footer: {
    security: {
      title: 'Trust & Security',
      items: [
        'Bank-Grade AES-256 encryption',
        'Clean Room Processing (Data purged after use)',
        'ICO Registered & GDPR compliant',
        'Zero-training policy: Your data stays yours',
      ],
    },
    product: {
      title: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'Pricing', href: '#pricing' },
        { label: 'Sign In', href: '/auth/google' },
      ],
    },
    legal: {
      title: 'Legal',
      links: [
        { label: 'Privacy Policy', href: '/privacy' },
        { label: 'Terms of Service', href: '/terms' },
        { label: 'Contact Us', href: 'mailto:hello@familyfilter.ai' },
      ],
    },
    copyright: 'Family Filter AI. All rights reserved.',
  },
};