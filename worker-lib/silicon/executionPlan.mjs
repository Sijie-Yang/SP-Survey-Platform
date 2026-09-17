import { classifyQuestion, collectQuestions, trialCountOf } from './answerValidate.mjs';

const TERMINAL_UNIT = new Set(['saved', 'skipped', 'failed']);

export function buildExecutionPlan(run = {}) {
  const questions = collectQuestions(run.survey_snapshot || {}, run.question_names);
  const personas = Array.isArray(run.persona_ids) ? run.persona_ids : [];
  const repeats = Math.max(1, Number(run.repeats || 1));
  const questionPlans = questions.map((question) => {
    const kind = classifyQuestion(question);
    return {
      name: question.name,
      title: question.title || question.name,
      type: question.type,
      trials: kind.supported ? trialCountOf(question) : 0,
      supported: kind.supported,
      reason: kind.reason || null,
    };
  });
  const units = [];
  for (const personaId of personas) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
      for (const question of questionPlans) {
        if (!question.supported) continue;
        for (let trial = 1; trial <= question.trials; trial += 1) {
          units.push({
            persona_id: personaId,
            repeat_index: repeat,
            question_name: question.name,
            trial_index: trial,
          });
        }
      }
    }
  }
  return {
    personas,
    repeats,
    questions: questionPlans,
    units,
    total: units.length,
  };
}

export function unitKey(unit = {}) {
  return [
    unit.persona_id || '',
    unit.repeat_index || 1,
    unit.question_name || '',
    unit.trial_index || 1,
  ].join(':');
}

export function countsFromUnits(units = []) {
  let processed = 0;
  let valid = 0;
  let failed = 0;
  let skipped = 0;
  let unknown = 0;
  let pending = 0;
  for (const unit of units) {
    if (unit.status === 'saved') {
      processed += 1;
      valid += 1;
    } else if (unit.status === 'failed') {
      processed += 1;
      failed += 1;
    } else if (unit.status === 'skipped') {
      processed += 1;
      skipped += 1;
    } else if (unit.status === 'unknown') {
      unknown += 1;
    } else {
      pending += 1;
    }
  }
  return {
    processed,
    valid,
    failed,
    skipped,
    unknown,
    pending,
    total: units.length,
  };
}

export function eventCountsFromUnits(units = []) {
  const counts = countsFromUnits(units);
  return {
    answer: counts.valid,
    skip: counts.skipped,
    error: counts.failed,
    processed: counts.processed,
    hydrated: true,
  };
}

export function isTerminalUnitStatus(status) {
  return TERMINAL_UNIT.has(status);
}

export { trialCountOf };
