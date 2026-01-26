// src/templates/landingPage.ts
import { LANDING_PAGE_CONTENT as content } from './landingPageContent.js';

interface LandingPageData {
  totalEmailsProcessed: number;
  stripeEarlyBirdUrl: string;
  stripeProUrl: string;
  stripeConciergeUrl: string;
}

/**
 * Format number with commas for display
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-GB');
}

/**
 * Generate the landing page HTML
 */
export function generateLandingPage(data: LandingPageData): string {
  const { totalEmailsProcessed, stripeEarlyBirdUrl, stripeProUrl, stripeConciergeUrl } = data;
  const stripeUrls = [stripeEarlyBirdUrl, stripeProUrl, stripeConciergeUrl];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.meta.title}</title>
  <meta name="description" content="${content.meta.description}">

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- Tailwind Play CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'alabaster': '#FAF9F6',
            'trust-blue': '#2A5C82',
            'trust-blue-dark': '#1E4562',
            'sky': '#E3F2FD',
            'growth-green': '#4CAF50',
            'warm-sand': '#FFF8E1',
            'soft-mint': '#E8F5E9',
          },
          fontFamily: {
            'display': ['Fraunces', 'Georgia', 'serif'],
            'body': ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
          },
          borderRadius: {
            'snug': '24px',
          },
          boxShadow: {
            'ambient': '0 25px 50px -12px rgba(42, 92, 130, 0.08)',
            'ambient-hover': '0 25px 50px -12px rgba(42, 92, 130, 0.15)',
          },
        },
      },
    }
  </script>

  <style>
    body {
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
    }
    .font-display {
      font-family: 'Fraunces', Georgia, serif;
    }

    /* Hover lift animation */
    .hover-lift {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .hover-lift:hover {
      transform: translateY(-4px);
      box-shadow: 0 25px 50px -12px rgba(42, 92, 130, 0.15);
    }

    /* Frosted glass effect */
    .frosted-glass {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    /* Scroll fade-in animation */
    .fade-in-up {
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.6s ease, transform 0.6s ease;
    }
    .fade-in-up.visible {
      opacity: 1;
      transform: translateY(0);
    }

    /* Button press effect */
    .btn-press:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body class="bg-alabaster text-trust-blue font-body">

  <!-- Sticky Promo Bar -->
  <div class="bg-trust-blue text-white py-3 px-4 text-center text-sm font-medium sticky top-0 z-50">
    <span class="inline-flex items-center gap-2">
      <span>${content.promoBar.emoji}</span>
      <span>${content.promoBar.text} <strong>${content.promoBar.highlight}</strong>.</span>
    </span>
  </div>

  <!-- Header Nav -->
  <header class="py-4 px-6 lg:px-12">
    <nav class="max-w-7xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-10 h-10 bg-trust-blue rounded-xl flex items-center justify-center">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
          </svg>
        </div>
        <span class="font-display font-semibold text-xl">${content.brand.name}</span>
      </div>

      <div class="hidden md:flex items-center gap-8">
        <a href="#features" class="text-trust-blue/70 hover:text-trust-blue transition-colors">${content.nav.features}</a>
        <a href="#pricing" class="text-trust-blue/70 hover:text-trust-blue transition-colors">${content.nav.pricing}</a>
      </div>

      <a href="/auth/google" class="inline-flex items-center gap-2 bg-white border-2 border-trust-blue/20 text-trust-blue px-4 py-2 rounded-xl font-medium hover:border-trust-blue/40 hover:bg-sky/30 transition-all btn-press">
        <svg class="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        ${content.nav.signIn}
      </a>
    </nav>
  </header>

  <!-- Hero Section -->
  <section class="py-12 lg:py-20 px-6 lg:px-12">
    <div class="max-w-7xl mx-auto">
      <div class="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <!-- Left: Headline -->
        <div class="fade-in-up">
          <h1 class="font-display text-4xl md:text-5xl lg:text-6xl font-semibold leading-tight mb-6">
            ${content.hero.headline}
          </h1>
          <p class="text-lg md:text-xl text-trust-blue/70 mb-8 leading-relaxed">
            ${content.hero.subheadline}
          </p>
          <a href="#pricing" class="inline-flex items-center gap-2 bg-trust-blue text-white px-8 py-4 rounded-snug font-semibold text-lg hover:bg-trust-blue-dark transition-colors shadow-ambient hover-lift btn-press">
            ${content.hero.cta}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
            </svg>
          </a>

          <!-- Live Counter -->
          <div class="mt-8 inline-flex items-center gap-2 text-trust-blue/60">
            <div class="w-2 h-2 bg-growth-green rounded-full animate-pulse"></div>
            <span class="font-medium">${formatNumber(totalEmailsProcessed)} ${content.hero.liveCounter}</span>
          </div>
        </div>

        <!-- Right: Email Preview Mockup -->
        <div class="fade-in-up relative">
          <!-- Phone frame -->
          <div class="relative mx-auto w-full max-w-sm">
            <!-- Soft glow background -->
            <div class="absolute inset-0 bg-trust-blue/10 rounded-[40px] blur-3xl transform scale-90"></div>

            <!-- Phone mockup -->
            <div class="relative bg-white rounded-[40px] p-3 shadow-ambient">
              <div class="bg-alabaster rounded-[32px] overflow-hidden">
                <!-- Phone header -->
                <div class="bg-trust-blue text-white px-6 py-4">
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-sm opacity-80">${content.emailPreview.time}</span>
                    <span class="text-xs bg-white/20 px-2 py-1 rounded-full">${content.emailPreview.readTime}</span>
                  </div>
                  <h3 class="font-display font-semibold text-lg">${content.emailPreview.title}</h3>
                </div>

                <!-- Email content preview -->
                <div class="p-5 space-y-4">
                  <!-- Urgent Item -->
                  <div class="frosted-glass rounded-2xl p-4 border border-red-200">
                    <div class="flex items-start gap-3">
                      <div class="w-3 h-3 bg-red-500 rounded-full mt-1 animate-pulse"></div>
                      <div>
                        <p class="font-semibold text-sm text-trust-blue">${content.emailPreview.urgentItem.title}</p>
                        <p class="text-xs text-trust-blue/60 mt-1">${content.emailPreview.urgentItem.description}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Calendar Item -->
                  <div class="frosted-glass rounded-2xl p-4 border border-sky">
                    <div class="flex items-start gap-3">
                      <div class="w-8 h-8 bg-sky rounded-lg flex items-center justify-center">
                        <svg class="w-4 h-4 text-trust-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                        </svg>
                      </div>
                      <div>
                        <p class="font-semibold text-sm text-trust-blue">${content.emailPreview.calendarItem.title}</p>
                        <p class="text-xs text-trust-blue/60 mt-1">${content.emailPreview.calendarItem.description}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Admin Saved Badge -->
                  <div class="flex items-center justify-center gap-2 py-2">
                    <div class="bg-soft-mint text-growth-green px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                      </svg>
                      ${content.emailPreview.timeSaved}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Bento Grid Section -->
  <section id="features" class="py-16 lg:py-24 px-6 lg:px-12">
    <div class="max-w-7xl mx-auto">
      <div class="text-center mb-12 fade-in-up">
        <h2 class="font-display text-3xl md:text-4xl font-semibold mb-4">${content.features.sectionTitle}</h2>
        <p class="text-lg text-trust-blue/70 max-w-2xl mx-auto">${content.features.sectionSubtitle}</p>
      </div>

      <div class="grid md:grid-cols-3 gap-6">
        <!-- Card 1: Inbox -->
        <div class="bg-sky rounded-snug p-8 hover-lift fade-in-up">
          <div class="w-14 h-14 bg-trust-blue/10 rounded-2xl flex items-center justify-center mb-6">
            <svg class="w-7 h-7 text-trust-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
            </svg>
          </div>
          <h3 class="font-display text-xl font-semibold mb-3">${content.features.cards[0].title}</h3>
          <p class="text-trust-blue/70 leading-relaxed">
            ${content.features.cards[0].description}
          </p>
        </div>

        <!-- Card 2: WhatsApp -->
        <div class="bg-warm-sand rounded-snug p-8 hover-lift fade-in-up">
          <div class="w-14 h-14 bg-trust-blue/10 rounded-2xl flex items-center justify-center mb-6">
            <svg class="w-7 h-7 text-trust-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"/>
            </svg>
          </div>
          <h3 class="font-display text-xl font-semibold mb-3">${content.features.cards[1].title}</h3>
          <p class="text-trust-blue/70 leading-relaxed">
            ${content.features.cards[1].description}
          </p>
        </div>

        <!-- Card 3: Calendar -->
        <div class="bg-soft-mint rounded-snug p-8 hover-lift fade-in-up">
          <div class="w-14 h-14 bg-trust-blue/10 rounded-2xl flex items-center justify-center mb-6">
            <svg class="w-7 h-7 text-trust-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </div>
          <h3 class="font-display text-xl font-semibold mb-3">${content.features.cards[2].title}</h3>
          <p class="text-trust-blue/70 leading-relaxed">
            ${content.features.cards[2].description}
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- Founder Story Section -->
  <section class="py-16 lg:py-24 px-6 lg:px-12 bg-sky/30">
    <div class="max-w-3xl mx-auto text-center fade-in-up">
      <div class="w-16 h-16 bg-trust-blue rounded-full mx-auto mb-6 flex items-center justify-center">
        <span class="text-2xl">${content.founderStory.emoji}</span>
      </div>
      <h2 class="font-display text-2xl md:text-3xl font-semibold mb-6">${content.founderStory.title}</h2>
      <p class="text-lg text-trust-blue/80 leading-relaxed mb-6">
        ${content.founderStory.quote}
      </p>
      <p class="text-lg text-trust-blue/80 leading-relaxed">
        ${content.founderStory.callToAction}
      </p>
    </div>
  </section>

  <!-- Pricing Section -->
  <section id="pricing" class="py-16 lg:py-24 px-6 lg:px-12">
    <div class="max-w-7xl mx-auto">
      <div class="text-center mb-12 fade-in-up">
        <h2 class="font-display text-3xl md:text-4xl font-semibold mb-4">${content.pricing.sectionTitle}</h2>
        <p class="text-lg text-trust-blue/70 max-w-2xl mx-auto">${content.pricing.sectionSubtitle}</p>
      </div>

      <div class="grid md:grid-cols-3 gap-6 lg:gap-8">
        ${content.pricing.tiers
          .map(
            (tier, index) => `
        <!-- ${tier.name} Tier -->
        <div class="${tier.highlighted ? 'relative ' : ''}bg-white rounded-snug p-8 shadow-ambient hover-lift fade-in-up${tier.highlighted ? ' border-2 border-trust-blue' : ''}">
          ${
            tier.badge
              ? `
          <!-- Badge -->
          <div class="absolute -top-3 left-6 bg-trust-blue text-white text-xs font-semibold px-3 py-1 rounded-full">
            ${tier.badge}
          </div>
          `
              : ''
          }

          <div class="mb-6">
            <h3 class="font-display text-xl font-semibold mb-1">${tier.name}</h3>
            <p class="text-trust-blue/60 text-sm">${tier.subtitle}</p>
          </div>

          <div class="mb-6">
            <span class="font-display text-4xl font-bold">${tier.price}</span>
            <span class="text-trust-blue/60">${tier.period}</span>
          </div>

          <ul class="space-y-3 mb-8">
            ${tier.features
              .map(
                (feature) => `
            <li class="flex items-center gap-3 text-sm">
              <svg class="w-5 h-5 text-growth-green flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>
              <span>${feature}</span>
            </li>
            `
              )
              .join('')}
          </ul>

          <a href="${stripeUrls[index]}" class="block w-full ${tier.highlighted ? 'bg-trust-blue text-white hover:bg-trust-blue-dark' : 'bg-trust-blue/10 text-trust-blue hover:bg-trust-blue/20'} text-center py-3 rounded-xl font-semibold transition-colors btn-press">
            ${tier.cta}
          </a>

          <p class="text-center text-xs text-trust-blue/50 mt-4">${tier.slotsRemaining}</p>
        </div>
        `
          )
          .join('')}
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-16 px-6 lg:px-12 bg-trust-blue text-white">
    <div class="max-w-7xl mx-auto">
      <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
        <!-- Brand -->
        <div>
          <div class="flex items-center gap-2 mb-4">
            <div class="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <span class="font-display font-semibold text-xl">${content.brand.name}</span>
          </div>
          <p class="text-white/70 text-sm leading-relaxed">
            ${content.brand.tagline}
          </p>
        </div>

        <!-- Security -->
        <div>
          <h4 class="font-semibold mb-4 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
            ${content.footer.security.title}
          </h4>
          <ul class="space-y-2 text-sm text-white/70">
            ${content.footer.security.items.map((item) => `<li>${item}</li>`).join('')}
          </ul>
        </div>

        <!-- Links -->
        <div>
          <h4 class="font-semibold mb-4">${content.footer.product.title}</h4>
          <ul class="space-y-2 text-sm">
            ${content.footer.product.links.map((link) => `<li><a href="${link.href}" class="text-white/70 hover:text-white transition-colors">${link.label}</a></li>`).join('')}
          </ul>
        </div>

        <!-- Legal -->
        <div>
          <h4 class="font-semibold mb-4">${content.footer.legal.title}</h4>
          <ul class="space-y-2 text-sm">
            ${content.footer.legal.links.map((link) => `<li><a href="${link.href}" class="text-white/70 hover:text-white transition-colors">${link.label}</a></li>`).join('')}
          </ul>
        </div>
      </div>

      <div class="border-t border-white/10 pt-8 text-center text-sm text-white/50">
        <p>&copy; ${new Date().getFullYear()} ${content.footer.copyright}</p>
      </div>
    </div>
  </footer>

  <!-- Scroll Animation Script -->
  <script>
    // Intersection Observer for fade-in animations
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    // Observe all fade-in elements
    document.querySelectorAll('.fade-in-up').forEach(el => {
      observer.observe(el);
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  </script>

</body>
</html>
`;
}
