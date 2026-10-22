"""Pull the results of a pairwise question and draw its TrueSkill ranking.

    pip install "spsurvey[plot]"
    python fetch_and_plot.py <project id> <question name> [out.png]

The numbers come from the platform's own summary table (the same one the
Results page and every export use); the script only draws them.
"""
import sys

import matplotlib.pyplot as plt

from spsurvey import Client


def main(project_id: str, question: str, out: str = "trueskill.png") -> None:
    sp = Client()
    scores = sp.image_scores(project_id, question, data_source="human", exclude_flagged=True)
    if scores.empty:
        sys.exit("No answers yet.")
    metric = "mu" if "mu" in scores.columns else "mean"
    spread = "sigma" if "sigma" in scores.columns else ("sd" if "sd" in scores.columns else None)
    scores = scores.sort_values(metric)

    fig, ax = plt.subplots(figsize=(7, 0.32 * len(scores) + 1.2))
    ax.errorbar(scores[metric], range(len(scores)), xerr=scores[spread] if spread else None, fmt="o", color="#0072B2", ecolor="#999999", capsize=2)
    ax.set_yticks(range(len(scores)))
    ax.set_yticklabels(scores["unit_label"])
    ax.set_xlabel("TrueSkill μ ± σ" if metric == "mu" else "Mean rating ± SD")
    ax.set_title(f"{question}: {len(scores)} images")
    ax.grid(axis="x", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=200)
    print(f"Saved {out}")
    print(scores[["unit_label", metric] + ([spread] if spread else [])].to_string(index=False))

    # The full, citable package (README, LICENSE, CITATION.cff, datapackage.json, anonymised data):
    # sp.download_dataset_package(project_id, "./release")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: fetch_and_plot.py <project id> <question name> [out.png]")
    main(sys.argv[1], sys.argv[2], *(sys.argv[3:4]))
