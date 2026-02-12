import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bestPrefix,
  getPrefixes,
  getSuffixes,
  PrefixSidebarRule,
  SuffixSidebarRule,
  KeywordSidebarRule,
  ExactSidebarRule,
  SidebarRule,
  SidebarSection,
  RateLimiter,
  SECTION_CHANNEL_LIMIT,
  findOverflowSections,
  distributeMovesAcrossSections,
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
// ExactSidebarRule
// ============================================================================

describe('ExactSidebarRule', () => {
  it('matches exact channel name only', () => {
    const rule = new ExactSidebarRule('section-1', 'general');
    expect(rule.applies('general')).toBe(true);
  });

  it('does not match when name differs', () => {
    const rule = new ExactSidebarRule('section-1', 'general');
    expect(rule.applies('general-announcements')).toBe(false);
    expect(rule.applies('my-general')).toBe(false);
    expect(rule.applies('genera')).toBe(false);
    expect(rule.applies('')).toBe(false);
  });

  it('is case sensitive', () => {
    const rule = new ExactSidebarRule('section-1', 'general');
    expect(rule.applies('General')).toBe(false);
    expect(rule.applies('GENERAL')).toBe(false);
  });

  it('formats toString correctly', () => {
    const rule = new ExactSidebarRule('section-1', 'general');
    expect(rule.toString()).toBe('Exact: #general');
  });

  it('stores sidebarSectionId correctly', () => {
    const rule = new ExactSidebarRule('my-section-id', 'general');
    expect(rule.sidebarSectionId).toBe('my-section-id');
  });

  it('defaults skipIfOrganized to false', () => {
    const rule = new ExactSidebarRule('section-1', 'general');
    expect(rule.skipIfOrganized).toBe(false);
  });

  it('accepts skipIfOrganized via constructor', () => {
    const rule = new ExactSidebarRule('section-1', 'general', true);
    expect(rule.skipIfOrganized).toBe(true);
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
    const exact = SidebarRule.fromJSON('s1', { type: 'exact', sidebar_section: 's1', name: 'general' });

    expect(prefix).toBeInstanceOf(PrefixSidebarRule);
    expect(suffix).toBeInstanceOf(SuffixSidebarRule);
    expect(keyword).toBeInstanceOf(KeywordSidebarRule);
    expect(exact).toBeInstanceOf(ExactSidebarRule);
  });

  it('creates exact rule with correct name', () => {
    const rule = SidebarRule.fromJSON('s1', { type: 'exact', sidebar_section: 's1', name: 'leadership' });
    expect(rule).toBeInstanceOf(ExactSidebarRule);
    expect((rule as ExactSidebarRule).name).toBe('leadership');
    expect(rule.applies('leadership')).toBe(true);
    expect(rule.applies('leadership-team')).toBe(false);
  });

  it('parses skip_if_organized: true and sets skipIfOrganized', () => {
    const rule = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'cust-', skip_if_organized: true });
    expect(rule.skipIfOrganized).toBe(true);
  });

  it('defaults skipIfOrganized to false when skip_if_organized is omitted', () => {
    const rule = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'cust-' });
    expect(rule.skipIfOrganized).toBe(false);
  });

  it('passes skipIfOrganized through to all rule types', () => {
    const prefix = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'p-', skip_if_organized: true });
    const suffix = SidebarRule.fromJSON('s1', { type: 'suffix', sidebar_section: 's1', suffix: '-s', skip_if_organized: true });
    const keyword = SidebarRule.fromJSON('s1', { type: 'keyword', sidebar_section: 's1', keyword: 'k', skip_if_organized: true });
    const exact = SidebarRule.fromJSON('s1', { type: 'exact', sidebar_section: 's1', name: 'general', skip_if_organized: true });

    expect(prefix.skipIfOrganized).toBe(true);
    expect(suffix.skipIfOrganized).toBe(true);
    expect(keyword.skipIfOrganized).toBe(true);
    expect(exact.skipIfOrganized).toBe(true);
  });

  it('sets skipIfOrganized to false for all rule types when not specified', () => {
    const prefix = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'p-' });
    const suffix = SidebarRule.fromJSON('s1', { type: 'suffix', sidebar_section: 's1', suffix: '-s' });
    const keyword = SidebarRule.fromJSON('s1', { type: 'keyword', sidebar_section: 's1', keyword: 'k' });
    const exact = SidebarRule.fromJSON('s1', { type: 'exact', sidebar_section: 's1', name: 'general' });

    expect(prefix.skipIfOrganized).toBe(false);
    expect(suffix.skipIfOrganized).toBe(false);
    expect(keyword.skipIfOrganized).toBe(false);
    expect(exact.skipIfOrganized).toBe(false);
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

  it('parses mute: true and sets the mute property', () => {
    const rule = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'alert-', mute: true });
    expect(rule.mute).toBe(true);
  });

  it('defaults mute to false when omitted', () => {
    const rule = SidebarRule.fromJSON('s1', { type: 'prefix', sidebar_section: 's1', prefix: 'cust-' });
    expect(rule.mute).toBe(false);
  });

  it('passes mute through to all rule types', () => {
    const prefix = SidebarRule.fromJSON('s1', { type: 'prefix', prefix: 'p-', mute: true });
    const suffix = SidebarRule.fromJSON('s1', { type: 'suffix', suffix: '-s', mute: true });
    const keyword = SidebarRule.fromJSON('s1', { type: 'keyword', keyword: 'k', mute: true });
    const exact = SidebarRule.fromJSON('s1', { type: 'exact', name: 'general', mute: true });

    expect(prefix.mute).toBe(true);
    expect(suffix.mute).toBe(true);
    expect(keyword.mute).toBe(true);
    expect(exact.mute).toBe(true);
  });

  it('works with sidebarSectionId: null (mute-only rule)', () => {
    const rule = SidebarRule.fromJSON(null, { type: 'prefix', prefix: 'alert-', mute: true });
    expect(rule).toBeInstanceOf(PrefixSidebarRule);
    expect(rule.sidebarSectionId).toBeNull();
    expect(rule.mute).toBe(true);
    expect(rule.applies('alert-prod')).toBe(true);
  });
});

