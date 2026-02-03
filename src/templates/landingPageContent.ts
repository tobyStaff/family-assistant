// src/templates/landingPageContent.ts
// Edit this file to update landing page text content

export const LANDING_PAGE_CONTENT = {
  // Meta & SEO
  meta: {
    title: "Never dig through a 4-page school newsletter again",
    description:
      "Family Assistant AI automatically sifts your inbox, reads every attachment, and summarises the actions into a 60-second morning brief. Stop hunting for dates and reclaim your focus.",
  },

  // Brand
  brand: {
    name: 'Family Assistant AI',
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
    headline: "Never dig through a 4-page school newsletter again",
    subheadline: "Family Assistant AI automatically sifts your inbox, reads every attachment, and summarises the actions into a 60-second morning brief. Stop hunting for dates and reclaim your focus.",
    cta: 'Link your Inbox now',
    liveCounter: 'admin hours recovered for busy parents',
  },

  // Email Preview Mockup
  emailPreview: {
    time: 'Today, 7:00 AM',
    readTime: '45s read',
    title: 'Your Daily Family Briefing',
    urgentItem: {
      title: 'Action Required: £1 for Ice Cream sale',
      description: 'Remember to Bring £1 for the After school Ice Cream sale on Friday!',
    },
    calendarItem: {
      title: 'Auto-Synced to Calendar',
      description: 'Parents Evening - Thu 6pm',
    },
    timeSaved: '18 min admin time saved today',
  },

  // Features Section
  features: {
    sectionTitle: 'The End of School Admin Fatigue',
    sectionSubtitle: 'We built the tools every Surrey parent actually needs.',
    cards: [
      {
        title: 'PDF & Newsletter Sieve',
        description:
          '<strong>We read the 5-page PDFs.</strong> Even if they are just images of text. Our AI scans every newsletter attachment, sifting through the fluff to find the one sentence about "Bring your Teddy Day" or "Inset Days."',
      },
      {
        title: 'Homework Updates, Automated',
        description:
          '<strong>No more login-panic.</strong> We read update emails from <strong>Google Classroom</strong> and <strong>Sparx Maths</strong>. See exactly what’s due and when, without ever hunting for a student password.',
      },
      {
        title: 'AI Vision for Flyers',
        description:
          '<strong>Snap a photo, then forget it.</strong> Took a quick photo of a crumpled school trip letter or a club flyer? Just forward the photo to your AI. We’ll extract the dates and add them to your calendar automatically.',
      },
    ],
  },

  // The "Everything Else" Section (The feature depth)
  extraFeatures: {
    title: "And everything else you'd expect from a great assistant:",
    items: [
      {
        title: 'Recurring Event Logic',
        text: 'Tell us once that PE is on Tuesdays, and we’ll handle the weekly reminders and kit-list alerts.'
      },
      {
        title: 'One-Tap Summaries',
        text: 'Need the full context? Every briefing item includes a "Quick Summary" link so you can read the highlights of a 10-page document in 10 seconds.'
      },
      {
        title: 'Calendar Conflict Detection',
        text: 'If a school play clashes with your work meeting, we’ll flag it in your morning briefing.'
      }
    ]
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