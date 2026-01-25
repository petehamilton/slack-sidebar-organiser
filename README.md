# Slack Sidebar Organizer

Because I just couldn't take it any more. We have channels for customers, projects, commercial deals, hiring candidates and, unsurprisingly (given I founded [incident.io](https://incident.io)), incidents!

I try my best to file these away, but it's always felt like a neverending battle.

No more! This script organizes everything the way I want. It works for me - use it at your own risk!

![organize](https://github.com/petehamilton/slack-sidebar-organiser/assets/510845/f414993e-d995-4a76-b6df-4895af6c3690)

## Prep

Install dependencies:

```
npm install
```

**Set up environment variables**

The script authenticates using Slack session tokens. Create a `.env` file (or export these variables):

```
SLACK_WORKSPACE=your-workspace-name
SLACK_XOXC_TOKEN=xoxc-...
SLACK_XOXD_TOKEN=xoxd-...
```

`SLACK_WORKSPACE` is the subdomain of your workspace (e.g. `mycompany` from `mycompany.slack.com`).

To get your `xoxc` and `xoxd` tokens:

1. Log into your Slack workspace in a browser (e.g. Chrome)
2. Open DevTools (`Ctrl+Shift+I` / `Cmd+Option+I` or `F12`)
3. **For SLACK_XOXC_TOKEN:**
   - Go to the Console tab
   - Type `allow pasting` and press Enter
   - Paste and run: `JSON.parse(localStorage.localConfig_v2).teams[document.location.pathname.match(/^\/client\/([A-Z0-9]+)/)[1]].token`
   - Copy the token (starts with `xoxc-`)
4. **For SLACK_XOXD_TOKEN:**
   - Go to the Application tab → Cookies
   - Find the cookie named `d` (just the letter)
   - Copy its value (starts with `xoxd-`)

⚠️ This is needed because this script makes use of unsupported APIs. It may break in future. These tokens grant access to your Slack account. Keep them safe and don't commit them to git!

**Create rules.json file**

This file contains all your sidebar section rules. Three types are supported:

- `prefix` - matches channels which start with a prefix
- `suffix` - matches channels which end with a suffix
- `keyword` - matches channels which contain a given keyword

The `sidebar_section` param can be either an ID, or the Name of the sidebar section.

Rules are applied on a "first match" basis, so *the ordering in your file matters*!

If you run the script without a rules file, it'll automatically propose some for you:

```
npm run organize
```

Mine looks like this:

```json
[
  { "type": "prefix", "sidebar_section": "VIP Customers", "prefix": "cust-vip-" },
  { "type": "prefix", "sidebar_section": "Customers", "prefix": "prosp-" },
  { "type": "prefix", "sidebar_section": "Customers", "prefix": "cust-" },
  { "type": "prefix", "sidebar_section": "Incidents", "prefix": "inc-" },
  { "type": "prefix", "sidebar_section": "External", "prefix": "ext-" },
  { "type": "prefix", "sidebar_section": "Projects", "prefix": "project-" },
  { "type": "prefix", "sidebar_section": "Deals", "prefix": "deal-" },
  { "type": "prefix", "sidebar_section": "Deals", "prefix": "rollout-" },
  { "type": "prefix", "sidebar_section": "Deals", "prefix": "renewal-" },
  { "type": "prefix", "sidebar_section": "Hiring", "prefix": "hiring-" },
  { "type": "prefix", "sidebar_section": "Hiring", "prefix": "candidate-" }
]
```

## Organise that sidebar!

```bash
# To do a dry-run on what will move where
npm run organize -- rules.json

# To actually organise, add a --write option
npm run organize -- rules.json --write
```

## Running tests

```bash
npm test

# Or in watch mode
npm run test:watch
```