// ============================================================================
// Mute property on rule subclasses
// ============================================================================

describe('Mute property on rule subclasses', () => {
  it('PrefixSidebarRule stores mute correctly', () => {
    const rule = new PrefixSidebarRule(null, 'alert-', false, true);
    expect(rule.mute).toBe(true);
    expect(rule.sidebarSectionId).toBeNull();
  });

  it('SuffixSidebarRule stores mute correctly', () => {
    const rule = new SuffixSidebarRule(null, '-alerts', false, true);
    expect(rule.mute).toBe(true);
    expect(rule.sidebarSectionId).toBeNull();
  });

  it('KeywordSidebarRule stores mute correctly', () => {
    const rule = new KeywordSidebarRule(null, 'bot', false, true);
    expect(rule.mute).toBe(true);
    expect(rule.sidebarSectionId).toBeNull();
  });

  it('ExactSidebarRule stores mute correctly', () => {
    const rule = new ExactSidebarRule(null, 'noisy-channel', false, true);
    expect(rule.mute).toBe(true);
    expect(rule.sidebarSectionId).toBeNull();
  });

  it('mute defaults to false in constructors', () => {
    expect(new PrefixSidebarRule('s1', 'p-').mute).toBe(false);
    expect(new SuffixSidebarRule('s1', '-s').mute).toBe(false);
    expect(new KeywordSidebarRule('s1', 'k').mute).toBe(false);
    expect(new ExactSidebarRule('s1', 'n').mute).toBe(false);
  });

  it('rule with both sidebarSectionId and mute stores both', () => {
    const rule = new PrefixSidebarRule('section-1', 'cust-', false, true);
    expect(rule.sidebarSectionId).toBe('section-1');
    expect(rule.mute).toBe(true);
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

// ============================================================================
// SidebarSection.availableCapacity
// ============================================================================

describe('SidebarSection.availableCapacity', () => {
  it('returns full capacity for an empty section', () => {
    const section = new SidebarSection('id', 'name', []);
    expect(section.availableCapacity()).toBe(SECTION_CHANNEL_LIMIT);
  });

  it('returns remaining capacity for a partially filled section', () => {
    const section = new SidebarSection('id', 'name', new Array(450).fill('ch'));
    expect(section.availableCapacity()).toBe(50);
  });

  it('returns zero when at the limit', () => {
    const section = new SidebarSection('id', 'name', new Array(SECTION_CHANNEL_LIMIT).fill('ch'));
    expect(section.availableCapacity()).toBe(0);
  });

  it('returns zero when over the limit', () => {
    const section = new SidebarSection('id', 'name', new Array(SECTION_CHANNEL_LIMIT + 10).fill('ch'));
    expect(section.availableCapacity()).toBe(0);
  });
});

// ============================================================================
// findOverflowSections
// ============================================================================

describe('findOverflowSections', () => {
  it('finds overflow sections matching the base name', () => {
    const sections = [
      new SidebarSection('s1', 'Customers: muted', []),
      new SidebarSection('s2', 'Customers: muted (2)', []),
      new SidebarSection('s3', 'Customers: muted (3)', []),
      new SidebarSection('s4', 'Projects', []),
    ];

    const result = findOverflowSections('Customers: muted', sections);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s2');
    expect(result[1].id).toBe('s3');
  });

  it('returns empty array when no overflow sections exist', () => {
    const sections = [
      new SidebarSection('s1', 'Customers: muted', []),
      new SidebarSection('s2', 'Projects', []),
    ];

    expect(findOverflowSections('Customers: muted', sections)).toEqual([]);
  });

  it('sorts by overflow number', () => {
    const sections = [
      new SidebarSection('s5', 'Alerts (5)', []),
      new SidebarSection('s2', 'Alerts (2)', []),
      new SidebarSection('s10', 'Alerts (10)', []),
    ];

    const result = findOverflowSections('Alerts', sections);
    expect(result.map(s => s.id)).toEqual(['s2', 's5', 's10']);
  });

  it('does not match partial name overlaps', () => {
    const sections = [
      new SidebarSection('s1', 'Cust (2)', []),
      new SidebarSection('s2', 'Customers (2)', []),
    ];

    expect(findOverflowSections('Customers', sections)).toEqual([
      expect.objectContaining({ id: 's2' }),
    ]);
    expect(findOverflowSections('Cust', sections)).toEqual([
      expect.objectContaining({ id: 's1' }),
    ]);
  });

  it('handles base names containing regex metacharacters', () => {
    const sections = [
      new SidebarSection('s1', 'Team (ops) (2)', []),
    ];

    expect(findOverflowSections('Team (ops)', sections)).toHaveLength(1);
  });

  it('does not match non-numeric suffixes', () => {
    const sections = [
      new SidebarSection('s1', 'Alerts (abc)', []),
      new SidebarSection('s2', 'Alerts (2)', []),
    ];

    expect(findOverflowSections('Alerts', sections)).toHaveLength(1);
  });
});

// ============================================================================
// distributeMovesAcrossSections
// ============================================================================

describe('distributeMovesAcrossSections', () => {
  function makeMove(channelId: string, toSectionId: string) {
    return { channelId, fromSidebarSectionId: null, toSidebarSectionId: toSectionId };
  }

  it('keeps all moves in the original section when capacity allows', () => {
    const section = new SidebarSection('s1', 'Test', new Array(498).fill('ch'));
    const moves = [makeMove('ch1', 's1'), makeMove('ch2', 's1')];

    distributeMovesAcrossSections(moves, [section]);

    expect(moves[0].toSidebarSectionId).toBe('s1');
    expect(moves[1].toSidebarSectionId).toBe('s1');
  });

  it('spills moves to overflow sections when original is full', () => {
    const original = new SidebarSection('s1', 'Test', new Array(SECTION_CHANNEL_LIMIT).fill('ch'));
    const overflow = new SidebarSection('s2', 'Test (2)', []);
    const moves = [makeMove('ch1', 's1'), makeMove('ch2', 's1'), makeMove('ch3', 's1')];

    distributeMovesAcrossSections(moves, [original, overflow]);

    expect(moves[0].toSidebarSectionId).toBe('s2');
    expect(moves[1].toSidebarSectionId).toBe('s2');
    expect(moves[2].toSidebarSectionId).toBe('s2');
  });

  it('fills original remaining capacity before spilling', () => {
    const original = new SidebarSection('s1', 'Test', new Array(499).fill('ch'));
    const overflow = new SidebarSection('s2', 'Test (2)', []);
    const moves = [makeMove('ch1', 's1'), makeMove('ch2', 's1'), makeMove('ch3', 's1')];

    distributeMovesAcrossSections(moves, [original, overflow]);

    expect(moves[0].toSidebarSectionId).toBe('s1');
    expect(moves[1].toSidebarSectionId).toBe('s2');
    expect(moves[2].toSidebarSectionId).toBe('s2');
  });

  it('distributes across multiple overflow sections', () => {
    const original = new SidebarSection('s1', 'Test', new Array(SECTION_CHANNEL_LIMIT).fill('ch'));
    const overflow1 = new SidebarSection('s2', 'Test (2)', new Array(499).fill('ch'));
    const overflow2 = new SidebarSection('s3', 'Test (3)', []);
    const moves = [makeMove('ch1', 's1'), makeMove('ch2', 's1'), makeMove('ch3', 's1')];

    distributeMovesAcrossSections(moves, [original, overflow1, overflow2]);

    expect(moves[0].toSidebarSectionId).toBe('s2');
    expect(moves[1].toSidebarSectionId).toBe('s3');
    expect(moves[2].toSidebarSectionId).toBe('s3');
  });

  it('leaves moves unchanged when no capacity available', () => {
    const original = new SidebarSection('s1', 'Test', new Array(SECTION_CHANNEL_LIMIT).fill('ch'));
    const moves = [makeMove('ch1', 's1'), makeMove('ch2', 's1')];

    distributeMovesAcrossSections(moves, [original]);

    // Moves still point at the original — they'll fail at API time
    expect(moves[0].toSidebarSectionId).toBe('s1');
    expect(moves[1].toSidebarSectionId).toBe('s1');
  });

  it('handles empty moves array', () => {
    const section = new SidebarSection('s1', 'Test', []);
    const moves: ReturnType<typeof makeMove>[] = [];

    distributeMovesAcrossSections(moves, [section]);

    expect(moves).toEqual([]);
  });
});
