import { useEffect, useState } from 'react';
import type { ScoringConfig } from '@ff/shared';
import type { RuleSet } from '@ff/scoring';
import { compileRules } from '@ff/scoring';
import { api } from './api';

let cached: RuleSet | null = null;

/** The active scoring rules from the server (data, not code), compiled with the same engine the server uses. */
export function useRules() {
  const [rules, setRules] = useState<RuleSet | null>(cached);
  useEffect(() => {
    if (cached) return;
    void api<{ scoring: ScoringConfig }>('/config/active').then((c) => {
      cached = compileRules(c.scoring);
      setRules(cached);
    });
  }, []);
  return rules;
}
