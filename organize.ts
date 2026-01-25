import 'dotenv/config';
import * as https from 'https';
import * as zlib from 'zlib';
import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

interface SidebarSectionJSON {
  channel_section_id: string;
  name: string;
  type: string;
  channel_ids_page: { channel_ids: string[] };
}

interface ChannelJSON {
  id: string;
  name: string;
  is_channel: boolean;
  is_member: boolean;
}

interface RuleJSON {
  type: 'prefix' | 'suffix' | 'keyword';
  sidebar_section: string;
  prefix?: string;
  suffix?: string;
  keyword?: string;
}

interface SidebarMove {
  channelId: string;
  fromSidebarSectionId: string | null;
  toSidebarSectionId: string;
}

// ============================================================================
// SidebarSection
// ============================================================================

export class SidebarSection {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly channelIds: string[]
  ) {}

  static fromJSON(json: SidebarSectionJSON): SidebarSection {
    return new SidebarSection(
      json.channel_section_id,
      json.name,
      json.channel_ids_page.channel_ids
    );
  }

  includesChannel(channelId: string): boolean {
    return this.channelIds.includes(channelId);
  }
}

// ============================================================================
// Sidebar Rules
// ============================================================================

export abstract class SidebarRule {
  constructor(public readonly sidebarSectionId: string) {}

  abstract applies(channelName: string): boolean;
  abstract toString(): string;

  static fromJSON(sidebarSectionId: string, json: RuleJSON): SidebarRule {
    switch (json.type) {
      case 'prefix':
        return new PrefixSidebarRule(sidebarSectionId, json.prefix!);
      case 'suffix':
        return new SuffixSidebarRule(sidebarSectionId, json.suffix!);
      case 'keyword':
        return new KeywordSidebarRule(sidebarSectionId, json.keyword!);
      default:
        throw new Error(`Unknown rule type: ${(json as RuleJSON).type}`);
    }
  }
}

export class PrefixSidebarRule extends SidebarRule {
  constructor(sidebarSectionId: string, public readonly prefix: string) {
    super(sidebarSectionId);
  }

  applies(channelName: string): boolean {
    return channelName.startsWith(this.prefix);
  }

  toString(): string {
    return `Prefix: #${this.prefix}`;
  }
}

export class SuffixSidebarRule extends SidebarRule {
  constructor(sidebarSectionId: string, public readonly suffix: string) {
    super(sidebarSectionId);
  }

  applies(channelName: string): boolean {
    return channelName.endsWith(this.suffix);
  }

  toString(): string {
    return `Suffix: #${this.suffix}`;
  }
}

export class KeywordSidebarRule extends SidebarRule {
  constructor(sidebarSectionId: string, public readonly keyword: string) {
    super(sidebarSectionId);
  }

  applies(channelName: string): boolean {
    return channelName.includes(this.keyword);
  }

  toString(): string {
    return `Keyword: #${this.keyword}`;
  }
}

// ============================================================================
// Helper functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function bestPrefix(channelName: string, prefixes: string[]): string | null {
  const matches = prefixes.filter(prefix => channelName.startsWith(prefix));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.length - a.length)[0];
}

export function getPrefixes(channelNames: string[]): Map<string, number> {
  const prefixCandidates = new Map<string, number>();

  for (const name of channelNames) {
    const parts = name.split('-');
    const partsWithoutLast = parts.slice(0, -1); // Cut off the last section
    const firstFourParts = partsWithoutLast.slice(0, 4); // Only treat first 4 sections as prefixes

    for (let i = 0; i < firstFourParts.length; i++) {
      const prefix = firstFourParts.slice(0, i + 1).join('-');
      prefixCandidates.set(prefix, (prefixCandidates.get(prefix) || 0) + 1);
    }
  }

  return prefixCandidates;
}

export function getSuffixes(channelNames: string[]): Map<string, number> {
  // Reverse the channel names, get prefixes, then reverse the results back
  const reversedNames = channelNames.map(name =>
    name.split('-').reverse().join('-')
  );
  const prefixes = getPrefixes(reversedNames);

  const suffixes = new Map<string, number>();
  for (const [key, value] of prefixes) {
    const suffix = key.split('-').reverse().join('-');
    suffixes.set(suffix, value);
  }
  return suffixes;
}

