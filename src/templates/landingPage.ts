// src/templates/landingPage.ts
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { LANDING_PAGE_CONTENT as content } from './landingPageContent.js';
import { trackingScript } from '../tracking/index.js';

/**
 * Compiled Tailwind CSS, inlined into the HTML response.
 *
 * Why: PageSpeed flagged the Tailwind Play CDN as the largest single
 * performance hit on the landing page (124 KiB blocking download +
 * ~3.9s of runtime JIT work). Pre-compiling the utilities the page
 * actually uses and inlining them eliminates the blocking request,
 * the runtime compile, and the LCP delay caused by waiting for the CDN.
 *
 * The file is produced by `pnpm build:css` (Tailwind v4 CLI) and read
 * once at module load. Path resolves to src/styles/ in dev (tsx) and
 * dist/styles/ in prod (tsc-emitted JS).
 */
const COMPILED_CSS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'styles',
  'landing.compiled.css',
);
const COMPILED_CSS = readFileSync(COMPILED_CSS_PATH, 'utf-8');

interface LandingPageData {
  stripeEarlyBirdUrl: string;
  stripeProUrl: string;
  stripeConciergeUrl: string;
}

/**
 * Generate the landing page HTML
 */
export function generateLandingPage(data: LandingPageData): string {
  const { stripeEarlyBirdUrl, stripeProUrl, stripeConciergeUrl } = data;
  const stripeUrls = [stripeEarlyBirdUrl, stripeProUrl, stripeConciergeUrl];

  /**
   * Email-preview phone mockup. Rendered twice in the hero — once between
   * the heading and the CTA on mobile, once in the right column on desktop —
   * each instance hidden at the other breakpoint via lg:hidden / hidden lg:block.
   * Toggling visibility (instead of reordering a single instance) keeps the
   * desktop two-column layout simple while putting the visual proof of value
   * in front of mobile users before the CTA.
   */
  const phoneMockupHtml = `
    <div class="relative mx-auto w-full max-w-sm">
      <!-- Soft glow background -->
      <div class="absolute inset-0 bg-trust-blue/10 rounded-[40px] blur-3xl transform scale-90"></div>

      <!-- Phone mockup -->
      <div class="relative bg-white rounded-[40px] p-3 shadow-ambient">
        <div class="bg-alabaster rounded-[32px] overflow-hidden">
          <!-- Email header - Brand blue -->
          <div class="bg-trust-blue text-white px-5 py-4 relative">
            <span class="absolute top-3 right-4 text-xs bg-white/20 px-2 py-1 rounded-full">📖 ${content.emailPreview.readTime}</span>
            <h3 class="font-display font-semibold text-lg text-center">${content.emailPreview.title}</h3>
            <p class="text-center text-white/80 text-sm">${content.emailPreview.date}</p>
          </div>

          <!-- Work done summary -->
          <div class="text-center py-3 px-4 text-xs text-trust-blue/60 italic border-b border-slate-100">
            Summarised <strong>${content.emailPreview.emailsSummarised} emails</strong>, saving ~<strong>${content.emailPreview.timeSaved} min</strong>
          </div>

          <!-- Email content preview -->
          <div class="p-4 space-y-3" style="font-size: 13px;">
            <!-- Highlight Banner -->
            <div class="bg-warm-sand border border-amber-300 rounded-xl p-3">
              <div class="flex items-center gap-2 mb-1">
                <span>⭐</span>
                <span class="text-xs font-bold text-amber-700 uppercase tracking-wide">#1 Thing Today</span>
              </div>
              <p class="text-sm font-medium text-trust-blue">${content.emailPreview.highlight}</p>
            </div>

            <!-- Today's Reminders Section -->
            <div>
              <div class="flex items-center gap-2 mb-2 pb-1 border-b-2 border-trust-blue">
                <span>📋</span>
                <span class="text-xs font-bold text-trust-blue uppercase tracking-wide">Today's Reminders</span>
              </div>
              ${content.emailPreview.todayReminders.map(item => `
              <div class="bg-white rounded-lg p-2 mb-2 border-l-3 border-trust-blue shadow-sm" style="border-left: 3px solid #2A5C82;">
                <div class="flex items-center justify-between">
                  <span class="font-medium text-trust-blue">${item.emoji} ${item.title}</span>
                  ${item.amount ? `<span class="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">${item.amount}</span>` : ''}
                </div>
                <div class="text-xs text-trust-blue/60 mt-0.5">
                  ${item.time ? `⏰ ${item.time}` : ''} ${item.child ? `👶 ${item.child}` : ''}
                </div>
              </div>
              `).join('')}
            </div>

            <!-- Evening Reminders -->
            <div>
              <div class="flex items-center gap-2 mb-2 pb-1 border-b-2 border-sky">
                <span>🌙</span>
                <span class="text-xs font-bold text-trust-blue uppercase tracking-wide">This Evening</span>
              </div>
              <div class="grid grid-cols-2 gap-2">
                ${content.emailPreview.eveningReminders.map(item => `
                <div class="bg-slate-50 rounded-lg p-2 text-xs">
                  <span>${item.emoji}</span> ${item.title}
                </div>
                `).join('')}
              </div>
            </div>

            <!-- Diary Section -->
            <div class="bg-slate-50 rounded-xl p-3">
              <div class="flex items-center gap-2 mb-2">
                <span>📅</span>
                <span class="text-xs font-bold text-trust-blue uppercase tracking-wide">This Week</span>
              </div>
              ${content.emailPreview.diaryItems.map(item => `
              <div class="flex gap-3 py-1 border-b border-slate-200 last:border-0 text-xs">
                <span class="font-semibold text-trust-blue w-14">${item.day}</span>
                <span class="text-trust-blue/70">${item.event}</span>
              </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${content.meta.title}</title>
  <meta name="description" content="${content.meta.description}">

  <!--
    Fonts. The @font-face declarations are inlined in the pre-compiled CSS
    (see src/styles/landing.css), so we no longer need the Google Fonts
    stylesheet hop. We do still fetch the woff2 files from gstatic; the
    preconnect warms the TLS connection and the preloads kick off both
    critical downloads at HTML-parse time rather than waiting for the
    CSS to parse. URLs are versioned (v38 Fraunces, v12 Plus Jakarta Sans)
    and rotate occasionally — refresh instructions in landing.css.
  -->
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="font" type="font/woff2" crossorigin
    href="https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeP2Xz5c.woff2">
  <link rel="preload" as="font" type="font/woff2" crossorigin
    href="https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yygg_vb.woff2">

  <!-- Pre-compiled Tailwind + custom styles (see src/styles/landing.css) -->
  <style>${COMPILED_CSS}</style>
  <!-- Meta Pixel Code -->
  <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js'); fbq('init', '910736508599064'); fbq('track', 'PageView');</script>
  <noscript> <img height="1" width="1" src="https://www.facebook.com/tr?id=910736508599064&ev=PageView&noscript=1"/></noscript>
  <!-- End Meta Pixel Code -->
</head>
<body class="bg-alabaster text-trust-blue font-body">

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

    </nav>
  </header>

  <!-- Hero Section -->
  <section class="py-12 lg:py-20 px-6 lg:px-12">
    <div class="max-w-7xl mx-auto">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 lg:items-center">
        <!--
          Left column on desktop / full stack on mobile. Children are sequenced
          via Tailwind order utilities. Both breakpoints share the same flow now
          that the subheadline sits directly under the heading on mobile too:
            mobile:  heading → subheadline → phone (mobile copy) → CTA → counter
            desktop: heading → subheadline → CTA → counter (phone is in the
                     right column below; the mobile copy is display:none).
        -->
        <div class="flex flex-col gap-6 fade-in-up">
          <h1 class="order-1 font-display text-3xl md:text-4xl lg:text-6xl font-semibold leading-tight">
            ${content.hero.headline}
          </h1>

          <p class="order-2 text-lg md:text-xl text-trust-blue/70 leading-relaxed">
            ${content.hero.subheadline}
          </p>

          <!-- Mobile-only phone preview, sits between subheadline and CTA -->
          <div class="order-3 lg:hidden">
            ${phoneMockupHtml}
          </div>

          <div class="order-4 flex flex-col w-fit gap-2 self-center lg:self-start">
            <span class="text-sm text-trust-blue/60 font-medium text-center">${content.hero.ctaCaption}</span>
            <button id="signin-trigger" type="button" class="inline-flex items-center gap-2 bg-trust-blue text-white px-8 py-4 rounded-snug font-semibold text-lg hover:bg-trust-blue-dark transition-colors shadow-ambient hover-lift btn-press cursor-pointer">
              ${content.hero.cta}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
              </svg>
            </button>
          </div>

        </div>

        <!-- Desktop-only phone preview, right column -->
        <div class="fade-in-up relative hidden lg:block">
          ${phoneMockupHtml}
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

  <!-- Extra Features Section -->
  <section class="bg-alabaster py-16 px-6 lg:px-12 border-t border-slate-100">
    <div class="max-w-6xl mx-auto">
      <h3 class="font-display text-2xl md:text-3xl text-trust-blue mb-10 text-center fade-in-up">
        ${content.extraFeatures.title}
      </h3>

      <div class="grid md:grid-cols-3 gap-8">
        ${content.extraFeatures.items.map((item, index) => `
        <div class="flex gap-4 p-5 rounded-2xl hover:bg-white hover:shadow-sm transition-all duration-200 fade-in-up">
          <div class="text-trust-blue mt-1 flex-shrink-0">
            ${index === 0 ? `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>` : ''}
            ${index === 1 ? `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>` : ''}
            ${index === 2 ? `
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>` : ''}
          </div>
          <div>
            <h4 class="font-bold text-slate-900 mb-1 text-[1.1rem]">${item.title}</h4>
            <p class="text-slate-600 text-sm leading-relaxed">${item.text}</p>
          </div>
        </div>
        `).join('')}
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
        <div class="${tier.highlighted ? 'relative ' : ''}bg-white rounded-snug p-8 shadow-ambient${(tier as any).disabled ? ' opacity-60' : ' hover-lift'} fade-in-up${tier.highlighted ? ' border-2 border-trust-blue' : ''}">
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

          ${(tier as any).disabled
            ? `
          <span class="block w-full bg-trust-blue/5 text-trust-blue/40 text-center py-3 rounded-xl font-semibold cursor-not-allowed">
            ${tier.cta}
          </span>
          `
            : `
          <a href="${(tier as any).ctaHref || `/api/checkout?plan=${tier.tier || ['earlyBird', 'professional', 'concierge'][index]}`}" class="block w-full ${tier.highlighted ? 'bg-trust-blue text-white hover:bg-trust-blue-dark' : 'bg-trust-blue/10 text-trust-blue hover:bg-trust-blue/20'} text-center py-3 rounded-xl font-semibold transition-colors btn-press">
            ${tier.cta}
          </a>
          `}

          ${tier.slotsRemaining ? `<p class="text-center text-xs text-trust-blue/50 mt-4">${tier.slotsRemaining}</p>` : ''}
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

  <!-- Sign-in modal -->
  <dialog id="signin-modal" aria-labelledby="signin-modal-title"
    class="rounded-snug bg-white shadow-ambient max-w-md w-[calc(100vw-2rem)] m-auto">
    <div class="relative p-6 md:p-8">
      <button id="signin-modal-close" type="button" aria-label="${content.signInModal.closeLabel}"
        class="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-trust-blue/60 hover:text-trust-blue hover:bg-sky/40 transition-colors cursor-pointer">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>

      <h2 id="signin-modal-title" class="font-display text-2xl font-semibold leading-tight mb-5 pr-8">
        ${content.signInModal.title}
      </h2>

      <div class="space-y-3 text-trust-blue/80 leading-relaxed mb-6">
        ${content.signInModal.bodyParagraphs.map(paragraph => `<p>${paragraph}</p>`).join('')}
      </div>

      <a href="/auth/google" class="inline-flex w-full items-center justify-center gap-3 bg-white border-2 border-trust-blue/20 text-trust-blue px-6 py-3 rounded-snug font-semibold text-lg hover:border-trust-blue/40 hover:bg-sky/30 transition-all shadow-ambient btn-press">
        <svg class="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        ${content.signInModal.signInButton}
      </a>
    </div>
  </dialog>

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

    // Sign-in modal — native <dialog> supplies ESC-to-close + focus trap
    const signinModal = document.getElementById('signin-modal');
    const signinTrigger = document.getElementById('signin-trigger');
    const signinClose = document.getElementById('signin-modal-close');
    if (signinModal && signinTrigger) {
      signinTrigger.addEventListener('click', () => signinModal.showModal());
      if (signinClose) {
        signinClose.addEventListener('click', () => signinModal.close());
      }
      // Click on the backdrop area (outside the inner card) closes the modal.
      signinModal.addEventListener('click', (e) => {
        if (e.target === signinModal) signinModal.close();
      });
    }
  </script>

  ${trackingScript}
</body>
</html>
`;
}
