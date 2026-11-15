/**
 * Deterministic three-valued verdict derivation.
 * Semantics are ported from the No Presumed Pass reference contract.
 * Evidence is supplied as normalized, already-authenticated records; this
 * module does not authenticate sources or persist evidence.
 */

export const EvidenceOutcome = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL' });
export const VerdictStatus = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  INDETERMINATE: 'INDETERMINATE',
});

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new TypeError(`${field} must be a non-empty string without surrounding whitespace`);
  }
}

function validateEvidence(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('evidence must contain only record objects');
  }
  nonEmptyString(record.evidenceId, 'evidenceId');
  nonEmptyString(record.criterion, 'criterion');
  nonEmptyString(record.source, 'source');
  if (!Object.values(EvidenceOutcome).includes(record.outcome)) {
    throw new TypeError('outcome must be PASS or FAIL');
  }
  if (typeof record.observedAt !== 'string' || !record.observedAt.trim() ||
      !Number.isFinite(Date.parse(record.observedAt)) ||
      !/(Z|[+-]\d{2}:?\d{2})$/i.test(record.observedAt)) {
    throw new TypeError('observedAt must be a valid timezone-aware timestamp');
  }
}

export function deriveVerdict(requiredCriteria, evidence) {
  if (!Array.isArray(requiredCriteria)) {
    throw new TypeError('requiredCriteria must be an array of criterion strings');
  }
  const criteria = [...requiredCriteria];
  for (const criterion of criteria) nonEmptyString(criterion, 'required criterion');
  if (new Set(criteria).size !== criteria.length) {
    throw new TypeError('required criteria must be unique');
  }
  if (!Array.isArray(evidence)) {
    throw new TypeError('evidence must be an array');
  }

  const seenIds = new Set();
  for (const record of evidence) {
    validateEvidence(record);
    if (seenIds.has(record.evidenceId)) {
      throw new TypeError(`duplicate evidenceId: ${record.evidenceId}`);
    }
    seenIds.add(record.evidenceId);
  }

  const unmatchedCriteria = [...new Set(
    evidence.map((record) => record.criterion).filter((criterion) => !criteria.includes(criterion)),
  )].sort();

  if (criteria.length === 0) {
    return {
      status: VerdictStatus.INDETERMINATE,
      requiredCriteria: [],
      missingCriteria: [],
      failedCriteria: [],
      unmatchedCriteria,
      evidenceIds: [],
      reason: 'no_required_criteria_configured',
    };
  }

  const relevant = evidence.filter((record) => criteria.includes(record.criterion));
  const observed = new Set(relevant.map((record) => record.criterion));
  const missingCriteria = criteria.filter((criterion) => !observed.has(criterion));
  const failedCriteria = criteria.filter((criterion) => relevant.some(
    (record) => record.criterion === criterion && record.outcome === EvidenceOutcome.FAIL,
  ));

  let status;
  let reason;
  if (failedCriteria.length) {
    status = VerdictStatus.FAIL;
    reason = 'one_or_more_required_criteria_failed';
  } else if (missingCriteria.length) {
    status = VerdictStatus.INDETERMINATE;
    reason = 'required_evidence_missing';
  } else {
    status = VerdictStatus.PASS;
    reason = 'all_required_criteria_have_passing_evidence';
  }

  return {
    status,
    requiredCriteria: criteria,
    missingCriteria,
    failedCriteria,
    unmatchedCriteria,
    evidenceIds: relevant.map((record) => record.evidenceId).sort(),
    reason,
  };
}
