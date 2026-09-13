# Optional no-preference answer

The question's response settings now expose `allowTie` (default false) and optional `tieLabel`. This is supported for Image Choice, Media Choice, and the built-in Forced-Choice A/B task. The button appears below the media only when there are two alternatives and selection is exclusive. An empty label follows the participant survey language: “About the same” / “两者差不多”.

Native pickers store the reserved string `__sp_no_preference__`. The built-in A/B task stores `choice: "tie"`, `chosenIndex: -1`, both image identities, and no winning URL. Choosing an alternative replaces the tie and vice versa. Native multi-trial choices treat a tie as answered and retain the existing auto-advance behavior. Imagepicker uses its exclusive None-value support to survive SurveyJS answer cleanup, with a separate labeled button and readable review text.

Question-long CSV exports include an `outcome` column: `A`, `B`, or `tie` for binary answers. A/B refer to the first/second entry in the recorded media list, not a fixed image across trials. Ties export `value: tie`; raw JSON retains the original representation and displayed media. Summary exports add `outcome_count` and `outcome_rate`; their denominator includes valid ties. All-tie data produces descriptive counts without an invented TrueSkill ranking.

**Analysis scope:** existing TrueSkill ranking and derived perception scores use decisive outcomes only. Ties are excluded from ranking updates, reported separately in the result panel, and documented in the export dictionary and methods text. This change does not introduce a statistical model for draws. It also does not combine “no preference” with “unable to judge”.

Recorded survey contracts retain the switch and label. Preflight warns when a tie-enabled question is assigned other than two alternatives or allows multiple selection. No SQL migration or new backend endpoint is needed.

Regression coverage includes native SurveyJS required-answer validation and cleanup, serialization, multi-trial completion, selection changes, media-picker scope, built-in A/B answers, response enrichment, long and summary exports, and all-tie data. Backend result tests exercise the shared export path.
