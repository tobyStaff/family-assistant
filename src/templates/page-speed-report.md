
First Contentful Paint
3.2 s
First Contentful Paint marks the time at which the first text or image is painted. Learn more about the First Contentful Paint metric.
Largest Contentful Paint
3.2 s
Largest Contentful Paint marks the time at which the largest text or image is painted. Learn more about the Largest Contentful Paint metric
Total Blocking Time
380 ms
Sum of all time periods between FCP and Time to Interactive, when task length exceeded 50ms, expressed in milliseconds. Learn more about the Total Blocking Time metric.
Cumulative Layout Shift
0
Cumulative Layout Shift measures the movement of visible elements within the viewport. Learn more about the Cumulative Layout Shift metric.
Speed Index
7.5 s
Speed Index shows how quickly the contents of a page are visibly populated. Learn more about the Speed Index metric.

---

Render blocking requests Est savings of 630 ms
Requests are blocking the page's initial render, which may delay LCP. Deferring or inlining can move these network requests out of the critical path.LCPFCPUnscored
URL
Transfer Size
Duration
tailwindcss.com
124.1 KiB	790 ms
/3.4.17(cdn.tailwindcss.com)
124.1 KiB
790 ms
Google Fonts cdn 
1.5 KiB	750 ms
/css2?family=…(fonts.googleapis.com)
1.5 KiB
750 ms

---


LCP breakdown
Each subpart has specific improvement strategies. Ideally, most of the LCP time should be spent on loading the resources, not within delays.LCPUnscored
Subpart
Duration
Time to first byte
0 ms
Element render delay
4,240 ms
Join our first 10 Founding Families. Lock in the £5.49 rate for life.
<span>

---


Network dependency tree
Avoid chaining critical requests by reducing the length of chains, reducing the download size of resources, or deferring the download of unnecessary resources to improve page load.LCPUnscored
Maximum critical path latency: 4,219 ms
Initial Navigation
https://getfamilyassistant.com - 333 ms, 8.95 KiB
/css2?family=…(fonts.googleapis.com) - 362 ms, 1.50 KiB
…v12/LDIoaomQN….woff2(fonts.gstatic.com) - 4,211 ms, 27.42 KiB
…v38/6NU78FyLN….woff2(fonts.gstatic.com) - 4,219 ms, 66.60 KiB
/3.4.17(cdn.tailwindcss.com) - 456 ms, 124.12 KiB
/3.4.17(cdn.tailwindcss.com) - 456 ms, 124.12 KiB

---


Use efficient cache lifetimes Est savings of 133 KiB
A long cache lifetime can speed up repeat visits to your page. Learn more about caching.LCPFCPUnscored
Request
Cache TTL
Transfer Size
Facebook social 
150 KiB
/en_US/fbevents.js(connect.facebook.net)
20m
101 KiB
…config/910…?v=…(connect.facebook.net)
20m
49 KiB
/tr/?id=…(www.facebook.com)

---

Legacy JavaScript Est savings of 12 KiB
Polyfills and transforms enable older browsers to use new JavaScript features. However, many aren't necessary for modern browsers. Consider modifying your JavaScript build process to not transpile Baseline features, unless you know you must support older browsers. Learn why most sites can deploy ES6+ code without transpilingLCPFCPUnscored
URL
Wasted bytes
Facebook social 
12.5 KiB
/en_US/fbevents.js(connect.facebook.net)
12.5 KiB
/en_US/fbevents.js:24:6382(connect.facebook.net)
@babel/plugin-transform-classes
/en_US/fbevents.js:24:2819(connect.facebook.net)
@babel/plugin-transform-regenerator
/en_US/fbevents.js:24:5990(connect.facebook.net)
@babel/plugin-transform-spread
/en_US/fbevents.js:294:15837(connect.facebook.net)
Array.from
/en_US/fbevents.js:294:2722(connect.facebook.net)
Array.prototype.filter
/en_US/fbevents.js:294:21490(connect.facebook.net)
Array.prototype.find
/en_US/fbevents.js:294:19706(connect.facebook.net)
Array.prototype.includes
/en_US/fbevents.js:294:2905(connect.facebook.net)
Array.prototype.map
/en_US/fbevents.js:294:6104(connect.facebook.net)
String.prototype.startsWith

---

Minimize main-thread work 5.1 s
Consider reducing the time spent parsing, compiling and executing JS. You may find delivering smaller JS payloads helps with this. Learn how to minimize main-thread workTBTUnscored
Category
Time Spent
Style & Layout
3,918 ms
Script Evaluation
874 ms
Script Parsing & Compilation
143 ms
Other
131 ms
Garbage Collection
41 ms
Rendering
27 ms
Parse HTML & CSS
10 ms

---

Reduce unused JavaScript Est savings of 73 KiB
Reduce unused JavaScript and defer loading scripts until they are required to decrease bytes consumed by network activity. Learn how to reduce unused JavaScript.LCPFCPUnscored
URL
Transfer Size
Est Savings
tailwindcss.com
123.3 KiB	37.6 KiB
https://cdn.tailwindcss.com
123.3 KiB
37.6 KiB
Facebook social 
97.2 KiB	35.6 KiB
/en_US/fbevents.js(connect.facebook.net)
97.2 KiB
35.6 KiB

---


Avoid long main-thread tasks 6 long tasks found
Lists the longest tasks on the main thread, useful for identifying worst contributors to input delay. Learn how to avoid long main-thread tasksTBTUnscored
URL
Start Time
Duration
getfamilyassistant.com 1st party
2,534 ms
https://getfamilyassistant.com
782 ms
1,927 ms
https://getfamilyassistant.com
2,835 ms
525 ms
https://getfamilyassistant.com
3,360 ms
82 ms
Facebook social 
306 ms
…config/910…?v=…(connect.facebook.net)
5,006 ms
167 ms
/en_US/fbevents.js(connect.facebook.net)
4,567 ms
139 ms
tailwindcss.com
126 ms
https://cdn.tailwindcss.com
2,709 ms
126 ms