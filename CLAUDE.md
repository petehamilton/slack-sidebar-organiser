# Sidebar Organizer - Agent Guide

This document provides everything an LLM agent needs to understand, use, and modify this project.

## What This Project Does

Slack Sidebar Organizer automatically moves Slack channels into sidebar sections based on configurable rules. Users define rules that match channel names by prefix, suffix, or keyword, and the tool moves channels to the specified sidebar section.

## Quick Reference

```bash
# Install dependencies
npm install

# Run tests
npm test

# Dry-run (show what would change)
npm run organize -- rules.json

# Actually move channels
npm run organize -- rules.json --write

# Get rule suggestions (no rules file)
npm run organize
```

---

## Development Guidelines

**IMPORTANT: All code changes must include tests.**

When modifying or adding code to this project:

1. **Always write tests** for any new functionality or bug fixes
2. **Run `npm test`** before considering any code change complete
3. **Ensure all tests pass** - do not submit changes with failing tests
4. **Add tests for edge cases** - especially around rule matching behaviour
5. **Update existing tests** if you change behaviour that existing tests cover

Tests live in `organize.test.ts` and use Vitest. Follow the existing test patterns when adding new tests.

---

## Rules File Format

The rules file is a JSON array of rule objects. This is the primary file you'll be creating and editing.

### Schema

```typescript
type RulesFile = Rule[];

interface Rule {
  type: 'prefix' | 'suffix' | 'keyword';
  sidebar_section: string;      // Section name OR section ID
  prefix?: string;              // Required when type is 'prefix'
  suffix?: string;              // Required when type is 'suffix'
  keyword?: string;             // Required when type is 'keyword'
  skip_if_organized?: boolean;  // If true, don't move channels already in a custom section (default: false)
}
```

### Rule Types

| Type | Matching Behaviour | Example Rule | Matches | Does NOT Match |
|------|-------------------|--------------|---------|----------------|
| `prefix` | Channel starts with value | `"prefix": "cust-"` | `cust-acme`, `cust-` | `customer`, `cust`, `CUST-acme` |
| `suffix` | Channel ends with value | `"suffix": "-alerts"` | `prod-alerts`, `-alerts` | `alerts`, `alerts-old` |
| `keyword` | Channel contains value | `"keyword": "standup"` | `standup`, `team-standup`, `standup-daily` | `stand-up`, `STANDUP` |

### Important Behaviours

1. **First-match wins**: Rules are evaluated in order. Once a channel matches a rule, no further rules are checked.

2. **Case sensitive**: All matching is case-sensitive. `cust-` does not match `CUST-acme`.

3. **Exact string matching**:
   - Prefix `cust-` requires the hyphen. It matches `cust-foo` but NOT `customer`.
   - Suffix `-alerts` requires the hyphen. It matches `prod-alerts` but NOT `alerts`.

4. **Keyword matches substrings**: `keyword: "test"` matches `testing`, `test`, `my-test-channel`.

5. **Empty keyword matches everything**: An empty string `""` as a keyword will match all channels (this is a known edge case).

6. **`skip_if_organized`**: When set to `true` on a rule, channels that are already in a user-created sidebar section will not be moved — only channels in Slack's built-in default sections (e.g. "Channels") are affected. This respects manual organisation. Defaults to `false`.

### Example Rules File

```json
[
  { "type": "prefix", "sidebar_section": "VIP Customers", "prefix": "cust-vip-" },
  { "type": "prefix", "sidebar_section": "Customers", "prefix": "cust-" },
  { "type": "prefix", "sidebar_section": "Incidents", "prefix": "inc-" },
  { "type": "suffix", "sidebar_section": "Alerts", "suffix": "-alerts" },
  { "type": "keyword", "sidebar_section": "Standups", "keyword": "standup" }
]
```

**Rule ordering matters!** In the example above, `cust-vip-acme` matches "VIP Customers" because that rule comes first. If the rules were reversed, it would match "Customers" instead.

---

## Creating and Editing Rules

### Adding a New Rule

To add a rule, append to the JSON array:

```json
{ "type": "prefix", "sidebar_section": "Section Name", "prefix": "value-" }
```

### Common Patterns

**Group related channels by prefix:**
```json
{ "type": "prefix", "sidebar_section": "Projects", "prefix": "project-" }
```

**Catch all alerts channels:**
```json
{ "type": "suffix", "sidebar_section": "Alerts", "suffix": "-alerts" }
```

**Match channels containing a topic:**
```json
{ "type": "keyword", "sidebar_section": "Hiring", "keyword": "candidate" }
```

**Only move channels that haven't been manually organised:**
```json
{ "type": "prefix", "sidebar_section": "Customers", "prefix": "cust-", "skip_if_organized": true }
```

**Create hierarchy with specific-before-general:**
```json
[
  { "type": "prefix", "sidebar_section": "VIP", "prefix": "cust-vip-" },
  { "type": "prefix", "sidebar_section": "Customers", "prefix": "cust-" }
]
```

### Validation Checklist

When creating or editing rules:

