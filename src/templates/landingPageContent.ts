// src/templates/landingPageContent.ts
// Edit this file to update landing page text content

export const LANDING_PAGE_CONTENT = {
  // Meta & SEO
  meta: {
    title: "The 60-second morning brief for busy parents.",
    description:
      "Everything you need to remember for school today, delivered to your inbox at 7:00 AM.",
  },

  // Brand
  brand: {
    name: 'Family Assistant',
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
    headline: "The 60-second morning brief for busy parents.",
    subheadline: "Everything you need to remember for school today, delivered to your inbox at 7:00 AM.",
    cta: 'Get started',
    ctaCaption: 'Try for free for 7 days',
  },

  // Sign-in modal — shown when the hero "Get started" button is clicked
  signInModal: {
    title: 'One sign-in, two inboxes',
    bodyParagraphs: [
      "We use Google sign-in so your assistant can read your inbox and turn it into a 60-second morning brief. That's the only thing it ever does with your Gmail.",
      "When you sign up, you also get your own private forwarding address: <strong>you@inbox.getfamilyassistant.com</strong>.",
      "Forward school newsletters, club emails, or photos of permission slips to that address and your assistant handles them. Your main Gmail stays untouched — the assistant only ever acts on what you choose to forward.",
    ],
    signInButton: 'Sign in with Gmail',
    closeLabel: 'Close',
  },

  // Email Preview Mockup - matches actual daily briefing format
  emailPreview: {
    readTime: '2 min read',
    title: 'Family Briefing',
    date: 'Monday, 10th February',
    emailsSummarised: 8,
    timeSaved: 20,
    highlight: 'Pack PE kit for Emma - swimming starts this week!',
    todayReminders: [
      { type: 'event', emoji: '📅', title: 'Year 3 Assembly', time: '9:15 AM', child: 'Emma' },
      { type: 'todo', emoji: '💷', title: 'Pay for school trip', amount: '£15', child: 'Oliver' },
    ],
    eveningReminders: [
      { emoji: '📖', title: 'Read chapters 3-4 for English' },
      { emoji: '🎒', title: 'Pack swimming kit for Tuesday' },
    ],
    diaryItems: [
      { day: 'Tue 11', event: 'Swimming - bring kit' },
      { day: 'Thu 13', event: 'Parents Evening 6pm' },
      { day: 'Fri 14', event: 'Non-uniform day (£1)' },
    ],
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
    sectionTitle: 'Simple, Transparent Pricing',
    sectionSubtitle: 'Choose the plan that fits your family\'s needs',
    tiers: [
      {
        name: 'The Organized Parent',
        subtitle: 'End the Admin Drift',
        tier: 'ORGANIZED',
        price: '£9',
        period: '/month',
        badge: 'Most Popular',
        features: [
          '<strong>Daily Brief</strong> — 7 days a week',
          'Track up to <strong>20 school senders</strong>',
          '<strong>Deep Attachment Analysis</strong> — PDFs & newsletters',
          'Share with <strong>1 recipient</strong>',
          '<strong>Custom Training</strong> — tell us what to ignore',
          '<strong>Hosted email address</strong> — [you]@inbox.getfamilyassistant.com',
        ],
        cta: 'Free trial',
        ctaHref: '/auth/google',
        slotsRemaining: 'Only 8 slots left',
        highlighted: true,
      },
      {
        name: 'The Professional',
        subtitle: 'Chief of Staff Level',
        tier: 'PROFESSIONAL',
        price: '£18',
        period: '/month',
        badge: 'For Busy Commuters',
        features: [
          'Everything in Organized, plus:',
          '<strong>AI Vision</strong> — snap photos of flyers',
          '<strong>Unlimited Senders</strong> — every club & tutor covered',
          '<strong>4 Family Personas</strong> — distinct briefings per child',
        ],
        cta: 'Free trial',
        ctaHref: '/auth/google',
        slotsRemaining: 'Only 10 slots left',
        highlighted: false,
      },
      {
        name: 'The Concierge',
        subtitle: 'Total Delegation',
        tier: 'CONCIERGE',
        price: '£38',
        period: '/month',
        badge: null,
        features: [
          'Everything in Professional, plus:',
          '<strong>WhatsApp Your Assistant</strong> — forward messages & voice notes',
          '<strong>Human-in-the-Loop</strong> — 100% accuracy guarantee',
          '<strong>Autopilot Tasks</strong> — pre-filled forms & payment queues',
          '<strong>Priority Support</strong> — direct line to the founder',
        ],
        cta: 'Coming soon',
        slotsRemaining: null,
        highlighted: false,
        disabled: true,
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
    copyright: 'Family Assistant. All rights reserved.',
  },
};