/**
 * The agreement metrics SP-Bench's human-agreement track scores with. Shared
 * with the Results page so a score on the leaderboard and the number a
 * researcher sees in "Silicon vs human" come from the same code.
 */
export { kendallTauB, spearman, pearson, jsDivergence, averageRanks } from '../../src/lib/siliconAgreement.js';
export {
  scoreTask,
  scoreSubmission,
  leaderboard,
  validateSubmission,
  validateTask,
} from '../../src/lib/benchHumanTrack.js';
