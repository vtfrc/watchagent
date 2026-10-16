import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, evaluationSchema, parseEvaluation, shouldEmit, validateEvidence, applyConditionGuards } from '../src/evaluation';
import cases from '../eval/cases.json';

const valid = { matched: true, confidence: 0.95, event_type: 'price_changed' as const,
  summary: 'Starter is now $40.', reason: 'Confirmed price decrease.', evidence: { before: '$90', after: '$40' } };
it('event taxonomy is stable and unknown model labels are rejected', () => {
  expect(EVENT_TYPES).toEqual(['plan_launched', 'price_changed', 'product_available', 'semantic_change']);
  expect(() => parseEvaluation({ ...valid, event_type: 'new_plan_under_threshold' })).toThrow();
});
it('matched events need exact source evidence, not just high confidence', () => {
  expect(validateEvidence(valid, 'Starter: $90/month', 'Starter: $40/month')).toEqual(valid);
  expect(() => validateEvidence(valid, 'Starter: $90/month', 'Starter: $85/month')).toThrow();
  expect(() => validateEvidence({ ...valid, evidence: { before: null, after: '$40' } }, '$90', '$40')).toThrow();
  expect(() => validateEvidence({ ...valid, evidence: { before: '$90', after: null } }, '$90', '$40')).toThrow();
  expect(() => parseEvaluation({ ...valid, evidence: undefined })).toThrow();
});
it('new plans can cite only new-page evidence; absence is not invented evidence', () => {
  const launch = { ...valid, event_type: 'plan_launched' as const, evidence: { before: null, after: 'New Lite: $40' } };
  expect(validateEvidence(launch, 'Pro: $90', 'Pro: $90. New Lite: $40')).toEqual(launch);
});
it('citation validation normalizes whitespace but does not manufacture facts', () => {
  expect(validateEvidence({ ...valid, evidence: { before: 'Starter: $90', after: 'Starter: $40' } }, 'Starter:\n$90', 'Starter:  $40')).toBeTruthy();
  expect(() => validateEvidence({ ...valid, evidence: { before: '$90', after: '$39' } }, '$90', '$40')).toThrow();
});
it('low confidence and negative classifications do not emit events', () => {
  expect(shouldEmit(valid)).toBe(true);
  expect(shouldEmit({ ...valid, confidence: 0.79 })).toBe(false);
  expect(shouldEmit({ ...valid, matched: false })).toBe(false);
});
it('explicit launch and strict dollar thresholds have conservative deterministic guards', () => {
  expect(applyConditionGuards(valid, 'Notify me if they launch a plan under $50 per month.').matched).toBe(false);
  expect(applyConditionGuards({ ...valid, event_type: 'plan_launched' }, 'Notify me if they launch a plan under $50 per month.').matched).toBe(true);
  const atBoundary = { ...valid, evidence: { before: '$90', after: 'Starter: $50/month.' } };
  expect(applyConditionGuards(atBoundary, 'Notify me if Starter drops below $50 per month.').matched).toBe(false);
  expect(applyConditionGuards(valid, 'Notify me if Starter drops below $50 per month.').matched).toBe(true);
  expect(applyConditionGuards(valid, 'Notify me if they launch a plan or change an existing price.')).toEqual(valid);
  expect(applyConditionGuards(atBoundary, 'Notify me if the price drops by less than $60.')).toEqual(atBoundary);
});
describe('labelled evaluation corpus (not a classifier accuracy test)', () => {
  it('contains 40 unique bounded cases and positive/negative labels', () => {
    expect(cases).toHaveLength(40);
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(cases.some(c => c.expected.matched)).toBe(true);
    expect(cases.some(c => !c.expected.matched)).toBe(true);
    for (const c of cases) {
      expect(c.old_page.length).toBeLessThanOrEqual(12000);
      expect(c.new_page.length).toBeLessThanOrEqual(12000);
      if (c.expected.matched) expect(evaluationSchema.shape.event_type.safeParse(c.expected.event_type).success).toBe(true);
    }
    expect(cases.find(c => c.id === 'plan-discount-not-launch')?.expected.matched).toBe(false);
  });
});
