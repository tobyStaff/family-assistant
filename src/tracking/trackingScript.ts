// src/tracking/trackingScript.ts
//
// Client-side tracking IIFE, exported as an HTML <script> snippet for
// inlining into rendered templates. Kept as a single template literal so
// removing tracking is `git rm src/tracking/` + delete one ${trackingScript}
// interpolation — no separate JS bundle to manage.
//
// Behaviour:
//   1. Fires a 'pageview' POST on load. Uses fetch (not sendBeacon) so we
//      can await the response — this guarantees the server-set
//      `tracking_vid` cookie is in document.cookie before any subsequent
//      events fire. Avoids a race where multiple parallel beacons each
//      get a fresh visitor id.
//   2. After pageview completes, attaches a delegated click listener on
//      `document` that fires for <a>, <button>, and [role="button"].
//   3. After pageview completes, attaches a passive scroll listener that
//      fires `scroll` events once each at 25 / 50 / 75 / 100% depth.
//
// All event posts after the initial pageview use navigator.sendBeacon so
// they survive page unload (e.g. a user clicking a CTA that navigates away).
// All failures are swallowed silently — tracking must never break the page.

export const trackingScript = `
<script>
(function() {
  var ENDPOINT = '/api/track';

  function payload(eventType, target) {
    return JSON.stringify({
      eventType: eventType,
      path: location.pathname + location.search,
      target: target || null,
      referrer: document.referrer || null
    });
  }

  function sendBeacon(eventType, target) {
    try {
      var body = payload(eventType, target);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(ENDPOINT, {
          method: 'POST',
          body: body,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          credentials: 'same-origin'
        });
      }
    } catch (e) { /* swallow */ }
  }

  function firePageview() {
    return fetch(ENDPOINT, {
      method: 'POST',
      body: payload('pageview', null),
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    }).catch(function() { /* swallow */ });
  }

  function attachClickListener() {
    document.addEventListener('click', function(e) {
      var el = e.target && e.target.closest ? e.target.closest('a, button, [role="button"]') : null;
      if (!el) return;
      sendBeacon('click', {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 100),
        href: el.getAttribute('href') || null,
        id: el.id || null,
        cls: typeof el.className === 'string' ? el.className.slice(0, 200) : null
      });
    }, true);
  }

  function attachScrollListener() {
    var thresholds = [25, 50, 75, 100];
    var seen = {};
    var timer = null;
    function check() {
      var docH = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docH > 0 ? Math.round((window.scrollY / docH) * 100) : 0;
      for (var i = 0; i < thresholds.length; i++) {
        var t = thresholds[i];
        if (pct >= t && !seen[t]) {
          seen[t] = true;
          sendBeacon('scroll', { depth: t });
        }
      }
    }
    window.addEventListener('scroll', function() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 150);
    }, { passive: true });
  }

  firePageview().finally(function() {
    attachClickListener();
    attachScrollListener();
  });
})();
</script>
`;
