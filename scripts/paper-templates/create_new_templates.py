"""Create the 14 Table A1 paper templates that had no template yet.

Run from the repository root: python3 scripts/paper-templates/create_new_templates.py
Writes public/project_templates/<id>.json and appends the ids to index.json.
No media is bundled; researchers upload their own images or use the named Hugging Face dataset.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'public' / 'project_templates'
CREATED_AT = '2026-10-02T00:00:00+00:00'

IMAGE_DEFAULTS = {
    'imageFit': 'cover',
    'imageSource': 'huggingface',
    'imageSelectionMode': 'huggingface_random',
    'randomImageSelection': True,
}


def image_q(name, qtype, title, **extra):
    q = {'name': name, 'type': qtype, 'title': title, **IMAGE_DEFAULTS, 'isRequired': True}
    q.update(extra)
    return q


def picker(name, title, trials, tie=None, **extra):
    q = image_q(name, 'imagepicker', title, imageCount=2, trialCount=trials, **extra)
    if tie:
        q['allowTie'] = True
        q['tieLabel'] = tie
    return q


def choices(*items):
    return [{'value': v, 'text': t} for v, t in items]


def radio(name, title, opts, required=False, **extra):
    return {'name': name, 'type': 'radiogroup', 'title': title, 'choices': choices(*opts), 'isRequired': required, **extra}


def text(name, title, required=False, **extra):
    return {'name': name, 'type': 'text', 'title': title, 'isRequired': required, **extra}


def page(name, title, *elements, **extra):
    p = {'name': name, 'elements': list(elements), **extra}
    if title:
        p['title'] = title
    return p


def attention_check(name='attention_check'):
    return radio(name, 'To show that you are reading carefully, please select "Agree" for this question.',
                 [('strongly_disagree', 'Strongly disagree'), ('disagree', 'Disagree'), ('neutral', 'Neutral'),
                  ('agree', 'Agree'), ('strongly_agree', 'Strongly agree')],
                 required=True, isAttentionCheck=True, expectedAnswer='agree')


GENDER = [('female', 'Female'), ('male', 'Male'), ('other', 'Other'), ('prefer_not', 'Prefer not to say')]
AGE_GROUPS = [('18_24', '18–24'), ('25_34', '25–34'), ('35_44', '35–44'), ('45_54', '45–54'), ('55_64', '55–64'), ('65_plus', '65+')]
BACKGROUND = [('planning', 'Urban planning / urban design'), ('architecture', 'Architecture'),
              ('landscape', 'Landscape architecture'), ('geography', 'Geography / GIS'), ('other', 'Other')]

EWING_DEFINITIONS = {
    'imageability': 'Imageability is the quality of a place that makes it distinct, recognizable and memorable. A place has high imageability when specific physical elements and their arrangement capture attention, evoke feelings and create a lasting impression.',
    'enclosure': 'Enclosure refers to the degree to which streets and other public spaces are visually defined by buildings, walls, trees and other vertical elements. Spaces where the height of vertical elements is proportionally related to the width of the space between them have a room-like quality.',
    'human_scale': 'Human scale refers to a size, texture, and articulation of physical elements that match the size and proportions of humans and, equally important, correspond to the speed at which humans walk. Building details, pavement texture, street trees, and street furniture are all physical elements contributing to human scale.',
    'transparency': 'Transparency refers to the degree to which people can see or perceive what lies beyond the edge of a street and, more specifically, the degree to which people can see or perceive human activity beyond the edge of a street. Physical elements that influence transparency include walls, windows, doors, fences, landscaping and openings into mid-block spaces.',
    'complexity': 'Complexity refers to the visual richness of a place. The complexity of a place depends on the variety of the physical environment, specifically the numbers and types of buildings, architectural diversity and ornamentation, landscape elements, street furniture, signage and human activity.',
}


def template(tid, name, author, year, doi, summary, differences, title, survey_description, pages,
             recommendation, folders=(), hf=None, **config_extra):
    description = f'Rebuilt from the published description of {author} ({year}). {summary} Differences from the original study: ' + \
        ' '.join(f'({i}) {d}' for i, d in enumerate(differences, 1))
    config = {
        'title': title,
        'description': survey_description,
        'logoPosition': 'right',
        'autoGrowComment': True,
        'progressBarType': 'questions',
        'showProgressBar': 'aboveheader',
        'showQuestionNumbers': 'off',
        **config_extra,
        'spAnalysisRecommendation': recommendation,
        'pages': pages,
    }
    return {
        'id': tid,
        'name': name,
        'description': description,
        'author': author,
        'year': str(year),
        'category': 'Academic Research',
        'tags': ['official', 'paper'],
        'isPinned': False,
        'isApproved': True,
        'showOnLanding': True,
        'thumbnailUrl': None,
        'website': f'https://doi.org/{doi}',
        'huggingfaceDataset': hf,
        'createdAt': CREATED_AT,
        'imageDatasetConfig': {'mediaFolders': list(folders), 'mediaFolderTags': {}},
        'preloadedImages': [],
        'preloadedSource': None,
        'preloadedAt': None,
        'config': config,
    }


def salesses():
    qs = [('safer', 'Which place looks safer?'), ('upper_class', 'Which place looks more upper-class?'),
          ('unique', 'Which place looks more unique?')]
    names = [n for n, _ in qs]
    return template(
        '2013-salesses-collaborative', 'Place Pulse 1.0', 'Salesses, Schechtner & Hidalgo', 2013,
        '10.1371/journal.pone.0068400',
        'Pairwise comparisons of street views from New York, Boston, Linz and Salzburg on safety, class and uniqueness, scored with Q-scores.',
        ['The original website allowed unlimited votes; this template asks 10 pairs per question (survey rounds with "continue voting" are not available).',
         'Researchers supply their own street-view images (street-view terms do not allow redistribution).'],
        'Place Pulse 1.0', 'For each pair of street views, click the place that better matches the question. Choose "Equal" if you cannot decide.',
        [page(f'page_{n}', None, picker(n, t, 10, tie='Equal', pairingMode='balanced')) for n, t in qs],
        {'citation': 'Salesses et al. 2013', 'items': [
            {'questions': names, 'method': 'qscore_pairwise', 'scale': '0-10', 'minPerImage': 4},
            {'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'draw', 'scale': '0-10'},
        ]},
        folders=['New_York', 'Boston', 'Linz', 'Salzburg'],
    )


def quercia():
    qs = [('beautiful', 'Which place is more beautiful?', 4), ('quiet', 'Which place is more quiet?', 3),
          ('happy', 'Which place is more happy?', 3)]
    names = [n for n, _, _ in qs]
    return template(
        '2014-quercia-aesthetic', 'UrbanGems', "Quercia, O'Hare & Cramer", 2014, '10.1145/2531602.2531613',
        'Pairwise comparisons of London street scenes on beauty, quiet and happiness, analysed as the share of times each scene was chosen.',
        ['The original site let participants continue after the first round of 10 pairs; this template asks one round (4 + 3 + 3 pairs).',
         'The short questionnaire wording is not in the paper.',
         'No sample images are bundled; researchers supply GSV and Geograph images.'],
        'UrbanGems', 'Click the place that better matches each question.',
        [page(f'page_{n}', None, picker(n, t, k)) for n, t, k in qs] + [
            page('page_about_you', 'About you',
                 radio('age_group', 'What is your age group? (wording not in paper)', AGE_GROUPS),
                 radio('gender', 'What is your gender? (wording not in paper)', GENDER),
                 radio('live_in_london', 'Do you live in London?', [('yes', 'Yes'), ('no', 'No')])),
        ],
        {'citation': 'Quercia et al. 2014', 'items': [
            {'questions': names, 'method': 'choice_share'},
            {'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'scale': '0-10'},
        ]},
        folders=['GSV', 'Geograph'],
    )


LIU_RUBRIC = [
    '1 – Built with low-quality materials, in many cases bare cement and colour plate; low-level precision, sometimes unfinished; seriously deteriorated with a lot of cracks, breakage, corrosion, dirt and stain or messy add-ons.',
    '2 – Built with low quality, not very fine-textured materials; low-level industrial precision or craftsmanship; a lot of cracks, breakage, corrosion, dirt and stain or messy add-ons.',
    '3 – Built with lower quality, not very fine-textured materials; no high level of industrial precision or craftsmanship; may have a few obvious cracks, breakage, corrosion, dirt and stain or messy add-ons but generally a neat and clean look.',
    '4 – Built with high quality, fine-textured materials; high industrial precision or fine craftsmanship (components and material pieces well aligned, small gaps); well maintained without obvious cracks, breakage, corrosion, dirt and stain or messy add-ons.',
]
LIU_FACADE_TITLE = 'Rate the construction and maintenance quality of the building facade.'
LIU_WALL_TITLE = 'Is the street wall continuous?'
LIU_WALL_DESCRIPTION = ('Continuous: Building facades progress through the image without any interruption, blockage or significant setback, at least at the eye height. '
                        'Discontinuous: There is a wide gap between two adjacent buildings; there is a significant setback of a wide building; or there is a solid wall blocking the building from the street. '
                        'If the wall is carefully designed and visually attractive, it can be considered continuous.')


def liu():
    rubric = ' '.join(reversed(LIU_RUBRIC))
    return template(
        '2017-liu-machine', 'Facade Quality and Street-Wall Continuity', 'Liu, Silva, Wu & Wang', 2017,
        '10.1016/j.compenvurbsys.2017.06.003',
        'Trained raters score Beijing street views for facade quality (1–4 rubric) and street-wall continuity; an optional on-site page records the same two judgements for a site passed in the link (?site=...).',
        ['In the paper both judgements were made on the same image; here the two questions draw their images independently.',
         'The on-site page is shown only when the link contains ?site=...; it replaces the original paper forms.',
         'Researchers supply their own street-view images.'],
        'Facade Quality and Street-Wall Continuity', 'Rate each street view using the rubric shown with the question.',
        [
            page('page_rater', 'About you',
                 text('rater_id', 'Rater ID', required=True),
                 radio('background', 'Professional background', BACKGROUND, required=True)),
            page('page_rating', 'Street views',
                 image_q('facade_quality', 'imagerating', LIU_FACADE_TITLE, imageCount=1, trialCount=20,
                         rateMin=1, rateMax=4, rateLabels=LIU_RUBRIC, description=rubric),
                 image_q('street_wall_continuity', 'imageboolean', LIU_WALL_TITLE, imageCount=1, trialCount=20,
                         labelTrue='Continuous', labelFalse='Discontinuous', description=LIU_WALL_DESCRIPTION)),
            page('page_on_site', 'On-site validation',
                 {'name': 'site_facade_quality', 'type': 'rating', 'title': LIU_FACADE_TITLE + ' (the street in front of you)',
                  'rateMin': 1, 'rateMax': 4, 'rateLabels': LIU_RUBRIC, 'description': rubric, 'isRequired': True},
                 {'name': 'site_street_wall_continuity', 'type': 'boolean', 'title': LIU_WALL_TITLE + ' (the street in front of you)',
                  'labelTrue': 'Continuous', 'labelFalse': 'Discontinuous', 'description': LIU_WALL_DESCRIPTION, 'isRequired': True},
                 visibleIf='{url_site} notempty'),
        ],
        {'citation': 'Liu et al. 2017', 'items': [
            {'questions': ['facade_quality'], 'method': 'scalar_distribution'},
            {'questions': ['facade_quality'], 'method': 'rater_agreement', 'raterQuestion': 'rater_id'},
            {'questions': ['site_facade_quality'], 'method': 'param_aggregation', 'param': 'site'},
        ]},
        folders=['Beijing'], captureUrlParams=['site'],
    )


YAO_DIMS = ['safe', 'lively', 'beautiful', 'wealthy', 'boring', 'depressing']


def yao():
    dims = [{'id': d, 'label': d.capitalize(), 'left': '0', 'right': '100'} for d in YAO_DIMS]
    return template(
        '2019-yao-human', 'Human–Machine Scoring (human-only version)', 'Yao et al.', 2019,
        '10.1080/13658816.2019.1643024',
        'Participants score street views from 0 to 100 on six perceptions (safe, lively, beautiful, wealthy, boring, depressing).',
        ['In the original, a random-forest model learned each rater\'s scoring and showed a recommended score after the first 50 images; this template has no model.',
         'Slider end labels are not in the paper.',
         'Researchers supply their own street-view images.'],
        'Street View Perception Scoring', 'Score each street view from 0 to 100 on each of the six perceptions.',
        [page('page_scoring', None,
              image_q('perception_scores', 'imageslidergroup', 'Score this street view on each perception (0–100).',
                      imageCount=1, trialCount=50, dimensions=dims, scaleMin=0, scaleMax=100, scaleStep=1))],
        {'citation': 'Yao et al. 2019', 'items': [
            {'questions': ['perception_scores'], 'method': 'robust_median'},
            {'questions': ['perception_scores'], 'method': 'rater_agreement'},
        ]},
    )


def ramirez():
    qs = [('safer', 'Which place looks safer?', 'Equally safe', 15, True),
          ('walkable', 'Which place looks more walkable?', 'Equally walkable', 5, False),
          ('livable', 'Which place looks more livable?', 'Equally livable', 5, False),
          ('beautiful', 'Which place looks more beautiful?', 'Equally beautiful', 5, False),
          ('wealthier', 'Which place looks wealthier?', 'Equally wealthy', 5, False)]
    names = [q[0] for q in qs]
    return template(
        '2021-ramirez-measuring', 'Heterogeneous Perception of Safety', 'Ramírez, Hurtubia, Lobel & Rossetti', 2021,
        '10.1016/j.landurbplan.2020.104002',
        'Participants give their demographics once and then compare Place Pulse 2.0 image pairs on safety (required) and four optional perceptions, with explicit "equally" answers for ordinal logit models.',
        ['The original allowed unlimited pairs after the demographics; this template asks 15 safety pairs and 5 pairs for each other perception (survey rounds are not available).',
         'Researchers supply the Place Pulse 2.0 images.'],
        'Perception of Urban Places', 'Tell us a little about yourself, then compare pairs of street views.',
        [page('page_demographics', 'About you',
              radio('gender', 'Gender', GENDER, required=True),
              radio('age_group', 'Age', AGE_GROUPS, required=True),
              text('nationality', 'Nationality', required=True),
              text('country_of_residence', 'Current country of residence', required=True),
              radio('education', 'Educational level', [('primary', 'Primary'), ('secondary', 'Secondary'), ('technical', 'Technical / vocational'),
                                                      ('university', 'University'), ('postgraduate', 'Postgraduate')], required=True),
              radio('transport_mode', 'Main transportation mode used', [('walk', 'Walking'), ('bicycle', 'Bicycle'), ('public_transport', 'Public transport'),
                                                                     ('car', 'Car'), ('motorcycle', 'Motorcycle'), ('other', 'Other')], required=True))] +
        [page(f'page_{n}', None, picker(n, t, k, tie=tie, isRequired=req)) for n, t, tie, k, req in qs],
        {'citation': 'Ramírez et al. 2021', 'items': [
            {'questions': names, 'method': 'long_export', 'groupBy': ['gender', 'transport_mode']},
            {'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'draw', 'scale': '0-10'},
        ]},
        folders=['PlacePulse2'],
    )


ITO_DIMS = [('cycling_attractiveness', 'Attractiveness for cycling'), ('spaciousness', 'Spaciousness'), ('cleanliness', 'Cleanliness'),
            ('building_design', 'Building design attractiveness'), ('cyclist_safety', 'Safety as cyclists'), ('beauty', 'Beauty'),
            ('living_attractiveness', 'Attractiveness for living')]


def ito():
    dims = [{'id': i, 'label': l, 'left': '0', 'right': '10'} for i, l in ITO_DIMS]
    return template(
        '2021-ito-assessing', 'Bikeability Perception', 'Ito & Biljecki', 2021, '10.1016/j.trc.2021.103371',
        'Participants rate street-level images from Singapore and Tokyo from 0 to 10 on seven bikeability perceptions; scores are medians after MAD screening.',
        ['The bundled Hugging Face dataset is a single flat folder (no Singapore / Tokyo sub-folders), so the city is not available as a folder tag.',
         'Slider end labels are not in the paper.'],
        'Bikeability Perception', 'Rate each street view from 0 to 10 on each aspect of cycling.',
        [page('page_rating', None,
              image_q('bikeability', 'imageslidergroup', 'Rate this street view on each aspect (0–10).',
                      imageCount=1, trialCount=20, dimensions=dims, scaleMin=0, scaleMax=10, scaleStep=1)),
         page('page_check', None, attention_check())],
        {'citation': 'Ito & Biljecki 2021', 'items': [
            {'questions': ['bikeability'], 'method': 'robust_median', 'madThreshold': 3, 'minPerImage': 8},
            {'questions': ['bikeability'], 'method': 'slider_dimensions'},
        ]},
        hf='koito19960406/sp_survey_bikeability',
    )


def kruse():
    labels = ['Very unplayable', 'Unplayable', 'Neither playable nor unplayable', 'Playable', 'Very playable']
    return template(
        '2021-kruse-places', 'Places for Play', 'Kruse, Kang, Liu, Zhang & Gao', 2021, '10.1016/j.compenvurbsys.2021.101693',
        'Participants rate how playable Boston street views are for children on a five-point scale. Playability is intentionally not defined, as in the paper.',
        ['Researchers supply their own street-view images.'],
        'Places for Play', 'Look at each street view and choose the category that best describes it.',
        [page('page_rating', None,
              image_q('playability', 'imagerating',
                      'Choose the category that most accurately describes how playable the scene in the image is for children.',
                      imageCount=1, trialCount=20, rateMin=1, rateMax=5, rateLabels=labels,
                      minRateDescription=labels[0], maxRateDescription=labels[-1])),
         page('page_check', None, attention_check())],
        {'citation': 'Kruse et al. 2021', 'items': [
            {'questions': ['playability'], 'method': 'scalar_distribution', 'minPerImage': 9},
        ]},
        folders=['Boston'],
    )


def qiu():
    qs = [('enclosure', 'Which place has better Enclosure?'), ('human_scale', 'Which place has better Human scale?'),
          ('complexity', 'Which place has better Complexity?'), ('imageability', 'Which place has better Imageability?'),
          ('safety', 'Which place looks safer?')]
    names = [n for n, _ in qs]
    pickers = []
    for n, t in qs:
        extra = {'description': EWING_DEFINITIONS[n]} if n in EWING_DEFINITIONS else {}
        pickers.append(page(f'page_{n}', None, picker(n, t, 20, pairingMode='balanced', **extra)))
    return template(
        '2022-qiu-subjective', 'Street Design Qualities (Shanghai)', 'Qiu et al.', 2022, '10.1016/j.landurbplan.2021.104358',
        'Raters compare Shanghai street views on four Ewing & Handy design qualities (with their definitions) and safety; scores are TrueSkill ratings scaled to 0–1.',
        ['Researchers supply their own street-view images.', 'The rater background wording is not in the paper.'],
        'Street Design Qualities', 'For each pair of street views, choose the one that better shows the quality described.',
        [page('page_rater', 'About you',
              radio('discipline', 'Discipline (wording not in paper)', BACKGROUND, required=True),
              radio('role', 'Are you a student or staff? (wording not in paper)', [('student', 'Student'), ('staff', 'Staff')], required=True))] + pickers,
        {'citation': 'Qiu et al. 2022', 'items': [
            {'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'scale': '0-1', 'minPerImage': 12},
        ]},
        folders=['Shanghai'],
    )


def kang_2023():
    return template(
        '2023-kang-assessing', 'Safety Perception and Question Framing (Stockholm)', 'Kang et al.', 2023,
        '10.1016/j.landurbplan.2023.104768',
        'Participants are randomly assigned to one of two framings and compare Stockholm street views. It is one question whose wording depends on the condition ("looks safe" or "looks less safe"); "less safe" answers are reverse-coded before pooling.',
        ['The original interface was in Swedish; this template is in English only.',
         'Researchers supply their own street-view images.'],
        'Street Safety Perception', 'Tell us where you live, then compare pairs of street views.',
        [page('page_residence', 'About you', text('neighbourhood', 'Which neighbourhood do you live in?', required=True)),
         page('page_choice', None,
              picker('safety', 'Which place looks safe?', 10,
                     conditionVariants=[{'condition': 'less_safe', 'title': 'Which place looks less safe?', 'reverseCoded': True}]))],
        {'citation': 'Kang et al. 2023', 'items': [
            {'questions': ['safety'], 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'scale': '0-10', 'groupBy': ['condition']},
        ]},
        folders=['Stockholm'],
        conditions=[{'id': 'safe', 'label': 'Looks safe'}, {'id': 'less_safe', 'label': 'Looks less safe'}],
    )


TORKKO_TITLE = ('Please evaluate the amount of greenery visible in your surrounding scenery, from 0 (no visible greenery) to 100 (only greenery is visible). '
                'Concentrate on natural greenery, i.e., exclude green-coloured cars, buildings, and other artificial objects.')


def torkko():
    dim = [{'id': 'greenery', 'label': 'Visible greenery', 'left': '0 – no visible greenery', 'right': '100 – only greenery is visible'}]
    return template(
        '2023-torkko-how', 'Perceived Greenery In Situ', 'Torkko, Poom, Willberg & Toivonen', 2023, '10.3389/frsc.2023.1160995',
        'Participants scan a QR code at one of 20 Helsinki sites (link ?site=S01…S20) and rate the visible greenery around them from 0 to 100; an optional online version rates street-level images instead.',
        ['The in-situ page is shown only when the link contains ?site=...; without it, the online version (not in the original study) is shown.'],
        'Perceived Greenery', 'This short survey asks how much greenery you can see around you.',
        [page('page_consent', 'Consent',
              {'name': 'consent', 'type': 'checkbox', 'title': 'I agree to take part in this study and for my answers to be used for research.',
               'choices': choices(('agree', 'I agree')), 'isRequired': True}),
         page('page_in_situ', 'Your surroundings',
              {'name': 'greenery_in_situ', 'type': 'slidergroup', 'title': TORKKO_TITLE, 'dimensions': dim,
               'scaleMin': 0, 'scaleMax': 100, 'scaleStep': 1, 'isRequired': True},
              visibleIf='{url_site} notempty'),
         page('page_online', 'Online version (not in original study)',
              image_q('greenery_online', 'imageslidergroup', TORKKO_TITLE.replace('your surrounding scenery', 'this image'),
                      imageCount=1, trialCount=10, dimensions=dim, scaleMin=0, scaleMax=100, scaleStep=1),
              visibleIf='{url_site} empty')],
        {'citation': 'Torkko et al. 2023', 'items': [
            {'questions': ['greenery_in_situ'], 'method': 'param_aggregation', 'param': 'site'},
            {'questions': ['greenery_online'], 'method': 'slider_dimensions'},
        ]},
        hf='Jusba/Greenery_Survey_Helsinki_Mapillary/images', captureUrlParams=['site'],
    )


DANISH_CATEGORIES = [
    ('walkability', 'Walkability', 'Does this place look like an easy and safe place for people to travel on foot or using a walking-equivalent mobility aid (e.g. wheelchair)? This might include factors such as the quality of sidewalks, pedestrian crossings, street connectivity, and access to public amenities.'),
    ('bikeability', 'Bikeability', 'Does this place look accessible, attractive, safe and convenient for cycling as a mode of general-purpose transportation, or cycling-equivalent mobility aid (e.g. mobility scooter)? This might include factors such as cycle lanes, tracks, and parking, as well as the overall design of streets, junctions and any visible surroundings.'),
    ('pleasantness', 'Pleasantness', 'Does this place look enjoyable or pleasing to the senses or emotions? This might include factors such as the aesthetics of the surroundings, the quality of the air and lighting, the soundscape, and the presence of other people or natural elements.'),
    ('greenness', 'Greenness', 'Rate the apparent amount of vegetation and greenery in a given environment. This encompasses the presence of trees, shrubs, plants, and other natural elements.'),
    ('safety', 'Safety', 'Does this place look like you would feel protected from harm or danger, in terms of personal safety and security? Do you believe that it is likely that you would feel safe here at all times of day or night? This might include the presence of elements such as lighting, good maintenance, presence of other people and natural surveillance.'),
]


def danish():
    labels = ['Awful', 'Bad', 'Neutral', 'Good', 'Great']
    names = [n for n, _, _ in DANISH_CATEGORIES]
    return template(
        '2025-danish-citizen', 'percept (Citizen Science)', 'Danish, Labib, Ricker & Helbich', 2025, '10.1016/j.compenvurbsys.2024.102207',
        'Citizens rate Amsterdam street views from awful to great on walkability, bikeability, pleasantness, greenness and safety, each with the paper\'s category text.',
        ['The original app switched category at random every five images and offered swipe input; here each category is a block of 20 images with button input.',
         'Researchers supply their own street-view images.'],
        'percept', 'Tell us a little about yourself, then rate street views.',
        [page('page_about_you', 'About you',
              text('age', 'Age', required=True, inputType='number'),
              {'name': 'adult_confirm', 'type': 'checkbox', 'title': 'I confirm that I am 18 years or older.',
               'choices': choices(('yes', 'Yes')), 'isRequired': True},
              radio('gender', 'Gender', GENDER),
              text('monthly_income', 'Estimated monthly income'),
              radio('education', 'Level of education', [('primary', 'Primary'), ('secondary', 'Secondary'),
                                                       ('tertiary', 'Tertiary'), ('postgraduate', 'Postgraduate')]),
              text('postal_code', 'Home postal code'),
              text('country_of_residence', 'Country of residence'),
              {'name': 'data_consent', 'type': 'checkbox', 'title': 'I agree that my answers may be used for research.',
               'choices': choices(('agree', 'I agree')), 'isRequired': True})] +
        [page(f'page_{n}', label,
              image_q(n, 'imagerating', f'{label}: {desc}', imageCount=1, trialCount=20, rateMin=1, rateMax=5,
                      rateLabels=labels, minRateDescription='Awful', maxRateDescription='Great'))
         for n, label, desc in DANISH_CATEGORIES],
        {'citation': 'Danish et al. 2025', 'items': [
            {'questions': names, 'method': 'scalar_distribution', 'groupBy': ['gender', 'education']},
        ]},
        folders=['Amsterdam'],
    )


def kang_2026():
    return template(
        '2026-kang-decoding', 'Safety Choice (Eye-Tracking Study)', 'Kang et al.', 2026, '10.1016/j.compenvurbsys.2025.102356',
        'Participants choose the safer of two Helsingborg street views; the participant ID from the link (?pid=...) and per-trial timestamps allow linking to eye-tracker recordings. Images chosen at least 3 times are labelled safe.',
        ['Eye tracking is not part of the platform; record it separately and join on pid and the trial timestamps.',
         'Researchers supply their own street-view images.'],
        'Street Safety Choice', 'For each pair, choose the place that looks safer.',
        [page('page_choice', None, picker('safer', 'Which place looks safer?', 10))],
        {'citation': 'Kang et al. 2026', 'items': [
            {'questions': ['safer'], 'method': 'choice_share', 'threshold': 3},
        ]},
        folders=['Helsingborg'], captureUrlParams=['pid'],
    )


def ewing():
    rows = [('imageability', 'Imageability'), ('enclosure', 'Enclosure'), ('human_scale', 'Human scale'),
            ('transparency', 'Transparency'), ('complexity', 'Complexity'),
            ('legibility', 'Legibility (optional)'), ('linkage', 'Linkage (optional)'), ('coherence', 'Coherence (optional)')]
    columns = [{'value': '1', 'text': '1 = very low'}, {'value': '2', 'text': '2'}, {'value': '3', 'text': '3'},
               {'value': '4', 'text': '4'}, {'value': '5', 'text': '5 = very high'}]
    definitions = ' '.join(EWING_DEFINITIONS[k] for k in ['imageability', 'enclosure', 'human_scale', 'transparency', 'complexity'])
    return template(
        '2009-ewing-measuring', 'Urban Design Qualities (Expert Video Panel)', 'Ewing & Handy', 2009, '10.1080/13574800802451155',
        'An expert panel watches street video clips to the end and rates each clip from 1 (very low) to 5 (very high) on urban design qualities, using the paper\'s definitions.',
        ['The original panel rated clips together in a room with discussion; here raters work individually online.',
         'Upload the clips (48 in the paper) to the "clips" folder and set the trial count to the number of clips.',
         'The paper gives no definitions for legibility, linkage and coherence.'],
        'Urban Design Qualities', 'Watch each clip to the end, then rate it on each quality.',
        [page('page_rater', 'About you',
              text('rater_id', 'Rater ID', required=True),
              radio('background', 'Professional background', BACKGROUND, required=True)),
         page('page_clips', None,
              image_q('design_qualities', 'mediamatrix', 'Rate this clip on each urban design quality.',
                      mediaType='video', imageCount=1, trialCount=48, mediaFolders=['clips'], requireMediaEnded=True,
                      mediaPresentation='stack', rows=[{'value': v, 'text': t} for v, t in rows], columns=columns,
                      description=definitions))],
        {'citation': 'Ewing & Handy 2009', 'items': [
            {'questions': ['design_qualities'], 'method': 'matrix_rows'},
            {'questions': ['design_qualities'], 'method': 'rater_agreement', 'raterQuestion': 'rater_id'},
        ]},
        folders=['clips'],
    )


NASAR_AREAS = [
    {
        'id': 'knoxville-1990', 'revision': 1, 'cityId': 'knoxville',
        'label': 'Knoxville preset rectangle. This is a starting study extent, not the city administrative boundary.',
        'center': [-83.90, 35.965], 'zoom': 12,
        'boundary': {'type': 'Polygon', 'coordinates': [[[-84.05, 35.88], [-83.75, 35.88], [-83.75, 36.05], [-84.05, 36.05], [-84.05, 35.88]]]},
    },
    {
        'id': 'chattanooga-1990', 'revision': 1, 'cityId': 'chattanooga',
        'label': 'Chattanooga preset rectangle. This is a starting study extent, not the city administrative boundary.',
        'center': [-85.30, 35.05], 'zoom': 12,
        'boundary': {'type': 'Polygon', 'coordinates': [[[-85.40, 34.98], [-85.20, 34.98], [-85.20, 35.12], [-85.40, 35.12], [-85.40, 34.98]]]},
    },
]


def nasar_map(name, label, title):
    return {
        'name': name, 'type': 'mapannotation', 'title': title, 'isRequired': True,
        'description': 'Draw each area on the map. Name the place and say why you marked it. Zero areas must be confirmed with “No area to mark”. Online drawing is a digitization of the original interviewer-made evaluative maps.',
        'mapTools': ['polygon', 'rectangle', 'point'], 'mapLabel': label, 'cityQuestion': 'city',
        'studyAreaId': 'knoxville-1990', 'studyAreas': NASAR_AREAS,
        'minAnnotations': 0, 'maxAnnotations': 5,
    }


def nasar():
    # Map questions only. Do not call image_q: that helper turns on image sampling.
    built = template(
        '1990-nasar-evaluative', 'The Evaluative Image of the City', 'Nasar', 1990, '10.1080/01944369008975742',
        'Residents and visitors named up to five visually pleasant and five unpleasant areas. Interviewers turned those descriptions into personal evaluative maps. The published Knoxville sample was 160 residents and 120 visitors; Chattanooga was 60 and 60. Those counts are literature context, not quotas for a new survey.',
        ['Participants draw the areas themselves. The original interviews used verbal descriptions, with a map as an aid in the face-to-face visitor interviews.',
         'The live age and income bands are mutually exclusive. The published age labels leave age 20 unlabeled, and the published income bands do not state whether a boundary dollar belongs in the lower or upper band. The paper does not say whether income is personal or household, or which year it refers to.',
         'Gender options beyond male and female, and the “prefer not to say” choices, are modern adaptations. Ethnicity uses the Black, White and Other categories reported for these US samples and should be replaced for a study elsewhere.',
         'Years lived, familiarity, visit count and length of stay are platform extensions. They are not Table 2 columns. Education, occupation and travel mode are not included.'],
        'The Evaluative Image of the City',
        'You will confirm a city, describe your connection to it, and mark areas you find visually pleasant or unpleasant.',
        [page('page_intro', 'Introduction',
              {'name': 'intro', 'type': 'expression', 'title': 'About this survey',
               'description': 'The two map tasks use the same study extent. About half of participants see pleasant areas first. Your order stays the same if you go back or refresh. The survey does not read your location and does not ask for a home address.'},
              radio('city', 'Which city are you evaluating?', [('knoxville', 'Knoxville'), ('chattanooga', 'Chattanooga')], required=True,
                   description='These are the two cities in the published study. A new project can replace them with its own preset cities. Participants cannot switch to an arbitrary city.')),
         page('page_relation', 'Your connection to the city',
              radio('resident_or_visitor', 'What is your connection to this city?',
                    [('resident', 'Resident'), ('visitor', 'Visitor'),
                     ('works_or_studies', 'I work or study here but do not live here (platform extension, not in Table 2)')],
                    required=True),
              radio('familiarity', 'How familiar are you with this city? (platform extension)',
                    [('low', 'Slightly familiar'), ('moderate', 'Moderately familiar'), ('high', 'Very familiar'), ('prefer_not', 'Prefer not to say')],
                    required=False),
              text('years_in_city', 'How many years have you lived in the city? (platform extension; not a Table 2 column)',
                   inputType='number', visibleIf="{resident_or_visitor} = 'resident'"),
              text('visit_count', 'About how many times have you visited? (platform extension)',
                   inputType='number', visibleIf="{resident_or_visitor} = 'visitor'"),
              text('stay_days', 'About how many days was your most recent stay? (platform extension)',
                   inputType='number', visibleIf="{resident_or_visitor} = 'visitor'")),
         page('page_liked', None, nasar_map('liked_areas', 'liked', 'Mark up to five areas you find visually pleasant.')),
         page('page_disliked', None, nasar_map('disliked_areas', 'disliked', 'Mark up to five areas you find visually unpleasant.')),
         page('page_improvement', 'What most needs to change',
              radio('knoxville_improvement', 'Which element is most in need of visual improvement in Knoxville?',
                    [('industry', 'Industry'), ('highways', 'Highways'), ('signs_billboards', 'Signs and billboards'),
                     ('buildings', 'Buildings'), ('poles_wires', 'Utility poles and wires'), ('riverfront', 'Riverfront'),
                     ('parking', 'Parking lots'), ('buses', 'Buses'), ('railways', 'Railways'),
                     ('service_stations', 'Service stations')],
                    required=False, showOtherItem=True, otherText='Other',
                    visibleIf="{city} = 'knoxville'",
                    description='This list follows Appendix A. A Table 1 style display may later place buses, railways and service stations under Other. The saved answer keeps the specific choice.'),
              {'name': 'chattanooga_improvement', 'type': 'comment', 'isRequired': False,
               'visibleIf': "{city} = 'chattanooga'",
               'title': 'If you could change one thing, what would you change to improve the appearance of Chattanooga?'}),
         page('page_demographics', 'About you',
              radio('gender', 'Gender',
                    [('male', 'Male'), ('female', 'Female'), ('self_describe', 'Prefer to self-describe (adaptation)'), ('prefer_not', 'Prefer not to say (adaptation)')],
                    required=False,
                    description='The published table reports Male and Female. Self-describe and prefer-not-to-say are adaptations and should be reported as such.'),
              radio('ethnicity', 'Race / ethnicity for this US sample',
                    [('black', 'Black'), ('white', 'White'), ('other', 'Other'), ('prefer_not', 'Prefer not to say (adaptation)')],
                    required=False,
                    description='Black, White and Other are the categories in Table 2 for these two US cities. Replace them when the study is elsewhere. Do not treat this list as a global classification.'),
              radio('age_band', 'Age',
                    [('under_21', 'Under 21'), ('21_39', '21–39'), ('40_60', '40–60'), ('61_plus', '61 or older'), ('prefer_not', 'Prefer not to say')],
                    required=False,
                    description='Table 2 prints Under 20, 21–39, 40–60 and Over 60, which leaves age 20 unlabeled. These live bands are mutually exclusive: 20 is included in Under 21, and 60 stays in 40–60.'),
              radio('income', 'Income in US dollars',
                    [('under_10000', 'Under $10,000'), ('10000_24999', '$10,000–$24,999'), ('25000_or_more', '$25,000 or more'),
                     ('no_response', 'No response'), ('prefer_not', 'Prefer not to say (adaptation)')],
                    required=False,
                    description='Table 2 prints $0–$10,000, $10,000–$24,999 and Over $25,000, so the boundary dollars are ambiguous. These live bands do not overlap. The paper does not say whether the amount is personal or household, or which year it covers. Do not label it as household income from the paper.'))],
        {'citation': 'Nasar 1990', 'items': [
            {'questions': ['liked_areas', 'disliked_areas'], 'method': 'geographic_evaluative_map',
             'likedQuestion': 'liked_areas', 'dislikedQuestion': 'disliked_areas'},
        ]},
        folders=(),
        spMapTaskOrder={'valueName': 'map_task_order', 'firstPage': 'page_liked', 'secondPage': 'page_disliked'},
    )
    built['thumbnailUrl'] = '/project_templates/1990-nasar-evaluative-cover.svg'
    built['huggingfaceDataset'] = None
    return built


BUILDERS = [salesses, quercia, liu, yao, ramirez, ito, kruse, qiu, kang_2023, torkko, danish, kang_2026, ewing, nasar]


def main():
    index_path = ROOT / 'index.json'
    index = json.loads(index_path.read_text())
    for build in BUILDERS:
        tpl = build()
        (ROOT / f"{tpl['id']}.json").write_text(json.dumps(tpl, indent=2, ensure_ascii=False) + '\n')
        entry = f"{tpl['id']}.json"
        if entry not in index['templates']:
            index['templates'].append(entry)
        print('wrote', tpl['id'])
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
