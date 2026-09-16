import { describe, it, expect } from 'vitest';
import { MatchingEngine } from './matching.engine.js';
import { MATCHING_VERSION } from './matching.types.js';

const engine = new MatchingEngine();

describe('MatchingEngine — DOMAIN.md formula', () => {
  it('calculates correct score with title weighting (Laravel example)', () => {
    const skills = [
      { id: '1', normalizedName: 'laravel', weight: 40, type: 'required' as const, normalizedAliases: [] },
      { id: '2', normalizedName: 'php', weight: 30, type: 'preferred' as const, normalizedAliases: [] },
      { id: '3', normalizedName: 'mysql', weight: 20, type: 'preferred' as const, normalizedAliases: [] },
      { id: '4', normalizedName: 'docker', weight: 10, type: 'preferred' as const, normalizedAliases: [] },
    ];
    // Title has Laravel (full 40), desc has php/mysql/docker partial 0.7 each
    // matchedWeight = 40 + 30*0.7 +20*0.7 +10*0.7 = 40+21+14+7=82
    const result = engine.calculate({ title: 'Laravel Developer', description: 'PHP, MySQL, Docker' }, skills);
    expect(result.score).toBe(82);
    expect(result.matchingVersion).toBe(MATCHING_VERSION);
    expect(result.isDisqualified).toBe(false);
    expect(result.matchedSkills).toHaveLength(4);
  });

  it('returns 0 for missing required skill (disqualified)', () => {
    const skills = [
      { id: '1', normalizedName: 'laravel', weight: 40, type: 'required' as const, normalizedAliases: [] },
      { id: '2', normalizedName: 'php', weight: 30, type: 'preferred' as const, normalizedAliases: [] },
    ];
    const result = engine.calculate({ title: 'PHP Developer', description: 'PHP MySQL' }, skills);
    expect(result.score).toBe(0);
    expect(result.isDisqualified).toBe(true);
    expect(result.requiredMissing).toHaveLength(1);
    expect(result.requiredMissing[0].skillName).toBe('laravel');
  });

  it('returns 0 when excluded skill is present', () => {
    const skills = [
      { id: '1', normalizedName: 'laravel', weight: 40, type: 'required' as const, normalizedAliases: [] },
      { id: '2', normalizedName: 'php', weight: 30, type: 'preferred' as const, normalizedAliases: [] },
      { id: '3', normalizedName: 'wordpress', weight: 10, type: 'excluded' as const, normalizedAliases: [] },
    ];
    const result = engine.calculate({ title: 'Laravel Developer', description: 'PHP WordPress' }, skills);
    expect(result.score).toBe(0);
    expect(result.isDisqualified).toBe(true);
    expect(result.excludedMatched).toHaveLength(1);
  });

  it('applies title weighting — title hit > description-only', () => {
    const skills = [
      { id: '1', normalizedName: 'react', weight: 50, type: 'preferred' as const, normalizedAliases: [] },
      { id: '2', normalizedName: 'node', weight: 50, type: 'preferred' as const, normalizedAliases: [] },
    ];
    const titleHit = engine.calculate({ title: 'React Developer', description: 'We use Node' }, skills);
    // React in title full 50, Node in desc 50*0.7=35 => (85/100)*100=85
    expect(titleHit.score).toBe(85);

    const descOnly = engine.calculate({ title: 'Frontend', description: 'React Node' }, skills);
    // Both desc only => 35+35=70
    expect(descOnly.score).toBe(70);
    expect(descOnly.score).toBeLessThan(titleHit.score);
  });

  it('matches via alias (PostgreSQL -> postgres)', () => {
    const skills = [
      { id: '1', normalizedName: 'postgresql', weight: 100, type: 'preferred' as const, normalizedAliases: ['postgres', 'psql'] },
    ];
    const viaAlias = engine.calculate({ title: 'Backend', description: 'We use postgres database' }, skills);
    expect(viaAlias.score).toBe(70); // desc factor
    const viaName = engine.calculate({ title: 'PostgreSQL Expert', description: 'something' }, skills);
    expect(viaName.score).toBe(100);
  });

  it('enforces word boundary — java must not match javascript', () => {
    const skills = [
      { id: '1', normalizedName: 'java', weight: 100, type: 'preferred' as const, normalizedAliases: [] },
    ];
    const falsePositive = engine.calculate({ title: 'Dev', description: 'javascript' }, skills);
    expect(falsePositive.score).toBe(0);
    const truePositive = engine.calculate({ title: 'Java Developer', description: '' }, skills);
    expect(truePositive.score).toBe(100);
  });

  it('handles HTML stripping and case-insensitivity', () => {
    const skills = [
      { id: '1', normalizedName: 'laravel', weight: 100, type: 'preferred' as const, normalizedAliases: [] },
    ];
    const result = engine.calculate({ title: '<p>LARAVEL</p>', description: '<div>Hello <script>alert(1)</script> laravel</div>' }, skills);
    expect(result.score).toBe(100);
  });

  it('normalizes 0-100 and handles no skills', () => {
    const resultEmpty = engine.calculate({ title: 'Anything', description: 'anything' }, []);
    expect(resultEmpty.score).toBe(0);
    expect(resultEmpty.isDisqualified).toBe(false);
  });

  it('weights do not need to sum to 100 — normalization handles this', () => {
    const skills = [
      { id: '1', normalizedName: 'a', weight: 10, type: 'preferred' as const, normalizedAliases: [] },
      { id: '2', normalizedName: 'b', weight: 10, type: 'preferred' as const, normalizedAliases: [] },
      { id: '3', normalizedName: 'c', weight: 10, type: 'preferred' as const, normalizedAliases: [] },
    ];
    // Only a in title => 10 /30 *100 =33
    const result = engine.calculate({ title: 'A developer', description: '' }, skills);
    expect(result.score).toBe(33);
  });

  it('exposed version is v1', () => {
    const result = engine.calculate({ title: 'x', description: 'y' }, []);
    expect(result.matchingVersion).toBe('v1');
  });
});
