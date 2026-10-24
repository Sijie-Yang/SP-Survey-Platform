# Experiment design

An experiment design decides, before anyone starts, which media each participant sees. Every
image (or pair) is then shown about equally often, the assignment can be reproduced from a seed,
and Results analyses the data the way it was collected.

Open it in the Builder: **Survey settings → Experiment design**.

## The three goals

| Goal | Use it for | What is guaranteed | Main analysis |
| --- | --- | --- | --- |
| Rate many images | A large library; each person rates part of it | Each image is seen floor or ceil of the average number of times | Per-image mean with a 95% t interval |
| Choose from a library | Place Pulse–style rankings; pick one of 2–12, or tick any that apply | Each image appears equally often; no image twice in one person's set | Pick one: Bradley–Terry / Luce scores with participant-bootstrap 95% intervals. Pick any: share of times each image was ticked (Wilson 95%) |
| Compare fixed sets | Before/after, A/B/C versions, several questions on the same set | Each set is seen equally often; the display positions rotate so every slot takes every position exactly equally | Two slots: share choosing B per set (Wilson 95%) and B − A rating difference per person. More slots: share choosing each slot per set |

Plain random draws (no design) still work and are enough for a quick test or a small library. A
design adds what a paper needs: every image or pair seen the same number of times, the same
assignment from the same seed, a check that it ran as planned, and a Methods paragraph.

Groups of people are a layer on top of any goal: add conditions in **Basic info → Experimental
conditions**. Conditions stay balanced, and Results compares them (Welch difference, 95% interval,
Cohen's d) on each participant's own mean.

Three optional extras work with every goal:

- **Anchors** are shown to everyone (calibrate raters, compare with models).
- **Repeats** show a few of a person's trials again at the end (test–retest agreement).
- **Catch trials** are trials with a known right answer (a black image, an obvious pair). Results
  scores them per participant and lists who failed.

## Sets with more than two images

A set is a folder with 2–12 images (or a row of a pasted table whose header names the slots, for
example `scene, day, night, rain`). Slot names are shared by all sets. Two switches decide how a set
is shown:

- **Images per trial — all** shows the whole set together (a choice question) or each slot as its
  own trial (a rating question). **One** shows each person only one image of every set, with the
  slot rotating between people (a Latin square), for between-subjects comparisons.
- **Positions — alternate** rotates the slots through the positions pass by pass so every slot takes
  every position equally often, and neighbouring trials of one person differ too; **random**
  shuffles with the seed; **fixed** keeps the header order (only when the order is part of the
  stimulus).

When more than one question follows a design, each question gets a **view**: which slots it shows
(`all`, `each` one as its own trial, or named slots such as `day, night`) and which trials (`all`,
or the first or second half of a person's sets, for two questions that must not share sets).

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
records `design_id`, `design_version`, `design_unit`, `design_role` (`main`, `anchor`, `repeat`,
`catch`), `design_media` (the design's keys for what was shown) and, for sets, `design_order` (slot
names in display order, e.g. `AB`), `design_slots`, `design_side` (the slot of a single image) and
`design_expected` for catch trials.

## Where it shows up in the Builder

The settings bar shows one line under the buttons: whether a design is on (goal, units, versions, how
many questions follow it) with a link to change it. A question that follows the design carries a
"Follows the experiment design" chip in the page editor; in the question editor its own sampling
settings are replaced by a note, and the per-question preview shows one version of the design
(reset to draw another). The survey preview says which version it is showing. The public docs page
is `/docs/experiment-design`.

## Questions that follow a design

Image or media choice (pick one or pick any), rating, yes/no, slider, matrix and point-allocation
questions can follow a design; their own media settings are replaced. Slider, matrix and
point-allocation answers (several numbers per image) are averaged for the design analysis. If a
file is deleted from the library after publishing, the trials that need it are dropped whole rather
than shown with an image missing. All questions that follow the
design show the same units in the same order unless their view says otherwise. A choice question
shows a set or a group of *k* library images together; a one-image question shows each image as its
own trial. Questions are shown one after another (question 1 for all of a person's sets, then
question 2), not interleaved per set.

Changing the design after collection starts gives it a new id. Earlier responses are kept and
counted as "outside this design"; new participants follow the new design.

## Results

The Results overview opens with the design card:

1. **Did the design run as planned?** Participants per version, planned versus answered exposures,
   how versions were handed out, position balance, catch-trial scores.
2. **Results by question**, each opening with one sentence on why that analysis fits the design,
   then the main table and checks: position bias (per position when *k* > 2; for library choices
   the expected share comes from the fitted model, so a strong image that sat on one side is not
   reported as a position effect), repeats, condition contrasts (for library choices: one
   Bradley–Terry fit per group and the rank correlation between groups), anchors, and (for two-slot
   sets with a choice and a rating question) whether people chose the image they rated higher.
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
