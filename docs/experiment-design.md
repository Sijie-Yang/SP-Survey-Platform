# Experiment design

An experiment design decides, before anyone starts, which media each participant sees. Every
image (or pair) is then shown about equally often, the assignment can be reproduced from a seed,
and Results analyses the data the way it was collected.

Open it in the Builder: **Survey settings → Experiment design**.

## The three goals

| Goal | Use it for | What is guaranteed | Main analysis |
| --- | --- | --- | --- |
| Rate many images | A large library; each person rates part of it | Each image is seen floor or ceil of the average number of times | Per-image mean with a 95% t interval |
| Pairwise comparison from a library | Place Pulse–style rankings | Each image appears equally often; no image twice in one person's set | Bradley–Terry scores with participant-bootstrap 95% intervals |
| Compare fixed pairs | Before/after, A/B versions, several questions on the same pair | Each pair is seen equally often; left/right alternates so each side gets exactly half | Share choosing B per pair (Wilson 95%); B − A rating difference per person |

Groups of people are a layer on top of any goal: add conditions in **Basic info → Experimental
conditions**. Conditions stay balanced, and Results compares them (Welch difference, 95% interval,
Cohen's d) on each participant's own mean.

Two optional extras work with every goal:

- **Anchors** are shown to everyone (calibrate raters, compare with models).
- **Repeats** show a few of a person's trials again at the end (test–retest agreement).

## How versions are built

The stimuli (not counting anchors) form a stream that walks through every unit once per pass, each
pass in its own seeded order. Version *v* takes the next slice of the stream, so after any number of
completed versions every unit has been shown floor or ceil of the average count. A version that
spans two passes never repeats a unit. For fixed pairs, which image is on the left alternates
between passes, so each side gets exactly half of a pair's presentations.

The number of versions is what the design needs: `ceil(units × times each / per person)`, or the
number of people you expect. The same design and seed always give the same versions
(`src/lib/experimentDesign.js`, tested in `experimentDesign.test.js`).

## Handing out versions

Each new participant gets the version completed least often, counting people who started in the
last two hours, under a database lock so two people opening the link at once get different
versions. This needs `supabase/experiment_design.sql` (run once). Without it the survey still works:
the browser picks a random version, and Results says how many participants were assigned this way.

Each response records `survey_metadata.experiment_design` (`id`, `version`, `claim`) and every trial
records `design_id`, `design_version`, `design_unit`, `design_role` (`main`, `anchor`, `repeat`)
and, for pairs, `design_order` (`ab` or `ba`) and `design_side`.

## Questions that follow a design

Image or media choice, rating, yes/no, slider, matrix and point-allocation questions can follow a
design; their own media settings are replaced. All questions that follow the design show the same
units in the same order. A two-image choice question shows each pair once; a one-image question
shows each image of a pair as its own trial. Questions are shown one after another (question 1 for
all of a person's pairs, then question 2), not interleaved per pair.

Changing the design after collection starts gives it a new id. Earlier responses are kept and
counted as "outside this design"; new participants follow the new design.

## Results

The Results overview opens with the design card:

1. **Did the design run as planned?** Participants per version, planned versus answered exposures,
   how versions were handed out, left/right balance.
2. **Results by question**, each opening with one sentence on why that analysis fits the design,
   then the main table and checks: position bias, repeats, condition contrasts, anchors, and (for
   fixed pairs with a choice and a rating question) whether people chose the image they rated
   higher.
3. A **Methods paragraph** to copy.

The full export adds `experiment_design/`: `design.json`, `design_table.csv` (every version's
trials), `execution_per_unit.csv`, each question's main result, and `methods.txt`.

Everything here is deterministic code (`src/lib/designAnalysis.js`); no model is involved.

## Sampling without a design

Questions that do not follow a design still draw their own media. Shuffles are uniform
(Fisher–Yates). **Balanced** sampling prefers the least-shown files, using exposure counts from the
stored responses (`get_pair_stats` in `supabase/experiment_design.sql`); **Adaptive** would use TrueSkill
bands, but ratings are not sent to participants' browsers, so for now it balances exposure too. Set and category questions can shuffle positions
("Shuffle positions each time") so the same file does not always take the same side. Results shows
how often each file was actually shown.
