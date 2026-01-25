import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bestPrefix,
  getPrefixes,
  getSuffixes,
  PrefixSidebarRule,
  SuffixSidebarRule,
  KeywordSidebarRule,
  SidebarRule,
  SidebarSection,
  RateLimiter,
} from './organize';

// ============================================================================
// bestPrefix
// ============================================================================

describe('bestPrefix', () => {
  it('returns null when no prefixes match', () => {
    expect(bestPrefix('my-channel-name', ['project', 'cust'])).toBeNull();
  });

  it('returns the matching prefix', () => {
    expect(bestPrefix('project-testing', ['project', 'cust'])).toBe('project');
  });

  it('returns the longest matching prefix when multiple match', () => {
    expect(bestPrefix('cust-widgets-inc', ['project', 'cust', 'cust-vip'])).toBe('cust');
    expect(bestPrefix('cust-vip-linear', ['project', 'cust', 'cust-vip'])).toBe('cust-vip');
  });

  it('returns null for empty inputs', () => {
    expect(bestPrefix('my-channel', [])).toBeNull();
    expect(bestPrefix('', ['project', 'cust'])).toBeNull();
  });

  it('returns null when all prefixes are longer than channel name', () => {
    expect(bestPrefix('ab', ['abc', 'abcd'])).toBeNull();
  });
});

// ============================================================================
// getPrefixes
// ============================================================================

describe('getPrefixes', () => {
  it('counts prefix occurrences across channels', () => {
    const result = getPrefixes([
      'project-alpha',
      'project-beta',
      'customer-a',
      'customer-b',
      'customer-c',
      'some-other-channel',
    ]);

    expect(Object.fromEntries(result)).toEqual({
      customer: 3,
      project: 2,
      some: 1,
      'some-other': 1,
    });
  });

  it('handles channels without hyphens (no prefix)', () => {
    const result = getPrefixes(['customer-a', 'something']);
    expect(Object.fromEntries(result)).toEqual({ customer: 1 });
  });

  it('handles empty array', () => {
    expect(Object.fromEntries(getPrefixes([]))).toEqual({});
  });

  it('limits to first 4 segments for long channel names', () => {
    const result = getPrefixes(['a-b-c-d-e-suffix']);
    expect(Object.fromEntries(result)).toEqual({
      a: 1,
      'a-b': 1,
      'a-b-c': 1,
      'a-b-c-d': 1,
    });
  });

  it('handles double hyphens (empty segment)', () => {
    const result = getPrefixes(['test--channel']);
    // splits to ['test', '', 'channel'] -> prefixes include 'test' and 'test-'
    expect(Object.fromEntries(result)).toEqual({
      test: 1,
      'test-': 1,
    });
  });
});

// ============================================================================
// getSuffixes
// ============================================================================

describe('getSuffixes', () => {
  it('counts suffix occurrences across channels', () => {
    const result = getSuffixes([
      'alpha-project',
      'beta-project',
      'a-customer',
      'b-customer',
      'c-customer',
      'some-other-channel',
    ]);

    expect(Object.fromEntries(result)).toEqual({
      customer: 3,
      project: 2,
      channel: 1,
      'other-channel': 1,
    });
  });

  it('handles channels without hyphens (no suffix)', () => {
    const result = getSuffixes(['a-customer', 'something']);
    expect(Object.fromEntries(result)).toEqual({ customer: 1 });
  });

  it('handles empty array', () => {
    expect(Object.fromEntries(getSuffixes([]))).toEqual({});
  });
});

// ============================================================================
// PrefixSidebarRule
// ============================================================================

describe('PrefixSidebarRule', () => {
  it('matches channels starting with the prefix', () => {
    const rule = new PrefixSidebarRule('section-1', 'cust-');
    expect(rule.applies('cust-widgets')).toBe(true);
    expect(rule.applies('cust-')).toBe(true); // exact match
  });

  it('does not match when prefix is missing or incomplete', () => {
    const rule = new PrefixSidebarRule('section-1', 'cust-');
    expect(rule.applies('cust')).toBe(false); // missing hyphen
    expect(rule.applies('')).toBe(false);
    expect(rule.applies('customer')).toBe(false); // different word
  });

  it('is case sensitive', () => {
    const rule = new PrefixSidebarRule('section-1', 'cust-');
    expect(rule.applies('CUST-widgets')).toBe(false);
  });

  it('formats toString correctly', () => {
    const rule = new PrefixSidebarRule('section-1', 'cust-');
    expect(rule.toString()).toBe('Prefix: #cust-');
  });
});

// ============================================================================
// SuffixSidebarRule
// ============================================================================

describe('SuffixSidebarRule', () => {
  it('matches channels ending with the suffix', () => {
    const rule = new SuffixSidebarRule('section-1', '-project');
    expect(rule.applies('alpha-project')).toBe(true);
    expect(rule.applies('-project')).toBe(true); // exact match
  });

  it('does not match when suffix is not at end', () => {
    const rule = new SuffixSidebarRule('section-1', '-project');
    expect(rule.applies('project')).toBe(false); // missing leading hyphen
    expect(rule.applies('-project-alpha')).toBe(false); // suffix at start
    expect(rule.applies('alpha-project-beta')).toBe(false); // suffix in middle
    expect(rule.applies('alpha-project-')).toBe(false); // trailing hyphen
  });

  it('is case sensitive', () => {
    const rule = new SuffixSidebarRule('section-1', '-project');
    expect(rule.applies('alpha-PROJECT')).toBe(false);
  });

  it('formats toString correctly', () => {
    const rule = new SuffixSidebarRule('section-1', '-project');
    expect(rule.toString()).toBe('Suffix: #-project');
  });
});

