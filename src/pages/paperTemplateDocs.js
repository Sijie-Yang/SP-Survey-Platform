import { PAPER_TEMPLATE_CITATIONS } from './paperTemplateCitations';

/** Paper-template docs, in the same order as the studies behind the templates. */
export const PAPER_TEMPLATE_DOCS = [
  { id: '1990-nasar-evaluative', year: '1990', name: 'The Evaluative Image of the City via Map Annotation' },
  { id: '2009-ewing-measuring', year: '2009', name: 'Urban Design Qualities via Video Assessment' },
  { id: '2013-salesses-collaborative', year: '2013', name: 'Place Pulse 1.0' },
  { id: '2014-quercia-aesthetic', year: '2014', name: 'UrbanGems' },
  { id: '2014-naik-streetscore', year: '2014', name: 'Streetscore' },
  { id: '2016-dubey-place', year: '2016', name: 'Place Pulse 2.0' },
  { id: '2017-liu-machine', year: '2017', name: 'Facade Quality and Street-Wall Continuity' },
  { id: '2017-seresinhe-scenic', year: '2017', name: 'Scenic Beauty of Outdoor Places' },
  { id: '2019-yao-human', year: '2019', name: 'Human–Machine Scoring' },
  { id: '2021-ramirez-measuring', year: '2021', name: 'Heterogeneous Perception of Safety' },
  { id: '2021-ito-assessing', year: '2021', name: 'Bikeability Perception' },
  { id: '2021-kruse-places', year: '2021', name: 'Places for Play' },
  { id: '2022-qiu-subjective', year: '2022', name: 'Street Design Qualities (Shanghai)' },
  { id: '2023-kang-assessing', year: '2023', name: 'Safety Perception and Question Framing' },
  { id: '2023-torkko-how', year: '2023', name: 'Perceived Greenery In Situ' },
  { id: '2024-liang-building', year: '2024', name: 'Building Exterior Perception' },
  { id: '2025-yang-thermal', year: '2025', name: 'Thermal Comfort in Sight' },
  { id: '2025-gu-effective', year: '2025', name: 'Effective Perception Survey' },
  { id: '2025-li-street', year: '2025', name: 'Street Multi-Activity Potential' },
  { id: '2025-quintana-specs', year: '2025', name: 'SPECS' },
  { id: '2025-danish-citizen', year: '2025', name: 'Percept (Citizen Science)' },
  { id: '2026-quintana-greenery', year: '2026', name: 'Greenery Perception' },
  { id: '2026-peng-city', year: '2026', name: 'City Landscape In Sight' },
  { id: '2026-lopes-street-gsv', year: '2026', name: 'Street Intervention Before–After' },
  { id: '2026-kang-decoding', year: '2026', name: 'Safety Choice (Eye-Tracking Study)' },
  { id: '2027-wang-hotel-hue', year: '2027', name: 'Hotel Hue Preference by Time of Day' },
].map(doc => ({ ...doc, ...PAPER_TEMPLATE_CITATIONS[doc.id] }));

export const DEFAULT_DOC_ID = '2013-salesses-collaborative';

export function paperTemplateDoc(id) {
  return PAPER_TEMPLATE_DOCS.find((item) => item.id === id) || null;
}