- [ ] JSON is valid (no trailing commas, proper quoting)
- [ ] Each rule has `type` and `sidebar_section` fields
- [ ] Each rule has the matching field (`prefix`, `suffix`, or `keyword`) for its type
- [ ] `sidebar_section` matches an existing section name or ID in Slack
- [ ] More specific rules come before general rules
- [ ] No duplicate rules (same type + value + section)

### Getting Sidebar Section Names

Run the tool without a rules file to see available sections:

```bash
npm run organize
```

This outputs section IDs and names:
```
S12345ABC: Customers (42)
S67890DEF: Projects (18)
```

You can use either the ID (`S12345ABC`) or name (`Customers`) in rules.

---

## How the Tool Works

1. **Authentication**: Uses Slack session tokens (`xoxc` and `xoxd`) from environment variables
2. **Load sections**: Fetches user's sidebar sections from Slack API
3. **Load rules**: Parses the rules JSON file
4. **Load channels**: Fetches all channels the user is a member of
5. **Calculate moves**: For each channel, find the first matching rule and check if it's in the wrong section
6. **Execute moves**: If `--write` is passed, move channels via Slack API (rate-limited to 20/min)

### Rate Limiting

Slack's API has a rate limit of ~20 requests per minute for sidebar operations. The tool handles this automatically, pausing when needed.

---

## Project Structure

```
.
├── organize.ts        # Main source file (all logic)
├── organize.test.ts   # Test suite (vitest)
├── package.json       # Dependencies and scripts
├── tsconfig.json      # TypeScript config
├── .env               # Environment variables (not committed)
└── CLAUDE.md          # This file
```

### Key Exports from organize.ts

For testing or programmatic use:

```typescript
// Utility functions
export function bestPrefix(channelName: string, prefixes: string[]): string | null;
export function getPrefixes(channelNames: string[]): Map<string, number>;
export function getSuffixes(channelNames: string[]): Map<string, number>;

// Rule classes
export abstract class SidebarRule {
  sidebarSectionId: string;
  applies(channelName: string): boolean;
  toString(): string;
  static fromJSON(sidebarSectionId: string, json: RuleJSON): SidebarRule;
}

export class PrefixSidebarRule extends SidebarRule { prefix: string; }
export class SuffixSidebarRule extends SidebarRule { suffix: string; }
export class KeywordSidebarRule extends SidebarRule { keyword: string; }

// Other classes
export class SidebarSection { id: string; name: string; channelIds: string[]; }
export class RateLimiter { wait(): Promise<void>; }
```

---

## Environment Variables

Required in `.env` or exported:

```bash
SLACK_WORKSPACE=your-workspace    # Subdomain (e.g., 'acme' from acme.slack.com)
SLACK_XOXC_TOKEN=xoxc-...         # Session token from browser
SLACK_XOXD_TOKEN=xoxd-...         # Cookie 'd' value from browser
```

**These are sensitive credentials. Never commit them.**

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch
```

Tests cover:
- Rule matching logic (prefix, suffix, keyword)
- Edge cases (empty strings, case sensitivity)
- `SidebarRule.fromJSON()` factory
- `SidebarSection` parsing
- `RateLimiter` timing behaviour

---

## Common Tasks for Agents

### Task: Modify or extend the codebase

When making any code changes:

1. Read and understand the existing code and tests
2. Write tests for your changes **before or alongside** implementation
3. Run `npm test` to ensure all tests pass
4. Never mark a task as complete if tests are failing

### Task: Create a rules file for a user

1. Ask what channel naming conventions they use (prefixes like `proj-`, suffixes like `-alerts`)
2. Ask what sidebar sections they have
3. Generate rules with more specific patterns first
4. Output valid JSON

### Task: Optimise an existing rules file

1. Read the current rules file
2. Check for redundant rules (rules that can never match because an earlier rule catches everything)
3. Check for ordering issues (general rules before specific ones)
4. Suggest reordering or consolidation

### Task: Debug why a channel isn't being moved

1. Get the channel name
2. Walk through rules in order
3. For each rule, check if it matches using the exact matching logic:
   - Prefix: `channelName.startsWith(prefix)`
   - Suffix: `channelName.endsWith(suffix)`
   - Keyword: `channelName.includes(keyword)`
4. First match wins - report which rule matched (or none)

### Task: Add support for a new channel category

1. Identify the naming pattern (prefix/suffix/keyword)
2. Identify the target sidebar section
3. Determine where in the rules list it should go (before more general rules)
4. Add the rule and validate JSON

---

## Gotchas and Edge Cases

1. **Prefix without hyphen**: `"prefix": "cust"` matches `customer`, `custody`, etc. Usually you want `"cust-"`.

2. **Suffix without hyphen**: `"suffix": "alerts"` matches `myalerts`. Usually you want `"-alerts"`.

3. **Keyword is substring match**: `"keyword": "test"` matches `testing`, `contest`, `fastest`. Be specific.

4. **Section name typos**: If `sidebar_section` doesn't match any section, the tool exits with an error.

5. **Empty rules file**: An empty array `[]` is valid but does nothing.

6. **Channel already in section**: Channels already in the correct section are skipped (no unnecessary moves).

7. **Missing type-specific field**: If you specify `type: "prefix"` but omit `prefix`, the rule will have an undefined prefix and match nothing (or error).
