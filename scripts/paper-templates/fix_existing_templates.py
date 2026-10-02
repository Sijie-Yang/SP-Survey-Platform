"""Part B: align 12 existing built-in templates with their source papers.

Run from the repo root: python3 scripts/paper-templates/fix_existing_templates.py
Run once on the templates synced from online; edits public/project_templates/<id>.json in place.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'public' / 'project_templates'
EXT_TITLE = 'Optional extension (not in original study)'
HF = ('imageFit', 'imageSource', 'imageSelectionMode', 'randomImageSelection')


def load(tid):
    return json.loads((ROOT / f'{tid}.json').read_text())


def save(tid, data):
    (ROOT / f'{tid}.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')


def elements(cfg):
    for page in cfg['pages']:
        for el in page.get('elements', []):
            yield page, el


def find(cfg, name):
    for page, el in elements(cfg):
        if el.get('name') == name:
            return page, el
    raise KeyError(name)


def page_by_name(cfg, name):
    return next(p for p in cfg['pages'] if p.get('name') == name)


def hf_fields(source):
    return {k: source[k] for k in HF if k in source}


def to_image_linked(el, new_type, image_el, image_count=1):
    """Turn a rating/matrix/radiogroup that sat next to a separate image item into an image-linked type."""
    el['type'] = new_type
    el.update(hf_fields(image_el))
    el['imageCount'] = image_count
    el['randomImageSelection'] = True
    el.setdefault('imageSelectionMode', 'huggingface_random')
    el.setdefault('imageSource', 'huggingface')
    for k in ('maxRateDescription', 'minRateDescription') if new_type.endswith('matrix') else ():
        el.pop(k, None)


def drop(cfg, name):
    for page in cfg['pages']:
        page['elements'] = [e for e in page.get('elements', []) if e.get('name') != name]


def set_tie(cfg, names, label):
    for n in names:
        _, el = find(cfg, n)
        el['allowTie'] = True
        el['tieLabel'] = label


# 1. Naik et al. 2014 — Streetscore
def naik():
    d = load('2014-naik-streetscore')
    c = d['config']
    pw_page = page_by_name(c, 'page_pairwise')
    pw_page['title'] = 'Which place looks safer?'
    _, pw = find(c, 'safety_pairwise')
    pw['title'] = 'Which place looks safer?'
    for i in (1, 2, 3):
        page = page_by_name(c, f'page_safety_{i}')
        _, img = find(c, f'street_image_{i}')
        _, rating = find(c, f'safety_score_{i}')
        to_image_linked(rating, 'imagerating', img)
        rating['isRequired'] = False
        _, reason = find(c, f'safety_reason_{i}')
        reason['isRequired'] = False
        drop(c, f'street_image_{i}')
        page['title'] = f'{EXT_TITLE} — single-image safety rating'
    order = ['page_intro', 'page_pairwise', 'page_safety_1', 'page_safety_2', 'page_safety_3', 'page_demographics']
    c['pages'] = sorted(c['pages'], key=lambda p: order.index(p['name']) if p['name'] in order else len(order))
    d['name'] = 'Streetscore – Place Pulse Safety Comparison'
    d['description'] = (
        'Pairwise perceived-safety comparison from Place Pulse 1.0, the training data of Streetscore. '
        'Participants answer "Which place looks safer?" for pairs of street view images; TrueSkill ratings are '
        'scaled to 0–10 as in the paper. Single-image 1–10 ratings follow on optional pages that are not part of the original study.'
    )
    c['description'] = ('Choose the place that looks safer. Based on: Naik, N., Philipoom, J., Raskar, R., & Hidalgo, C. (2014). '
                        'Streetscore—Predicting the perceived safety of one million streetscapes. CVPR Workshops 2014.')
    c['spAnalysisRecommendation'] = {
        'citation': 'Naik et al. 2014',
        'items': [
            {'questions': ['safety_pairwise'], 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'runs': 1,
             'scale': '0-10', 'minPerImage': 29},
            {'questions': ['safety_score_1', 'safety_score_2', 'safety_score_3'], 'method': 'scalar_distribution',
             'minPerImage': 12, 'citation': 'optional extension'},
        ],
    }
    save('2014-naik-streetscore', d)


# 2. Dubey et al. 2016 — Place Pulse 2.0
def dubey():
    d = load('2016-dubey-place')
    c = d['config']
    wording = {
        'safe': 'Which place looks safer?',
        'lively': 'Which place looks livelier?',
        'boring': 'Which place looks more boring?',
        'wealthy': 'Which place looks wealthier?',
        'depressing': 'Which place looks more depressing?',
        'beautiful': 'Which place looks more beautiful?',
    }
    for n, t in wording.items():
        _, el = find(c, n)
        el['title'] = t
    names = list(wording)
    c['spAnalysisRecommendation'] = {
        'citation': 'Dubey et al. 2016; Salesses et al. 2013',
        'items': [
            {'questions': names, 'method': 'qscore_pairwise', 'minPerImage': 4, 'scale': '0-10'},
            {'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'runs': 1, 'scale': '0-10'},
        ],
    }
    save('2016-dubey-place', d)


# 3. Seresinhe et al. 2017 — Scenic-Or-Not
def seresinhe():
    d = load('2017-seresinhe-scenic')
    c = d['config']
    ext = {'name': 'page_extension', 'title': EXT_TITLE,
           'description': 'These items are not part of Scenic-Or-Not, which asked only for a 1–10 scenicness rating.',
           'elements': []}
    for i in (1, 2):
        page = page_by_name(c, f'page_beauty_{i}')
        _, img = find(c, f'scene_image_{i}')
        _, rating = find(c, f'scenic_beauty_{i}')
        to_image_linked(rating, 'imagerating', img)
        _, matrix = find(c, f'scene_qualities_{i}')
        to_image_linked(matrix, 'imagematrix', img)
        matrix['isRequired'] = False
        drop(c, f'scene_image_{i}')
        drop(c, f'scene_qualities_{i}')
        ext['elements'].append(matrix)
        page['title'] = 'Scenic Beauty Rating'
    for pname, qname in (('page_pairwise_beauty', 'beauty_pairwise'), ('page_green_view', 'green_view_pairwise')):
        _, el = find(c, qname)
        el['isRequired'] = False
        ext['elements'].append(el)
        c['pages'] = [p for p in c['pages'] if p['name'] != pname]
    green = next(e for e in ext['elements'] if e['name'] == 'green_view_pairwise')
    green['title'] = 'Which of these scenes has the most visible greenery / natural elements?'
    demo = [p for p in c['pages'] if p['name'] == 'page_demographics']
    c['pages'] = [p for p in c['pages'] if p['name'] != 'page_demographics'] + [ext] + demo
    c['spAnalysisRecommendation'] = {
        'citation': 'Seresinhe et al. 2017',
        'items': [{'questions': ['scenic_beauty_1', 'scenic_beauty_2'], 'method': 'scalar_distribution', 'minPerImage': 12}],
    }
    save('2017-seresinhe-scenic', d)


# 4. Liang et al. 2024 — building facades
def liang():
    d = load('2024-liang-building')
    c = d['config']
    pairs = ['complex', 'original', 'ordered', 'pleasing', 'boring']
    set_tie(c, pairs, 'Equal')
    _, img = find(c, 'style_image')
    _, stype = find(c, 'stype')
    labels = [ch['text'] for ch in stype.get('choices', [])]
    to_image_linked(stype, 'imagerating', img)
    stype.pop('choices', None)
    stype['title'] = 'How would you categorise the architectural style of this building facade?'
    stype['rateMin'] = 1
    stype['rateMax'] = len(labels) or 5
    stype['rateLabels'] = labels
    stype['minRateDescription'] = labels[0] if labels else 'Historical'
    stype['maxRateDescription'] = labels[-1] if labels else 'Modern'
    drop(c, 'style_image')
    c['spAnalysisRecommendation'] = {
        'citation': 'Liang et al. 2024',
        'items': [
            {'questions': pairs, 'method': 'trueskill_pairwise', 'tieHandling': 'draw', 'runs': 1, 'scale': '0-10'},
            {'questions': ['stype'], 'method': 'scalar_distribution',
             'labels': {'stype': 'Style (1 = historical … 5 = modern)'}},
        ],
    }
    save('2024-liang-building', d)


# 5. Yang et al. 2025 — thermal affordance
def yang():
    d = load('2025-yang-thermal')
    c = d['config']
    micro = 'Which street view image do you perceive exhibits a higher '
    env = 'Which street view image do you think showcases '
    design = 'Which street view image stands out to you as '
    emo = 'Which street view image do you feel evokes a more '
    wording = {
        'thermal_comfort': 'Which street view image do you perceive as having a more comfortable outdoor thermal environment for you?',
        'temperature': micro + 'outdoor temperature?',
        'sunlight_intensity': micro + 'sunlight intensity?',
        'humidity': micro + 'humidity?',
        'wind_velocity': micro + 'wind speed?',
        'traffic_flow': env + 'higher traffic flow?',
        'greenery': env + 'a higher greenery rate?',
        'shading_area': env + 'more shading areas?',
        'construction_material_comfort': env + 'higher construction material comfort?',
        'impressive': design + 'a more impressive place?',
        'enclosure': design + 'a more enclosed space?',
        'human_friendly': design + 'more accommodating for human scale?',
        'transparency': design + 'a more transparent space?',
        'complexity': design + 'a more complex environment?',
        'safe': emo + 'safe atmosphere?',
        'beautiful': emo + 'beautiful atmosphere?',
        'lively': emo + 'lively atmosphere?',
        'wealthy': emo + 'wealthy atmosphere?',
        'boring': emo + 'boring atmosphere?',
        'depressing': emo + 'depressing atmosphere?',
    }
    for n, t in wording.items():
        _, el = find(c, n)
        el['title'] = t
        el['imageCount'] = 2
        el['trialCount'] = 18
    intros = {
        'thermal_comfort_intro': 'Visual Assessment of Thermal Affordance (VATA). Choose the image in each pair.',
        'environment_intro': 'Microclimate inference and environmental evaluation. Choose the image in each pair.',
        'design_intro': 'Streetscape design quality. Choose the image in each pair.',
        'emotion_intro': 'Evoked emotion. Choose the image in each pair.',
    }
    for n, t in intros.items():
        _, el = find(c, n)
        el['title'] = t
    ext_names = ['comfort', 'artificial_heat_sources']
    ext = {'name': 'page_extension', 'title': EXT_TITLE,
           'description': 'Not part of the 20 indicators in Yang et al. (2025).', 'elements': []}
    for n in ext_names:
        _, el = find(c, n)
        el['imageCount'] = 2
        el['isRequired'] = False
        ext['elements'].append(el)
        drop(c, n)
    drop(c, 'comfort_intro')
    c['pages'] = [p for p in c['pages'] if p.get('elements')]
    first = c['pages'][0]
    first['title'] = 'Part 1: Visual Assessment of Thermal Affordance'
    c['pages'].append(ext)
    names = list(wording)
    d['description'] = (
        'Pairwise street view comparison of thermal affordance (VATA) and 19 visual-perceptual indicators from Yang et al. (2025): '
        '18 comparisons per indicator, TrueSkill repeated 20 times and normalised to 0–5.'
    )
    c['spAnalysisRecommendation'] = {
        'citation': 'Yang et al. 2025',
        'items': [{'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'runs': 20, 'scale': '0-5'}],
    }
    save('2025-yang-thermal', d)


# 6. Gu et al. 2025 — Likert vs pairwise
def gu():
    d = load('2025-gu-effective')
    c = d['config']
    pairs = ['pairwise_safe', 'pairwise_lively', 'pairwise_boring', 'pairwise_depressing', 'pairwise_wealthy', 'pairwise_beautiful']
    set_tie(c, pairs, 'Equal')
    _, img = find(c, 'likert_image')
    _, likert = find(c, 'likert')
    to_image_linked(likert, 'imagematrix', img)
    drop(c, 'likert_image')
    c['spAnalysisRecommendation'] = {
        'citation': 'Gu et al. 2025',
        'items': [
            {'questions': ['likert'], 'method': 'matrix_rows', 'minPerImage': 12},
            {'questions': pairs, 'method': 'qscore_pairwise', 'minPerImage': 22},
            {'questions': pairs, 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'runs': 1, 'minPerImage': 29},
        ],
    }
    save('2025-gu-effective', d)


# 7. Li et al. 2025 — street multi-activity potential
def li():
    d = load('2025-li-street')
    c = d['config']
    _, img = find(c, 'smap_images')
    _, smap = find(c, 'smap')
    to_image_linked(smap, 'imagematrix', img, image_count=4)
    fixes = {'jagging': 'Jogging', 'exercise': 'Exercising', 'vendors': 'Street vending'}
    for row in smap['rows']:
        if row.get('value') in fixes:
            row['text'] = fixes[row['value']]
    drop(c, 'smap_images')
    note = (' In the paper, a multimodal LLM produced the main scores; 1,044 resident questionnaires over 500 locations '
            'were used to validate them. This template reproduces that validation questionnaire.')
    if 'validate them' not in d['description']:
        d['description'] = d['description'].rstrip() + note
    c['spAnalysisRecommendation'] = {
        'citation': 'Li et al. 2025',
        'items': [{'questions': ['smap'], 'method': 'matrix_rows'}],
    }
    save('2025-li-street', d)


# 8. Quintana et al. 2025 — SPECS
def quintana_specs():
    d = load('2025-quintana-specs')
    c = d['config']
    pairs = ['safer', 'livelier', 'wealthier', 'beautiful', 'boring', 'depressing', 'live_nearby',
             'live_nearby_1', 'live_nearby_2', 'live_nearby_3']
    set_tie(c, pairs, 'Both are the same to me')
    for n, t in (('live_nearby_1', 'Which place looks better to walk?'), ('live_nearby_2', 'Which place looks better to cycle?'),
                 ('live_nearby_3', 'Which place looks greener?')):
        _, el = find(c, n)
        el['title'] = t
    c['spAnalysisRecommendation'] = {
        'citation': 'Quintana et al. 2025',
        'items': [{
            'questions': pairs, 'method': 'qscore_pairwise', 'minPerImage': 4, 'scale': '0-10',
            'labels': {'live_nearby_1': 'walk', 'live_nearby_2': 'cycle', 'live_nearby_3': 'green'},
            'groupBy': ['gender', 'age_group', 'country', 'edu_level', 'ahi', 'bfi'],
            'bfi10': {'items': [f'personality_{i}' for i in range(1, 11)],
                      'key': 'Extraversion 1R,6; Agreeableness 2,7R; Conscientiousness 3R,8; Neuroticism 4R,9; Openness 5R,10'},
            'test': 'welch_anova',
        }],
    }
    save('2025-quintana-specs', d)


# 9. Quintana et al. 2026 — greenery
def quintana_greenery():
    d = load('2026-quintana-greenery')
    c = d['config']
    pairs = [f'green_{i}' for i in range(1, 6)]
    set_tie(c, pairs, 'Both are the same to me')
    for i in range(1, 6):
        drop(c, f'green_{i}_equal')
    c['spAnalysisRecommendation'] = {
        'citation': 'Quintana et al. 2026',
        'items': [{'questions': pairs, 'method': 'qscore_pairwise', 'minPerImage': 4, 'scale': '0-1'}],
    }
    save('2026-quintana-greenery', d)


# 10. Peng et al. 2026 — window views
def peng():
    d = load('2026-peng-city')
    c = d['config']
    names = ['prefer', 'monotonous', 'quiet', 'extensive', 'vivid', 'oppressive']
    for n in names:
        _, el = find(c, n)
        el.pop('allowTie', None)
        el.pop('tieLabel', None)
    c['qualityChecks'] = {'samePosition': {'minTrials': len(names)}}
    c['spAnalysisRecommendation'] = {
        'citation': 'Peng et al. 2026',
        'items': [{'questions': names, 'method': 'trueskill_pairwise', 'tieHandling': 'exclude', 'runs': 1, 'scale': '0-5'}],
    }
    save('2026-peng-city', d)


# 11. Lopes et al. 2026 — before/after interventions
def lopes():
    d = load('2026-lopes-street-gsv')
    c = d['config']
    pairs = [e['name'] for _, e in elements(c) if e.get('type') == 'imagepicker']
    for n in pairs:
        _, el = find(c, n)
        el['randomizeSetOrder'] = True
        el.pop('allowTie', None)
    c['spAnalysisRecommendation'] = {
        'citation': 'Lopes et al. 2026',
        'items': [
            {'questions': pairs, 'method': 'choice_share',
             'note': 'Put before.jpg and after.jpg in each set folder; the folder name encodes the intervention type.'},
            {'questions': pairs, 'method': 'long_export'},
        ],
    }
    save('2026-lopes-street-gsv', d)


# 12. Wang & Li 2027 — hotel hue
def wang():
    d = load('2027-wang-hotel-hue')
    c = d['config']
    for n in ('study2_hotel_preference', 'study4_hotel_preference'):
        _, el = find(c, n)
        el['randomizeSetOrder'] = True
    c['spAnalysisRecommendation'] = {
        'citation': 'Wang & Li 2027',
        'items': [
            {'questions': ['study2_hotel_preference', 'study4_hotel_preference'], 'method': 'choice_share'},
            {'questions': ['study2_hotel_preference', 'study4_hotel_preference'], 'method': 'long_export'},
            {'questions': ['study3b_booking_likelihood', 'study3b_hue_check'], 'method': 'scalar_distribution'},
        ],
    }
    save('2027-wang-hotel-hue', d)


if __name__ == '__main__':
    for fn in (naik, dubey, seresinhe, liang, yang, gu, li, quintana_specs, quintana_greenery, peng, lopes, wang):
        fn()
        print('updated', fn.__name__)
