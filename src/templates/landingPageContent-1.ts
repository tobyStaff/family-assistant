// src/templates/landingPageContent.ts
// Edit this file to update landing page text content

export const LANDING_PAGE_CONTENT = {
  // Meta & SEO
  meta: {
    title: "Family Filter AI - Your Family's Peace of Mind, in One Daily Email",
    description:
      "No more digging through 50 emails, 500-word newsletters and 50 group-chat messages. We filter the school noise so you can focus on what matters.",
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
    liveCounter: 'emails summarized for busy parents',
  },

  // Email Preview Mockup
  emailPreview: {
    time: 'Today, 8:00 AM',
    readTime: '45s read',
    title: 'Your Daily Family Briefing',
    urgentItem: {
      title: 'Permission Slip Due Tomorrow',
      description: 'Year 4 Science Museum Trip - Reply needed by 3pm',
    },
    calendarItem: {
      title: 'Added to Calendar',
      description: 'Parents Evening - Thu 6pm',
    },
    timeSaved: '12 min admin time saved today',
  },

  // Features Section
  features: {
    sectionTitle: 'Reduce Your Mental Load',
    sectionSubtitle: 'Three ways we help you reclaim your headspace',
    cards: [
      {
        title: 'Peace of Mind',
        description:
          '<strong>The End of the Admin Scroll Your inbox, finally organized.</strong> Instead of hunting for dates in a crowded inbox, we surface the actions for you. We find the school forms and fee deadlines so you can close your email and get back to your morning.',
      },
      {
        title: 'The Group Chat',
        description:
          "<strong>WhatsApp Noise Filter.</strong> Skip the 40-message 'lost jumper' thread; we'll tell you if there's a real deadline buried in there.",
      },
      {
        title: 'The Calendar',
        description:
          '<strong>Automated Sync.</strong> Dates from school emails are moved straight to your calendar. No manual entry, no conflicts.',
      },
    ],
  },

  // Founder Story Section
  founderStory: {
    emoji: '👋',
    title: "Why I'm Building This",
    quote:
      'I\'m building this because my own inbox was drowning in school admin. Between two kids at different schools, a working spouse, and trying to actually be present as a parent—something had to give.',
    callToAction:
      '<strong>Join the first cohort</strong> and help me shape how we protect parental focus. Your feedback directly influences what we build next.',
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
          '1 Primary Inbox',
          'Basic WhatsApp Alerts',
          '8 AM Weekday Briefing',
          'Action Links (no auto-fill)',
        ],
        cta: 'Start 7-Day Trial',
        slotsRemaining: '4 of 10 slots remaining',
        highlighted: true,
      },
      {
        name: 'Pro',
        subtitle: 'The Stress-Killer',
        price: '£19.99',
        period: '/month',
        badge: null,
        features: [
          '<strong>Unlimited</strong> Inboxes',
          '<strong>Full Context</strong> WhatsApp Analysis',
          '7 AM <strong>Daily</strong> Briefing',
          '<strong>AI Form Filling</strong>',
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
          '<strong>Unlimited</strong> Inboxes',
          '<strong>Human-Verified</strong> Summaries',
          '<strong>Custom</strong> Briefing Times',
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
      title: 'Bank-Grade Security',
      items: [
        'AES-256 encryption for all data',
        "Your children's data is never sold",
        'GDPR compliant',
        'Delete your data anytime',
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
        { label: 'Contact Us', href: 'mailto:hello@familyai.app' },
      ],
    },
    copyright: 'Family Filter AI. All rights reserved.',
  },
};
