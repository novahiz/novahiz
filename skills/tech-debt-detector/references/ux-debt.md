# UX/UI Debt — Detection Patterns

Patterns de détection pour la dette UX/UI : composants incohérents, design system manquant, patterns UI duplicés, accessibilité manquante.

## Detection Signals

- Mixed UI frameworks (Tailwind + styled-components + CSS modules)
- Inconsistent component patterns
- Missing design system
- Duplicated UI components
- Inconsistent spacing/typography
- Missing dark mode support
- Inconsistent color usage

---

## Design System Debt

### Missing Design Tokens

```bash
# Check for design tokens
ls tokens/ theme/ design-tokens/ 2>/dev/null || echo "NO DESIGN TOKENS"

# Check for CSS variables
grep -r "--" src/ --include="*.css" --include="*.scss" | head -10

# Check for Tailwind config
ls tailwind.config.* 2>/dev/null || echo "NO TAILWIND CONFIG"
```

### Inconsistent Spacing

```css
/* BAD: arbitrary values */
padding: 13px;
margin: 7px 23px;
gap: 11px;

/* GOOD: consistent scale */
padding: var(--space-4); /* 16px */
margin: var(--space-2) var(--space-6); /* 8px 24px */
gap: var(--space-3); /* 12px */
```

### Inconsistent Typography

```css
/* BAD: arbitrary font sizes */
font-size: 13px;
font-size: 23px;
font-size: 11px;

/* GOOD: consistent scale */
font-size: var(--text-sm); /* 14px */
font-size: var(--text-lg); /* 18px */
font-size: var(--text-xs); /* 12px */
```

### Inconsistent Colors

```css
/* BAD: hardcoded colors */
color: #333333;
background: #f5f5f5;
border: 1px solid #cccccc;

/* GOOD: semantic tokens */
color: var(--color-text-primary);
background: var(--color-bg-secondary);
border: 1px solid var(--color-border-default);
```

---

## Component Debt

### Duplicated Components

```bash
# Find similar component names
find src/ -name "*.tsx" -o -name "*.jsx" | xargs basename -a | sort | uniq -d | head -10

# Find components with similar structure
grep -rn "export.*function\|export.*const" src/components/ --include="*.tsx" | head -20
```

### Mixed Component Patterns

```tsx
// BAD: mixed patterns
// Button.tsx
function Button({ children }) {
  return <button className="btn">{children}</button>;
}

// Modal.tsx
const Modal = styled.div`
  background: white;
`;

// Card.tsx
class Card extends React.Component {
  render() {
    return <div className="card">{this.props.children}</div>;
  }
}

// GOOD: consistent pattern
// Button.tsx
const Button = ({ children, variant = 'primary', ...props }) => (
  <button className={cn(styles.button, styles[variant])} {...props}>
    {children}
  </button>
);

// Modal.tsx
const Modal = ({ children, isOpen, onClose }) => (
  <Dialog open={isOpen} onClose={onClose} className={styles.modal}>
    {children}
  </Dialog>
);

// Card.tsx
const Card = ({ children, ...props }) => (
  <div className={styles.card} {...props}>
    {children}
  </div>
);
```

### Missing Component Variants

```tsx
// BAD: single variant
<Button>Click me</Button>

// GOOD: multiple variants
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="danger">Danger</Button>
```

---

## Accessibility Debt

### Missing ARIA Labels

```tsx
// BAD: no accessible name
<button><Icon /></button>
<input />

// GOOD: accessible names
<button aria-label="Close dialog"><Icon /></button>
<input aria-label="Email address" />
```

### Missing Keyboard Navigation

```tsx
// BAD: no keyboard support
<div onClick={handleClick}>Click me</div>

// GOOD: keyboard accessible
<button onClick={handleClick}>Click me</button>
// or
<div 
  role="button" 
  tabIndex={0} 
  onClick={handleClick}
  onKeyDown={(e) => e.key === 'Enter' && handleClick()}
>
  Click me
</div>
```

### Missing Focus Management

```tsx
// BAD: focus lost after action
const handleSubmit = () => {
  saveData();
  // focus is lost
};

// GOOD: focus management
const handleSubmit = () => {
  saveData();
  buttonRef.current?.focus(); // return focus to trigger
};
```

### Missing Reduced Motion

```css
/* BAD: always animated */
.transition {
  transition: all 0.3s ease;
}

/* GOOD: respect user preference */
@media (prefers-reduced-motion: reduce) {
  .transition {
    transition: none;
  }
}
```

---

## Responsive Debt

### Missing Breakpoints

```css
/* BAD: fixed width */
.container {
  width: 1200px;
}

/* GOOD: responsive */
.container {
  width: 100%;
  max-width: 1200px;
}
```

### Missing Mobile Styles

```css
/* BAD: desktop-only */
.sidebar {
  width: 300px;
  float: left;
}

/* GOOD: responsive */
.sidebar {
  width: 100%;
}

@media (min-width: 768px) {
  .sidebar {
    width: 300px;
    float: left;
  }
}
```

---

## Detection Commands

```bash
# Check for design tokens
ls tokens/ theme/ design-tokens/ 2>/dev/null || echo "MISSING: Design tokens"

# Check for Tailwind config
ls tailwind.config.* 2>/dev/null || echo "MISSING: Tailwind config"

# Check for mixed UI frameworks
grep -rn "styled-components\|@emotion\|tailwind\|css-modules" package.json 2>/dev/null | head -10

# Check for ARIA labels
grep -rn "aria-label\|aria-labelledby\|aria-describedby" src/ --include="*.tsx" --include="*.jsx" | wc -l

# Check for role attributes
grep -rn "role=" src/ --include="*.tsx" --include="*.jsx" | wc -l

# Check for reduced motion
grep -rn "prefers-reduced-motion" src/ --include="*.css" --include="*.scss" | wc -l
```
