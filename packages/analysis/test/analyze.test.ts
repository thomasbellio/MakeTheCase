import { describe, expect, it } from 'vitest';
import {
  toView,
  type AnalysisFinding,
  type ArgumentGraphDraft,
  type LocalId,
} from '@make-your-case/domain';
import { analyzeArgumentGraph } from '../src/analyze/analyze-argument-graph.ts';
import {
  fixture01Graph,
  fixture02Graph,
  fixture04Graph,
  fixture05Graph,
  fixture06Graph,
  fixture07Graph,
  fixture08Graph,
  fixture14Graph,
  unconnectedBackgroundGraph,
} from './fixtures/index.ts';

/** Findings of one kind, as `[claimOrInferenceId, severity]` pairs. */
function of(
  findings: readonly AnalysisFinding<LocalId>[],
  kind: string,
): { id: string; severity: string }[] {
  return findings
    .filter((f) => f.kind === kind)
    .map((f) => {
      const first = f.targets[0];
      return {
        id: first === undefined ? '' : 'claim_id' in first ? first.claim_id : first.inference_id,
        severity: f.severity,
      };
    });
}

const analyze = (g: ArgumentGraphDraft): readonly AnalysisFinding<LocalId>[] =>
  analyzeArgumentGraph(toView(g));

const kinds = (findings: readonly AnalysisFinding<LocalId>[]): Set<string> =>
  new Set(findings.map((f) => f.kind));

describe('fixture 01 — everything stated and cited', () => {
  const findings = analyze(fixture01Graph);

  it('reports only load-bearing claims, at info', () => {
    expect([...kinds(findings)]).toEqual(['load_bearing']);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });

  it('flags every premise, since there is only one route', () => {
    expect(of(findings, 'load_bearing').map((f) => f.id)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
    ]);
  });

  it('produces no finding for the valid deductive step', () => {
    // There is no `valid_step` kind: absence is how "checked and valid" is encoded.
    expect(kinds(findings).has('invalid_step')).toBe(false);
    expect(kinds(findings).has('unchecked_step')).toBe(false);
  });
});

describe('fixture 02 — three alternative routes', () => {
  const findings = analyze(fixture02Graph);

  it('flags only the claim every route shares', () => {
    const loadBearing = of(findings, 'load_bearing').map((f) => f.id);
    // c1 is the filing date, used by all three routes; c7 is the intermediate
    // conclusion the thesis rests on.
    expect(loadBearing).toContain('c1');
    // Claims used by one route only survive the loss of their route.
    expect(loadBearing).not.toContain('c4'); // the holiday
    expect(loadBearing).not.toContain('c5'); // Rule 6
    expect(loadBearing).not.toContain('c6'); // the Chair's extension
  });

  it('finds no defects', () => {
    for (const kind of ['implicit_premise', 'circularity', 'invalid_step', 'unsupported_claim']) {
      expect(kinds(findings).has(kind)).toBe(false);
    }
  });

  it('stays at info severity', () => {
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });
});

describe('fixture 04 — the opponent is answered, not graded', () => {
  const findings = analyze(fixture04Graph);

  it('gives the opponent no part in supporting the thesis', () => {
    const loadBearing = of(findings, 'load_bearing').map((f) => f.id);
    expect(loadBearing).toEqual(['c1', 'c2']);
    expect(loadBearing.some((id) => id.startsWith('o'))).toBe(false);
  });

  it("does not report the opponent's invalid step", () => {
    // The insurer's step from "water accumulated in the basement" to "the loss
    // was flooding" is the target of the author's undercut. Reporting it would
    // mean grading a reconstruction of someone else's argument.
    expect(kinds(findings).has('invalid_step')).toBe(false);
  });
});

describe('fixture 05 — the canonical implicit premise', () => {
  const findings = analyze(fixture05Graph);

  it('reports the unstated premise as critical, because the argument needs it', () => {
    expect(of(findings, 'implicit_premise')).toEqual([{ id: 'c4', severity: 'critical' }]);
  });

  it('flags the rule, the fact and the inferred premise as load-bearing', () => {
    expect(of(findings, 'load_bearing').map((f) => f.id)).toEqual(['c1', 'c2', 'c4']);
  });

  it('does not report the step as invalid — the premise completes it', () => {
    expect(kinds(findings).has('invalid_step')).toBe(false);
    expect(kinds(findings).has('unsupported_claim')).toBe(false);
  });
});

