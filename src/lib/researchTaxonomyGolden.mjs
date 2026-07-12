/**
 * Golden fixtures for taxonomy v4 precision-oriented tests.
 * Abstracts are representative / synthetic hard cases drawn from audit findings.
 */
export const GOLDEN_PAPERS = [
  {
    id: 'gsv-likert-safety',
    title: 'Perceived safety from Google Street View',
    abstract:
      'We conducted an online questionnaire where n=240 participants rated streetscape images '
      + 'for walkability and perceived comfort across neighborhoods in Singapore using a 5-point Likert scale. '
      + 'Inter-rater reliability was assessed and the questionnaire is available on OSF.',
    keywords: ['GSV', 'perception'],
    expect: {
      analysis_scope: 'human_evaluation',
      perception_constructs: ['safety', 'walkability', 'comfort'],
      visual_data_sources: ['google_street_view'],
      not_visual_data_sources: ['unspecified_street_view'],
      spatial_scales: ['street', 'neighborhood'],
      response_protocols: ['rating_scale'],
      measurement_channels: ['self_report'],
      study_countries: ['singapore'],
      study_regions: ['southeast_asia'],
    },
  },
  {
    id: 'street-view-not-scale',
    title: 'Deep-learning street-view study of coastal greenway',
    abstract:
      'Using street view imagery and machine learning, we predict runner perceptions along a coastal greenway. '
      + 'No human questionnaire was administered in this computational study.',
    keywords: [],
    expect: {
      analysis_scope: 'computational_only',
      visual_data_sources: ['unspecified_street_view'],
      not_spatial_scales: ['street'],
      response_protocols: [],
    },
  },
  {
    id: 'thermal-not-comfort',
    title: 'Thermal comfort in streetscapes',
    abstract: 'We measured thermal comfort in streetscapes using Likert ratings with 120 participants.',
    expect: {
      perception_constructs: ['thermal'],
      not_perception_constructs: ['comfort'],
      response_protocols: ['rating_scale'],
      spatial_scales: ['street'],
    },
  },
  {
    id: 'window-view-context',
    title: 'Window views and visual preference',
    abstract: 'Participants rated window views for visual preference using a rating scale.',
    expect: {
      view_contexts: ['window_view'],
      not_spatial_scales: ['window'],
      perception_constructs: ['preference'],
      response_protocols: ['rating_scale'],
    },
  },
  {
    id: 'cycling-survey-not-human',
    title: 'Noise from volunteer cycling surveys',
    abstract:
      'We model traffic noise using volunteer cycling surveys and machine learning on street view imagery. '
      + 'No human rating of perceived qualities was collected.',
    expect: {
      analysis_scope: 'computational_only',
      not_measurement_channels: ['self_report'],
      response_protocols: [],
    },
  },
  {
    id: 'crowd-sourced-data-not-recruitment',
    title: 'Crowd-sourced perception indicators',
    abstract:
      'Regression models explain travel behavior using crowd-sourced perception data derived from prior studies.',
    expect: {
      recruitment_modes: [],
      research_methods: ['regression'],
    },
  },
  {
    id: 'uk-not-europe-country',
    title: 'London streetscapes pairwise study',
    abstract: 'A UK study of street-level imagery in London using pairwise comparison with respondents.',
    expect: {
      study_countries: ['uk'],
      study_regions: ['europe'],
      not_study_countries: ['europe'],
      spatial_scales: ['street'],
      response_protocols: ['pairwise'],
      analysis_scope: 'human_evaluation',
    },
  },
  {
    id: 'field-survey-lidar',
    title: 'Field survey with LiDAR',
    abstract: 'A field survey using LiDAR scanners mapped roadside trees without human questionnaires.',
    expect: {
      recruitment_modes: [],
      not_measurement_channels: ['self_report'],
    },
  },
  {
    id: 'questionnaire-only-human',
    title: 'Online questionnaire of residents',
    abstract: 'An online questionnaire survey of residents about urban scenery and visual quality.',
    expect: {
      analysis_scope: 'human_evaluation',
      measurement_channels: ['self_report'],
      response_protocols: [],
      perception_constructs: ['aesthetics'],
    },
  },
  {
    id: 'image-n-not-sample',
    title: 'Large image corpus',
    abstract: 'We trained models on n=5000 streetscape images without recruiting participants.',
    expect: {
      sample_size: null,
      analysis_scope: 'computational_only',
    },
  },
];
