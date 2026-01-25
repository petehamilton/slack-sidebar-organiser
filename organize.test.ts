import { describe, it, expect } from 'vitest';
import { bestPrefix, getPrefixes, getSuffixes } from './organize';

describe('bestPrefix', () => {
  it('handles no matches', () => {
    expect(bestPrefix('my-channel-name', ['project', 'cust'])).toBeNull();
  });

  it('handles simple matches', () => {
    expect(bestPrefix('project-testing', ['project', 'cust'])).toBe('project');
  });

  it('handles subset matches', () => {
    expect(bestPrefix('cust-widgets-inc', ['project', 'cust', 'cust-vip'])).toBe('cust');
    expect(bestPrefix('cust-vip-linear', ['project', 'cust', 'cust-vip'])).toBe('cust-vip');
  });
});

describe('getPrefixes', () => {
  it('returns the most common prefixes with their counts', () => {
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

  it('handles a list with channels that have no common prefixes', () => {
    const result = getPrefixes(['dog-walk', 'cat-nap', 'fish-swim']);

    expect(Object.fromEntries(result)).toEqual({
      dog: 1,
      cat: 1,
      fish: 1,
    });
  });

  it('handles channels with no prefix', () => {
    const result = getPrefixes(['customer-a', 'something']);

    expect(Object.fromEntries(result)).toEqual({
      customer: 1,
    });
  });
});

describe('getSuffixes', () => {
  it('returns the most common suffixes with their counts', () => {
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

  it('handles a list with channels that have no common suffixes', () => {
    const result = getSuffixes(['dog-walk', 'cat-nap', 'fish-swim']);

    expect(Object.fromEntries(result)).toEqual({
      walk: 1,
      nap: 1,
      swim: 1,
    });
  });

  it('handles channels with no suffix', () => {
    const result = getSuffixes(['a-customer', 'something']);

    expect(Object.fromEntries(result)).toEqual({
      customer: 1,
    });
  });
});
