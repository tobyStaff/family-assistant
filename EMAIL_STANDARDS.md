# Email HTML/CSS Standards

This document outlines the HTML and CSS standards for email templates in this project. These standards ensure compatibility across major email clients including Gmail, Outlook (desktop and web), Apple Mail, and Yahoo Mail.

## Overview

Email clients have notoriously inconsistent CSS support. Outlook in particular uses Microsoft Word's rendering engine, which has very limited CSS support. This document serves as a reference for AI and developers working on email templates.

## Key Files

- `src/templates/personalizedEmailTemplate.ts` - Main email template

---

## CSS Properties to AVOID

### Never Use

| Property | Reason | Alternative |
|----------|--------|-------------|
| `display: flex` | Not supported in Outlook | Use `display: block` or `display: inline-block` |
| `display: grid` | Not supported in Outlook | Use `display: block` with stacked elements |
| `position: absolute/fixed` | Inconsistent support | Use `display: block` layout |
| `float` | Inconsistent in email clients | Use `display: inline-block` |
| `box-shadow` | Not supported in Outlook | Omit or use border as alternative |
| `linear-gradient()` | Not supported in Outlook | Use solid `background-color` |
| `calc()` | Limited support | Use fixed values |
| `CSS variables (--var)` | Not supported | Use direct values |
| `@media queries` | Limited support (Gmail clips, Outlook ignores) | Design mobile-first with single-column |
| `* (universal selector)` | Inconsistent behavior | Target specific elements |

### Pseudo-selectors to Avoid

| Selector | Reason |
|----------|--------|
| `:hover` | No mouse interaction in most email clients |
| `:active` | Not applicable |
| `:focus` | Not applicable |
| `:last-child` | Limited support |
| `:first-child` | Limited support |
| `:nth-child()` | Not supported |
| `::before` / `::after` | Not supported in Outlook |

---

## CSS Properties That ARE Safe

### Layout

```css
/* Safe layout properties */
display: block;
display: inline-block;
display: inline;

/* Safe sizing */
width: 100%;
max-width: 700px;
padding: 20px;
margin: 0 auto;
```

### Typography

```css
/* Safe font properties */
font-family: Arial, Helvetica, sans-serif;
font-size: 16px;
font-weight: 600;
line-height: 1.6;
color: #333333;
text-align: center;
text-decoration: none;
text-transform: uppercase;
letter-spacing: 0.5px;
```

### Colors & Backgrounds

```css
/* Safe background/color properties */
background-color: #ffffff;
color: #333333;
border: 1px solid #e8e8e8;
border-left: 4px solid #667eea;
border-radius: 8px; /* Partially supported - degrades gracefully */
```

### Spacing

```css
/* Safe spacing */
margin: 10px;
margin-bottom: 12px;
padding: 20px 24px;
```

---

## HTML Structure Guidelines

### Do

1. **Use semantic HTML elements**: `<div>`, `<span>`, `<p>`, `<h1>`-`<h6>`, `<a>`, `<ul>`, `<li>`
2. **Keep structure simple**: Nested divs with block display
3. **Use inline-block for side-by-side elements** (with vertical-align)
4. **Set explicit widths** where needed
5. **Use HTML entities** for special characters

### Don't

1. **Don't use tables for layout** (unless absolutely necessary for complex layouts)
2. **Don't rely on CSS for critical layout** - structure should make sense without CSS
3. **Don't use external stylesheets** - always use `<style>` in `<head>`
4. **Don't use JavaScript** - it's stripped by all email clients

---

## Button Best Practices

Email-safe button pattern:

```css
.button {
  display: inline-block;
  background-color: #43a047;
  color: #ffffff !important;  /* !important helps override email client defaults */
  padding: 8px 16px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
}
```

```html
<a href="https://example.com" class="button">Click Here</a>
```

**Note**: Always use `!important` on button text color to override email client link styling.

---

## Layout Patterns

### Single Column (Recommended)

```css
.container {
  max-width: 700px;
  width: 100%;
  margin: 0 auto;
  padding: 32px 40px;
}
```

### Stacked Items (Vertical List)

```css
.list {
  display: block;
}
.list-item {
  display: block;
  padding: 12px 0;
  border-bottom: 1px solid #e8e8e8;
}
```

### Inline Elements (Side by Side)

```css
.inline-item {
  display: inline-block;
  vertical-align: middle;
  margin-right: 10px;
}
```

---

## Email Client Specifics

### Gmail
- Clips emails over 102KB
- Strips `<style>` tags in some cases (use inline styles as fallback)
- Removes `@media` queries

### Outlook (Desktop)
- Uses Microsoft Word rendering engine
- No flexbox, grid, or modern CSS
- No background images on divs (use `<table>` for background images)
- `border-radius` not supported (degrades to square corners)

### Outlook (Web/Office 365)
- Better CSS support than desktop
- Still limited compared to webmail clients

### Apple Mail
- Best CSS support
- Supports most modern CSS

### Yahoo Mail
- Good CSS support
- Some issues with `@media` queries

---

## Testing Checklist

Before deploying email templates, test in:

1. [ ] Gmail (web)
2. [ ] Gmail (mobile app)
3. [ ] Outlook (desktop - Windows)
4. [ ] Outlook (web)
5. [ ] Apple Mail
6. [ ] Yahoo Mail

### Testing Tools

- [Litmus](https://www.litmus.com/) - Email preview across clients
- [Email on Acid](https://www.emailonacid.com/) - Email testing
- [PutsMail](https://putsmail.com/) - Send test emails

---

## Template Checklist

When creating or modifying email templates:

- [ ] No flexbox (`display: flex`)
- [ ] No grid (`display: grid`)
- [ ] No gradients (use solid colors)
- [ ] No box-shadow
- [ ] No CSS variables
- [ ] No @media queries (or acceptable degradation)
- [ ] No pseudo-selectors (`:hover`, `:last-child`, etc.)
- [ ] No `::before` / `::after` pseudo-elements
- [ ] No float (use inline-block)
- [ ] Buttons have `!important` on text color
- [ ] All layout uses `display: block` or `display: inline-block`
- [ ] Max-width set on container (700px recommended)
- [ ] Tested in major email clients

---

## Code Example

Complete email-safe structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Title</title>
  <style>
    body {
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.6;
      color: #333333;
      background-color: #f0f2f5;
      margin: 0;
      padding: 16px;
    }
    .container {
      max-width: 700px;
      width: 100%;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px 40px;
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #e8e8e8;
    }
    .section {
      display: block;
      margin-bottom: 24px;
    }
    .item {
      display: block;
      padding: 16px;
      background-color: #fafafa;
      border-radius: 8px;
      border-left: 4px solid #667eea;
      margin-bottom: 12px;
    }
    .button {
      display: inline-block;
      background-color: #667eea;
      color: #ffffff !important;
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Email Title</h1>
    </div>
    <div class="section">
      <div class="item">
        <p>Content here</p>
        <a href="#" class="button">Action</a>
      </div>
    </div>
  </div>
</body>
</html>
```

---

## References

- [Can I Email](https://www.caniemail.com/) - CSS/HTML support tables for email
- [Campaign Monitor CSS Guide](https://www.campaignmonitor.com/css/)
- [Mailchimp Email Design Reference](https://templates.mailchimp.com/resources/email-client-css-support/)

---

*Last updated: January 2026*
