"""A folder of street photos → pairwise-comparison survey → published link.

    pip install spsurvey
    spsurvey login
    python pairwise_from_folder.py ./my_streets "Which street looks safer?"

Only upload photos you have the right to show participants (your own, or
licensed). Never upload AI-generated placeholders.
"""
import sys

from spsurvey import Client, pairwise_survey


def main(folder: str, question: str, title: str = "Street perception") -> None:
    sp = Client()
    project = sp.create_project(title, survey_config=pairwise_survey(title, question, trials=12, consent=True, demographics=True))
    print(f"Created project {project.id}")

    uploaded = sp.upload_images(project.id, folder, on_progress=lambda i, n, p: print(f"  [{i}/{n}] {p.name}"))
    print(f"Uploaded {len(uploaded)} images into the project media library")

    release = sp.publish(project.id, summary="Created from pairwise_from_folder.py")
    print(f"Published v{release.version}. Share this link with participants:\n  {release.live_url}")
    print("Open https://sp-survey.org/admin to preview on a phone (View on phone) or to start a silicon-sample pretest.")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("usage: pairwise_from_folder.py <image folder> <question> [title]")
    main(sys.argv[1], sys.argv[2], *(sys.argv[3:4]))