describe('fixture 06 — circular support', () => {
  const findings = analyze(fixture06Graph);
  const circularity = findings.filter((f) => f.kind === 'circularity');

  it('reports one cycle, as critical', () => {
    expect(circularity).toHaveLength(1);
    expect(circularity[0]?.severity).toBe('critical');
  });

  it('names both claims in the loop, alternating with the steps', () => {
    const targets = circularity[0]?.targets ?? [];
    const claims = targets.flatMap((t) => ('claim_id' in t ? [t.claim_id] : []));
    expect(claims).toContain('c3'); // the log is reliable
    expect(claims).toContain('c5'); // the summaries are accurate
    expect(targets.map((t) => t.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it('still identifies what the argument leans on inside the loop', () => {
    // Without seeding the cycle, nothing grounds the thesis and load-bearing
    // would be vacuously true of every claim.
    const loadBearing = of(findings, 'load_bearing').map((f) => f.id);
    expect(loadBearing).toContain('c3');
    expect(loadBearing).not.toContain('c5');
  });

  it('does not report an invalid step', () => {
    expect(kinds(findings).has('invalid_step')).toBe(false);
  });
});

describe('fixture 07 — affirming the consequent', () => {
  const findings = analyze(fixture07Graph);
  const invalid = findings.filter((f) => f.kind === 'invalid_step');

  it('reports the step the text actually makes, as critical', () => {
    expect(invalid).toHaveLength(1);
    expect(invalid[0]?.severity).toBe('critical');
    expect(invalid[0]?.targets[0]).toEqual({ target: 'inference', inference_id: 'i1', ordinal: 0 });
  });

  it('explains the counterexample in terms of the claims', () => {
    const explanation = invalid[0]?.explanation ?? '';
    expect(explanation).toContain('does not follow from its premises as the text states them');
    expect(explanation).toContain('code-compliant');
    expect(explanation).toContain('does not hold');
  });

  it('leaves the valid second step unflagged', () => {
    expect(invalid.map((f) => f.targets[0])).not.toContainEqual({
      target: 'inference',
      inference_id: 'i2',
      ordinal: 0,
    });
    expect(kinds(findings).has('circularity')).toBe(false);
  });
});

describe('fixture 08 — one bald assertion among cited facts', () => {
  const findings = analyze(fixture08Graph);

  it('reports exactly the uncited claim', () => {
    expect(of(findings, 'unsupported_claim')).toEqual([{ id: 'c4', severity: 'warning' }]);
  });

  it('also reports it as load-bearing, since it carries an element alone', () => {
    expect(of(findings, 'load_bearing').map((f) => f.id)).toContain('c4');
  });

  it('explains that the reader is being asked to accept it', () => {
    const explanation = findings.find((f) => f.kind === 'unsupported_claim')?.explanation ?? '';
    expect(explanation).toContain('without a citation');
    expect(explanation).toContain('asked to accept it as given');
  });
});

describe('fixture 14 — the long brief, reduced', () => {
  const findings = analyze(fixture14Graph);

  it('reports the waiver premise as a warning, because another route survives', () => {
    expect(of(findings, 'implicit_premise')).toEqual([{ id: 'c10', severity: 'warning' }]);
  });

  it('reports exactly one unsupported claim', () => {
    expect(of(findings, 'unsupported_claim')).toEqual([{ id: 'c13', severity: 'warning' }]);
  });

  it('leaves claims used by only one route unflagged', () => {
    const loadBearing = of(findings, 'load_bearing').map((f) => f.id);
    expect(loadBearing).not.toContain('c9'); // route A.2 only
    expect(loadBearing).not.toContain('c10'); // route A.2 only
    expect(loadBearing).not.toContain('c7'); // route A.1 only
  });

  it('reports the background claim as unconnected, at info', () => {
    expect(of(findings, 'unconnected_claim')).toEqual([{ id: 'c21', severity: 'info' }]);
  });

  it('finds no circularity and no invalid step', () => {
    expect(kinds(findings).has('circularity')).toBe(false);
    expect(kinds(findings).has('invalid_step')).toBe(false);
  });
});

describe('unconnected background', () => {
  it('reports the orphan claim without flagging anything else', () => {
    const findings = analyze(unconnectedBackgroundGraph);
    expect(of(findings, 'unconnected_claim')).toEqual([{ id: 'c3', severity: 'info' }]);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });
});

describe('determinism', () => {
  it('returns identical findings for identical input', () => {
    expect(analyze(fixture14Graph)).toEqual(analyze(fixture14Graph));
  });
});