// ============================================================================
// KeywordSidebarRule
// ============================================================================

describe('KeywordSidebarRule', () => {
  it('matches keyword anywhere in channel name', () => {
    const rule = new KeywordSidebarRule('section-1', 'standup');
    expect(rule.applies('standup-team')).toBe(true); // start
    expect(rule.applies('team-standup-daily')).toBe(true); // middle
    expect(rule.applies('team-standup')).toBe(true); // end
    expect(rule.applies('standup')).toBe(true); // exact
  });

  it('does not match when keyword is absent', () => {
    const rule = new KeywordSidebarRule('section-1', 'standup');
    expect(rule.applies('team-meeting')).toBe(false);
  });

  it('matches partial words (substring match)', () => {
    const rule = new KeywordSidebarRule('section-1', 'stand');
    expect(rule.applies('standup')).toBe(true);
  });

  it('is case sensitive', () => {
    const rule = new KeywordSidebarRule('section-1', 'standup');
    expect(rule.applies('team-STANDUP-daily')).toBe(false);
  });

  it('empty keyword matches everything (known edge case)', () => {
    const rule = new KeywordSidebarRule('section-1', '');
    expect(rule.applies('any-channel')).toBe(true);
  });

  it('formats toString correctly', () => {
    const rule = new KeywordSidebarRule('section-1', 'standup');
    expect(rule.toString()).toBe('Keyword: #standup');
  });
});

// ============================================================================
// SidebarRule.fromJSON
// ============================================================================

describe('SidebarRule.fromJSON', () => {
  it('creates correct rule type from JSON', () => {
    const prefix = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'cust-' });
    const suffix = SidebarRule.fromJSON('s1', { type: 'suffix', sidebar_section: 's1', suffix: '-proj' });
    const keyword = SidebarRule.fromJSON('s1', { type: 'keyword', sidebar_section: 's1', keyword: 'test' });

    expect(prefix).toBeInstanceOf(PrefixSidebarRule);
    expect(suffix).toBeInstanceOf(SuffixSidebarRule);
    expect(keyword).toBeInstanceOf(KeywordSidebarRule);
  });

  it('throws error for unknown rule type', () => {
    expect(() => {
      SidebarRule.fromJSON('s1', { type: 'regex' as any, sidebar_section: 's1' });
    }).toThrow('Unknown rule type: regex');
  });

  it('creates rule with undefined value when field is missing (potential bug)', () => {
    const rule = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1' });
    expect((rule as PrefixSidebarRule).prefix).toBeUndefined();
  });
});

// ============================================================================
// SidebarSection
// ============================================================================

describe('SidebarSection', () => {
  it('parses JSON structure correctly', () => {
    const section = SidebarSection.fromJSON({
      channel_section_id: 'section-abc',
      name: 'Projects',
      type: 'standard',
      channel_ids_page: { channel_ids: ['ch1', 'ch2', 'ch3'] },
    });

    expect(section.id).toBe('section-abc');
    expect(section.name).toBe('Projects');
    expect(section.channelIds).toEqual(['ch1', 'ch2', 'ch3']);
  });

  it('includesChannel checks membership correctly', () => {
    const section = new SidebarSection('id', 'name', ['ch1', 'ch2']);
    expect(section.includesChannel('ch1')).toBe(true);
    expect(section.includesChannel('ch3')).toBe(false);

    const empty = new SidebarSection('id', 'name', []);
    expect(empty.includesChannel('ch1')).toBe(false);
  });
});

// ============================================================================
// RateLimiter
// ============================================================================

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit immediately', async () => {
    const limiter = new RateLimiter(3, 1000);

    await limiter.wait();
    await limiter.wait();
    await limiter.wait();

    expect(Date.now()).toBe(0); // no time passed
  });

  it('waits when limit is exceeded', async () => {
    const limiter = new RateLimiter(2, 1000);

    await limiter.wait();
    await limiter.wait();

    const waitPromise = limiter.wait();
    await vi.advanceTimersByTimeAsync(1000);
    await waitPromise;

    expect(Date.now()).toBe(1000);
  });

  it('allows requests again after timestamps expire', async () => {
    const limiter = new RateLimiter(2, 1000);

    await limiter.wait();
    await limiter.wait();

    // Wait for timestamps to expire
    await vi.advanceTimersByTimeAsync(1001);

    const start = Date.now();
    await limiter.wait();
    expect(Date.now() - start).toBe(0); // immediate
  });

  it('processes queued requests in order', async () => {
    const limiter = new RateLimiter(1, 100);
    await limiter.wait();

    const results: number[] = [];
    const p1 = limiter.wait().then(() => results.push(1));
    const p2 = limiter.wait().then(() => results.push(2));

    await vi.advanceTimersByTimeAsync(100);
    await p1;
    await vi.advanceTimersByTimeAsync(100);
    await p2;

    expect(results).toEqual([1, 2]);
  });
});