// ============================================================================
// Rate Limiter
// ============================================================================

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly intervalMs: number
  ) {}

  async wait(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than the interval
    this.timestamps = this.timestamps.filter(t => now - t < this.intervalMs);

    if (this.timestamps.length >= this.limit) {
      // Wait until the oldest timestamp expires
      const waitTime = this.timestamps[0] + this.intervalMs - now;
      if (waitTime > 0) {
        await sleep(waitTime);
      }
      // Recurse to recheck
      return this.wait();
    }

    this.timestamps.push(Date.now());
  }
}

// ============================================================================
// Slack Client
// ============================================================================

class SlackClient {
  private readonly baseUrl: string;

  constructor(
    workspace: string,
    private readonly cookie: string,
    private readonly token: string
  ) {
    this.baseUrl = `https://${workspace}.slack.com`;
  }

  async ping(): Promise<boolean> {
    const result = await this.getSidebarList();
    return result?.ok === true;
  }

  async getSidebarList(): Promise<{ ok: boolean; channel_sections: SidebarSectionJSON[] }> {
    const body = `
------BOUNDARY
Content-Disposition: form-data; name="token"

${this.token}
------BOUNDARY
`;

    return this.makeRequest('/api/users.channelSections.list', body);
  }

  async getChannels(
    cursor?: string,
    onFetched?: () => void
  ): Promise<ChannelJSON[]> {
    const params: Record<string, string> = { limit: '1000' };
    if (cursor) {
      params.cursor = cursor;
    }

    const body = `
------BOUNDARY
Content-Disposition: form-data; name="token"

${this.token}
------BOUNDARY
Content-Disposition: form-data; name="types"

public_channel,private_channel
------BOUNDARY

`;

    const json = await this.makeRequest('/api/conversations.list', body, params);

    if (json.error === 'ratelimited') {
      const retryAfter = (json.retry_after || 60) * 1000;
      await sleep(retryAfter);
      return this.getChannels(cursor, onFetched);
    }

    onFetched?.();

    const nextCursor = json.response_metadata?.next_cursor;
    let channels: ChannelJSON[] = json.channels || [];

    if (nextCursor && nextCursor !== '') {
      const moreChannels = await this.getChannels(nextCursor, onFetched);
      channels = channels.concat(moreChannels);
    }

    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  async sidebarMove(
    channelId: string,
    toSidebarSectionId: string,
    fromSidebarSectionId?: string | null
  ): Promise<{ ok: boolean; error?: string }> {
    let body = `
------BOUNDARY
Content-Disposition: form-data; name="token"

${this.token}
------BOUNDARY
Content-Disposition: form-data; name="insert"

[{"channel_section_id":"${toSidebarSectionId}","channel_ids":["${channelId}"]}]
------BOUNDARY
`;

    if (fromSidebarSectionId) {
      body += `
------BOUNDARY
Content-Disposition: form-data; name="remove"

[{"channel_section_id":"${fromSidebarSectionId}","channel_ids":["${channelId}"]}]
`;
    }

    return this.makeRequest('/api/users.channelSections.channels.bulkUpdate', body);
  }

  private makeRequest(
    path: string,
    body: string,
    params: Record<string, string> = {}
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.append(key, value);
      }

      const options: https.RequestOptions = {
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'Cookie': this.cookie,
          'Content-Type': 'multipart/form-data; boundary=----BOUNDARY',
          'Accept-Encoding': 'gzip',
        },
        // Skip certificate verification (matches Ruby's VERIFY_NONE)
        rejectUnauthorized: false,
      };

