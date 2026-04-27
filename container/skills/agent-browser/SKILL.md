---
name: agent-browser
description: Use when a task needs browser-backed web access, page interaction, screenshots, PDF capture, form filling, data extraction, or local web app testing.
allowed-tools: Bash(agent-browser:*)
---

# Agent Browser

## RULES

- Use a snapshot before interacting; use element refs from the latest snapshot.
- Re-snapshot after navigation, submit, modal, route, or major DOM change.
- Prefer `snapshot -i` for actionable elements and compact output.
- Use semantic locators when refs are unavailable or unstable.
- Close the browser when the task no longer needs it.

## Workflow

1. Navigate: `agent-browser open <url>`
2. Inspect: `agent-browser snapshot -i`
3. Act: `click`, `fill`, `press`, `scroll`, or semantic `find ...`
4. Verify: wait, re-snapshot, get text/URL, screenshot, or PDF
5. Close: `agent-browser close`

## Reference

Navigation:

```bash
agent-browser open <url>
agent-browser back            # Go back
agent-browser forward         # Go forward
agent-browser reload          # Reload page
agent-browser close           # Close browser
```

Snapshots:

```bash
agent-browser snapshot            # Full accessibility tree
agent-browser snapshot -i         # Interactive elements
agent-browser snapshot -c         # Compact output
agent-browser snapshot -d 3       # Limit depth to 3
agent-browser snapshot -s "#main" # Scope to CSS selector
```

Interactions:

```bash
agent-browser click @e1           # Click
agent-browser dblclick @e1        # Double-click
agent-browser fill @e2 "text"     # Clear and type
agent-browser type @e2 "text"     # Type without clearing
agent-browser press Enter         # Press key
agent-browser hover @e1           # Hover
agent-browser check @e1           # Check checkbox
agent-browser uncheck @e1         # Uncheck checkbox
agent-browser select @e1 "value"  # Select dropdown option
agent-browser scroll down 500     # Scroll page
agent-browser upload @e1 file.pdf # Upload files
```

Read data:

```bash
agent-browser get text @e1        # Get element text
agent-browser get html @e1        # Get innerHTML
agent-browser get value @e1       # Get input value
agent-browser get attr @e1 href   # Get attribute
agent-browser get title           # Get page title
agent-browser get url             # Get current URL
agent-browser get count ".item"   # Count matching elements
```

Capture:

```bash
agent-browser screenshot          # Save to temp directory
agent-browser screenshot path.png # Save to specific path
agent-browser screenshot --full   # Full page
agent-browser pdf output.pdf      # Save as PDF
```

Wait:

```bash
agent-browser wait @e1                     # Wait for element
agent-browser wait 2000                    # Wait milliseconds
agent-browser wait --text "Success"        # Wait for text
agent-browser wait --url "**/dashboard"    # Wait for URL pattern
agent-browser wait --load networkidle      # Wait for network idle
```

Semantic locators:

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search" type "query"
```

Auth state:

```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

Cookies and storage:

```bash
agent-browser cookies                     # Get all cookies
agent-browser cookies set name value      # Set cookie
agent-browser cookies clear               # Clear cookies
agent-browser storage local               # Get localStorage
agent-browser storage local set k v       # Set value
```

JavaScript:

```bash
agent-browser eval "document.title"   # Run JavaScript
```
