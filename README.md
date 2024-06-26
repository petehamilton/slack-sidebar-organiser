# Slack Sidebar Organizer

Because I just couldn't take it any more. We have channels for customers, projects, commercial deals, hiring candidates and, unsurprisingly (given I founded [incident.io](https://incident.io)), incidents!

I try my best to file these away, but it's always felt like a neverending battle.

No more! This script organizes everything the way I want. It works for me - use it at your own risk!

![organize](https://github.com/petehamilton/slack-sidebar-organiser/assets/510845/f414993e-d995-4a76-b6df-4895af6c3690)

## Prep

Install dependencies:

```
bundle install
```

**Create rules.json file**

This file contains all your sidebar section rules. There are two types supported:

- `prefix` - matches channels which start with a prefix
- `keyword` - matches channels which contain a given keyword

The `sidebar_section` param can be either an ID, or the Name of the sidebar section.

Rules are applied on a "first match" basis, so *the ordering in your file matters*!

If you run the script without a rules file, it'll automatically propose some for you:

    bundle exec ruby organize.rb CURL_FILE

Mine looks like this:

	[
		{ "type": "prefix",  "sidebar_section": "VIP Customers", "prefix": "cust-vip-" },
		{ "type": "prefix",  "sidebar_section": "Customers", "prefix": "prosp-" },
		{ "type": "prefix",  "sidebar_section": "Customers", "prefix": "cust-" },
		{ "type": "prefix",  "sidebar_section": "Incidents", "prefix": "inc-" },
		{ "type": "prefix",  "sidebar_section": "External", "prefix": "ext-" },
		{ "type": "prefix",  "sidebar_section": "Projects", "prefix": "project-" },
		{ "type": "prefix",  "sidebar_section": "Deals", "prefix": "deal-" },
		{ "type": "prefix",  "sidebar_section": "Deals", "prefix": "rollout-" },
		{ "type": "prefix",  "sidebar_section": "Deals", "prefix": "renewal-" },
		{ "type": "prefix",  "sidebar_section": "Hiring", "prefix": "hiring-" },
		{ "type": "prefix",  "sidebar_section": "Hiring", "prefix": "candidate-" }
	]

**Create curl_sample file**

_Chrome assumed, if you use something else, I trust you'll figure it out._

Why do this? Because the public Slack API doesn't support the sidebar API methods, so instead, we'll just hook into an active session.

1. Go to network tab and find a sample POST request - "boot" is a good one
2. Copy the request as cURL
3. Paste into a file like `curl_sample` - no edits needed

⚠️ Bear in mind this file is all that would be needed to access your Slack account. Obviously it runs locally on your machine (you can see the code) but **I recommend deleting it once you're done, just to be safe.**.

## Organize that sidebar!

```
# To do a dry-run on what will move where
bundle exec ruby organize.rb CURL_FILE RULES_FILE

# To actually organise, add a --write option
bundle exec ruby organize.rb CURL_FILE RULES_FILE --write
```