      const req = https.request(options, res => {
        const chunks: Buffer[] = [];

        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          let buffer = Buffer.concat(chunks);

          // Handle gzip decompression
          if (res.headers['content-encoding'] === 'gzip') {
            try {
              buffer = zlib.gunzipSync(buffer);
            } catch {
              // If decompression fails, use raw buffer
            }
          }

          try {
            const json = JSON.parse(buffer.toString('utf8'));
            resolve(json);
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${buffer.toString('utf8').slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

// ============================================================================
// Progress Bar
// ============================================================================

class ProgressBar {
  private current = 0;
  private startTime = Date.now();

  constructor(private readonly total: number) {}

  increment(): void {
    this.current++;
    this.render();
  }

  private render(): void {
    const percent = Math.round((this.current / this.total) * 100);
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = this.current / elapsed;
    const remaining = rate > 0 ? (this.total - this.current) / rate : 0;

    const barWidth = 30;
    const filled = Math.round((this.current / this.total) * barWidth);
    const empty = barWidth - filled;
    const bar = '='.repeat(filled) + ' '.repeat(empty);

    const eta = remaining > 0 ? `ETA: ${Math.round(remaining)}s` : '';
    process.stdout.write(
      `\r${eta.padEnd(12)} [${bar}] ${this.current} (${percent}%) Channels Organised`
    );
  }

  finish(): void {
    console.log(); // New line after progress bar
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const rulesFile = args.find(a => !a.startsWith('--'));
  const writeChanges = args.includes('--write');

  // Load rules if provided
  let sidebarRulesRaw: RuleJSON[] = [];
  if (rulesFile) {
    try {
      const content = fs.readFileSync(rulesFile, 'utf8');
      sidebarRulesRaw = JSON.parse(content);
    } catch (e) {
      console.error(`Failed to read rules file: ${rulesFile}`);
      process.exit(1);
    }
  }

  // Load environment variables
  const workspace = process.env.SLACK_WORKSPACE;
  const token = process.env.SLACK_XOXC_TOKEN;
  const xoxdToken = process.env.SLACK_XOXD_TOKEN;

  if (!workspace || !token || !xoxdToken) {
    console.error('Missing required environment variables:');
    console.error('  SLACK_WORKSPACE, SLACK_XOXC_TOKEN, SLACK_XOXD_TOKEN');
    process.exit(1);
  }

  const cookie = `d=${xoxdToken}`;
  const client = new SlackClient(workspace, cookie, token);

  // Test connectivity
  if (!(await client.ping())) {
    console.log("Can't connect to Slack - are you sure you've set valid credentials?");
    process.exit(1);
  }

  // Load sidebar sections
  console.log();
  console.log('LOADING SIDEBAR SECTIONS');
  console.log('=========================');

  const sidebarListResponse = await client.getSidebarList();
  const sidebarSections = sidebarListResponse.channel_sections
    .filter(s => s.type === 'standard')
    .map(s => SidebarSection.fromJSON(s));

  const getSidebarSection = (id: string): SidebarSection | undefined =>
    sidebarSections.find(s => s.id === id);

  // Print sidebar sections
  for (const s of [...sidebarSections].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${s.id}: ${s.name} (${s.channelIds.length})`);
  }

  // Load rules
  let sidebarRules: SidebarRule[] = [];
  if (sidebarRulesRaw.length > 0) {
    console.log();
    console.log('LOADING RULES');
    console.log('=============');

    sidebarRules = sidebarRulesRaw.map(json => {
      const sidebarSection =
        sidebarSections.find(s => json.sidebar_section === s.id) ||
        sidebarSections.find(s => json.sidebar_section === s.name);

      if (!sidebarSection) {
        console.log(`Couldn't find sidebar section for ${json.sidebar_section}`);
        process.exit(1);
      }

      return SidebarRule.fromJSON(sidebarSection.id, json);
    });

    const maxRuleLength = Math.max(...sidebarRules.map(r => r.toString().length));
    for (const rule of sidebarRules) {
      const sidebar = getSidebarSection(rule.sidebarSectionId);
      console.log(
        `${rule.toString().padEnd(maxRuleLength)} ➜ ${sidebar?.name} (${rule.sidebarSectionId})`
      );
    }
  }

  // Load channels
  console.log();
  console.log('LOADING CHANNELS');
  console.log('================');

  const allChannels = await client.getChannels(undefined, () => process.stdout.write('.'));

  // Filter to real channels only
  const realChannels = allChannels.filter(c => c.is_channel);

  // Filter to channels user is a member of
  const memberChannels = realChannels.filter(c => c.is_member);
  const channels = new Map<string, ChannelJSON>();
  for (const c of memberChannels) {
    channels.set(c.id, c);
  }

  console.log(
    `\rLoaded ${realChannels.length} channels. Filtered to the ${channels.size} ones you're a member of.`
  );

  // If no rules provided, suggest some
  if (sidebarRules.length === 0) {
    console.log();
    console.log('RULE SUGGESTIONS');
    console.log('=====================');
    console.log();
    console.log("You haven't provided any sidebar_rules, so here are some");
    console.log('ideas based on channels in your workspace:');
    console.log();

    // Generate proposed prefix rules
    const proposedPrefixRules: Array<{
      type: string;
      sidebar_section: string;
      prefix: string;
      count: number;
    }> = [];

    for (const sidebarSection of sidebarSections) {
      console.log(sidebarSection.name);

      const channelNames = Array.from(channels.values())
        .filter(c => sidebarSection.includesChannel(c.id))
        .map(c => c.name);

      const potentialPrefixes = getPrefixes(channelNames);

      const topPrefixes = Array.from(potentialPrefixes.entries())
        .filter(([k, v]) => v >= 5) // At least 5 channels
        .filter(([k]) => k.length < 20) // Not too long
        .sort((a, b) => b[1] - a[1]) // Most popular first
        .slice(0, 3); // Top 3

      for (const [prefix, count] of topPrefixes) {
        proposedPrefixRules.push({
          type: 'prefix',
          sidebar_section: sidebarSection.name,
          prefix: `${prefix}-`,
          count,
        });
      }
    }

    // Generate proposed suffix rules
    const proposedSuffixRules: Array<{
      type: string;
      sidebar_section: string;
      suffix: string;
      count: number;
    }> = [];

    for (const sidebarSection of sidebarSections) {
      const channelNames = Array.from(channels.values())
        .filter(c => sidebarSection.includesChannel(c.id))
        .map(c => c.name);

      const potentialSuffixes = getSuffixes(channelNames);

      const topSuffixes = Array.from(potentialSuffixes.entries())
        .filter(([k, v]) => v >= 5)
        .filter(([k]) => k.length < 20)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      for (const [suffix, count] of topSuffixes) {
        proposedSuffixRules.push({
          type: 'suffix',
          sidebar_section: sidebarSection.name,
          suffix: `-${suffix}`,
          count,
        });
      }
    }

    // Deduplicate prefix rules - keep the one with most channels
    const prefixMap = new Map<string, (typeof proposedPrefixRules)[0]>();
    for (const rule of proposedPrefixRules) {
      const existing = prefixMap.get(rule.prefix);
      if (!existing || rule.count > existing.count) {
        prefixMap.set(rule.prefix, rule);
      }
    }

    // Deduplicate suffix rules
    const suffixMap = new Map<string, (typeof proposedSuffixRules)[0]>();
    for (const rule of proposedSuffixRules) {
      const existing = suffixMap.get(rule.suffix);
      if (!existing || rule.count > existing.count) {
        suffixMap.set(rule.suffix, rule);
      }
    }

    // Combine and sort
    const proposedRules = [...prefixMap.values(), ...suffixMap.values()].sort((a, b) => {
      const sectionCompare = a.sidebar_section.localeCompare(b.sidebar_section);
      if (sectionCompare !== 0) return sectionCompare;
      return b.count - a.count;
    });

    // Print as JSON (without count)
    console.log('[');
    const lines = proposedRules.map(rule => {
      const { count, ...ruleWithoutCount } = rule;
      return `    ${JSON.stringify(ruleWithoutCount).replace(/","/g, '", "')}`;
    });
    console.log(lines.join(',\n'));
    console.log(']');

    console.log();
    console.log('To dry-run, tweak and save the above in a rules.json file somewhere and run that');
    console.log();
    console.log('    npx tsx organize.ts rules.json --write');
    console.log();
    console.log();
    process.exit(0);
  }

  // Calculate moves
  let totalMatches = 0;
  const sidebarMoves: SidebarMove[] = [];

  for (const [channelId, channel] of channels) {
    const rule = sidebarRules.find(r => r.applies(channel.name));
    if (!rule) continue;

    totalMatches++;

    const toSidebarSection = getSidebarSection(rule.sidebarSectionId);
    if (!toSidebarSection) continue;

    // Skip if already in correct section
    if (toSidebarSection.includesChannel(channelId)) continue;

    // Find current section (if any)
    const fromSidebarSection = sidebarSections.find(s => s.includesChannel(channelId));

    sidebarMoves.push({
      channelId,
      fromSidebarSectionId: fromSidebarSection?.id || null,
      toSidebarSectionId: toSidebarSection.id,
    });
  }

  console.log();
  console.log('ORGANISING SIDEBAR');
  console.log('==================');

  console.log(`${totalMatches} channels match your sidebar rules.`);

  if (sidebarMoves.length === 0) {
    console.log();
    console.log('Good news - your sidebar is already completely organised, so nothing to do here!');
    process.exit(0);
  }

  console.log();
  console.log(
    `${sidebarMoves.length} ${sidebarMoves.length === 1 ? 'is' : 'are'} in the wrong place!`
  );

  if (!writeChanges) {
    console.log();
    console.log('DRY RUN');
    console.log('=======');

    console.log();
    console.log("You didn't pass a --write flag, so we're just going to do a dry run for now.");
    console.log();
    console.log('We would move:');
    console.log();

    // Group by destination
    const movesByDestination = new Map<string, SidebarMove[]>();
    for (const move of sidebarMoves) {
      const moves = movesByDestination.get(move.toSidebarSectionId) || [];
      moves.push(move);
      movesByDestination.set(move.toSidebarSectionId, moves);
    }

    for (const [toSidebarSectionId, moves] of movesByDestination) {
      const toSidebarSection = getSidebarSection(toSidebarSectionId);
      console.log(`➜ ${toSidebarSection?.name} (${toSidebarSectionId})`);

      for (const move of moves) {
        const channel = channels.get(move.channelId);
        console.log(`    #${channel?.name} (${move.channelId})`);
      }

      console.log();
    }

    console.log();
    console.log('---');
    console.log();
    console.log('To actually move your channels, re-run this with a --write flag:');
    console.log();
    console.log(`    npx tsx organize.ts ${rulesFile} --write`);
    console.log();
    console.log();
    process.exit(0);
  }

  // Actually move channels
  console.log();
  console.log("Let's sort it!");
  console.log();
  console.log('Note: Rate limits are harsh here, so we\'ll do as many as we can, but');
  console.log('      the process will likely pause periodically whilst we let the');
  console.log('      rate limit recover.');
  console.log();

  // Slack Tier 2 rate limit: max 20/min
  const limiter = new RateLimiter(20, 60000);
  const progressBar = new ProgressBar(sidebarMoves.length);

  const errors: Array<{ move: SidebarMove; result: any }> = [];
  const successfulMoves: SidebarMove[] = [];

  for (const move of sidebarMoves) {
    await limiter.wait();

    const result = await client.sidebarMove(
      move.channelId,
      move.toSidebarSectionId,
      move.fromSidebarSectionId
    );

    progressBar.increment();

    if (result.ok) {
      successfulMoves.push(move);
    } else {
      errors.push({ move, result });
    }
  }

  progressBar.finish();

  console.log();
  console.log(`Organised ${successfulMoves.length} channels`);

  console.log();
  console.log('We moved:');
  console.log();

  // Group successful moves by destination
  const successByDestination = new Map<string, SidebarMove[]>();
  for (const move of successfulMoves) {
    const moves = successByDestination.get(move.toSidebarSectionId) || [];
    moves.push(move);
    successByDestination.set(move.toSidebarSectionId, moves);
  }

  for (const [toSidebarSectionId, moves] of successByDestination) {
    const toSidebarSection = getSidebarSection(toSidebarSectionId);
    console.log(`➜ ${toSidebarSection?.name} (${toSidebarSectionId})`);

    for (const move of moves) {
      const channel = channels.get(move.channelId);
      console.log(`    #${channel?.name} (${move.channelId})`);
    }

    console.log();
  }

  console.log();
  console.log('Summary:');
  console.log();

  const summaryByDestination = new Map<string, number>();
  for (const move of sidebarMoves) {
    summaryByDestination.set(
      move.toSidebarSectionId,
      (summaryByDestination.get(move.toSidebarSectionId) || 0) + 1
    );
  }

  for (const [sidebarSectionId, count] of summaryByDestination) {
    const sidebarSection = getSidebarSection(sidebarSectionId);
    console.log(`    Moved ${count} channels to ${sidebarSection?.name}`);
  }

  if (errors.length > 0) {
    console.log();
    console.log(`Sadly ${errors.length} channels couldn't be moved:`);
    console.log();
    for (const err of errors) {
      console.log(`    ${JSON.stringify(err)}`);
    }
  }

  console.log();
  console.log('Enjoy your Zen!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
