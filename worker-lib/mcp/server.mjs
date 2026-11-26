/**
 * Streamable HTTP MCP server for SP-Survey Platform.
 * Tools call Agent project handlers — never nested LLM orchestration.
 */

import { qsfToSurveyConfig } from '../../src/lib/qsfImport.js';
import { OPERATION_ITEM_SCHEMA } from '../platformSchema.generated.mjs';
import {
  acquireLease,
  applyProjectOperations,
  createProject,
  getDraft,
  handleAgentDiscovery,
  listProjects,
  listVersions,
  previewUrls,
  publishProject,
  releaseLease,
  rollbackProject,
  saveDraft,
  updateProjectMeta,
  validateProject,
} from '../agent/projectHandlers.mjs';
import {
  applyMainPage,
  createFromTemplate,
  deleteOwnedProject,
  deleteProjectMedia,
  duplicateProject,
  exportProject,
  getMediaDataset,
  getTemplate,
  importMediaFromTemplate,
  importProject,
  listProjectMedia,
  listTemplates,
  saveAsTemplate,
  updateMediaDataset,
  uploadProjectMedia,
} from '../agent/projectLifecycle.mjs';
import {
  deleteResponse,
  exportResponses,
  listResponses,
  summarizeResponses,
} from '../agent/resultsHandlers.mjs';
import {
  getSkill,
  listSkills,
  saveSkill,
} from '../agent/skillHandlers.mjs';
import { DESIGN_CAPABILITIES } from '../designProtocol.mjs';
import { buildSkillAnalysisGuideText, skillAnalysisGuideBlurb } from '../agent/skillAnalysisGuide.mjs';
import { getCredentialStatus } from '../agent/credentials.mjs';
import { supabaseRest } from '../supabaseUserClient.mjs';
import {
  listSiliconResponses,
  listSiliconResponsesService,
  listSiliconRuns,
  listSiliconRunsService,
  siliconRunProjectId,
} from '../silicon/handlers.mjs';
import { normalizeProjectMetadata, metadataFromRow, projectCardFromRow } from '../agent/projectMeta.mjs';
import {
  MAX_IMPORT_MEDIA_FILES,
  MAX_STAGED_BYTES,
  MAX_STAGED_UPLOADS,
  MAX_UNZIPPED_BYTES,
  createSpSchemeUploadUrl,
  importSpScheme,
  spSchemeSpec,
} from '../agent/spSchemeAgent.mjs';
import { DOWNLOAD_MAX_JSON_BYTES, DOWNLOAD_MAX_ROWS, createDownloadUrl } from '../agent/resultsDownload.mjs';
import { isPlatformAdmin, loadOwned, publishTemplate } from '../agent/projectLifecycle.mjs';
import { checkPublishMedia } from '../../src/lib/publishMediaCheck.mjs';
import { listNews, listWiki, saveNewsDraft, submitWiki } from '../research/siteContent.mjs';
import { listTemplateFacets, saveTemplateFacets } from '../research/templateTags.mjs';
import { listPapers, PAPER_STATUSES, SAVE_MAX as PAPER_SAVE_MAX, savePapers } from '../research/paperLibrary.mjs';
import { keepStoredSiteHtml, trimResultSiteHtml } from '../agent/siteDraft.mjs';
import { sameDraftStamp } from '../agent/projectHandlers.mjs';

const MB = (bytes) => `${Math.round(bytes / 1048576)} MB`;

function mcpCtx(auth) {
  if (auth.kind === 'mcp') {
    return { userId: auth.userId, serviceRole: true };
  }
  return { userId: auth.userId, accessToken: auth.accessToken, serviceRole: false };
}

function toolResult(data, isError = false) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
    isError,
  };
}

function requireScope(auth, scope) {
  if (auth.kind === 'supabase') return;
  const scopes = auth.scopes || [];
  if (!scopes.includes(scope)) {
    const err = new Error(`Missing scope: ${scope}`);
    err.code = 'insufficient_scope';
    err.status = 403;
    throw err;
  }
}

/** Mint a short-lived user JWT is not available for MCP opaque tokens.
 * For MCP tokens we use service-role REST filtered by user_id. */
async function ensureAccessToken(env, auth) {
  if (auth.accessToken) return auth.accessToken;
  // MCP opaque token path: use service role with ownership checks in handlers
  // by wrapping a synthetic access via service role + user filter helpers.
  return null;
}

async function withUserScopedClient(env, auth, fn) {
  if (auth.accessToken) {
    return fn(auth.accessToken, false);
  }
  // Service-role path for MCP tokens: handlers must filter by auth.userId
  return fn(null, true);
}

async function listOwnedViaService(env, userId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=id,name,description,metadata,updated_at,draft_updated_at,published_at,published_version,last_writer,template_id&order=updated_at.desc`,
  });
  return {
    success: true,
    projects: (rows || []).map((row) => ({
      ...projectCardFromRow(row),
      updatedAt: row.updated_at,
      lastWriter: row.last_writer || null,
    })),
  };
}

const TOOLS = [
  {
    name: 'survey_capabilities',
    description:
      'Read how to work with SP-Survey. spSchemeWorkflow comes first: the recommended way to run a study is one SP-Scheme web page '
      + '(sp_scheme_spec → sp_scheme_import → survey_publish → share links.participant → survey_download_url). '
      + 'Also returns design rules, the FULL question-type catalog (image*/media*/skillquestion presets + examples), operations, and scopes for classic per-question editing. '
      + 'Includes MEDIA SOURCE RULES: never AI-generate media to upload; use template import / project pool / preview media library.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sp_scheme_spec',
    description:
      'START HERE for a new study. Returns the SP-Scheme spec (text): how to build the whole study as one web page (index.html) that the platform records and analyses, '
      + 'plus the 5-step recipe (steps): build the page → sp_scheme_import → fix any problems → survey_publish → survey_download_url.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sp_scheme_upload_url',
    description:
      `Get a signed PUT link (30 minutes) for a zip holding index.html and the files it uses (images/…), or a large index.html: at most ${MB(MAX_STAGED_BYTES)}, `
      + `and a zip may expand to at most ${MB(MAX_UNZIPPED_BYTES)} with at most ${MAX_IMPORT_MEDIA_FILES} media files. `
      + 'Run the returned curl line (it sends Content-Length, which the link requires), then call sp_scheme_import with { uploadId }. Keeps file bytes out of the chat. '
      + `Needs surveys:write and media:write. Only your ${MAX_STAGED_UPLOADS} most recent staged uploads are kept.`,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sp_scheme_import',
    description:
      'Import an SP-Scheme page as a study, with the same check as SP-Survey Studio. Pass exactly one of html (the page as text) or uploadId (a zip or page staged with sp_scheme_upload_url). '
      + 'Without projectId a new project is created (name, else the page title); with projectId the page of that owned project is replaced. '
      + 'The zip\'s stimulus files go to the project media library in their folders. A file is known by its exact folder and file name, as in Studio: on a re-import, a file of the same size is left as it is (not uploaded), and one of another or unrecorded size replaces the old entry, whose file is deleted unless the published version still uses it (media.new / replaced / unchanged). '
      + 'When the page does not pass the check, nothing is written: the reply has imported:false and the problems to fix. '
      + 'When an import fails after it started writing, what it wrote is removed again; if that cleanup fails too, the error says "cleanup incomplete". '
      + 'A page that does not follow SP-Scheme is imported as it is (answers recorded, not analysed); summary says so. '
      + 'allowHosts (optional) lists exactly the external hosts the page may load scripts/styles from (default: the ones it needs). '
      + 'With projectId, pass expectedDraftUpdatedAt (from survey_get_draft or the last import) so edits you have not seen are not overwritten; it is required once the project is published. '
      + `Limits: ${MAX_IMPORT_MEDIA_FILES} media files and ${MB(MAX_UNZIPPED_BYTES)} unzipped. `
      + 'Returns summary, links { studio, preview, participant } and draftUpdatedAt for survey_publish.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Owned project whose page to replace. Omit to create a new project.' },
        expectedDraftUpdatedAt: { type: 'string', description: 'With projectId: the draftUpdatedAt you last saw. Required for a published project.' },
        name: { type: 'string', description: 'Name for a new project (default: the page title).' },
        html: { type: 'string', description: 'The whole index.html as text (single-file pages).' },
        uploadId: { type: 'string', description: 'From sp_scheme_upload_url, after the curl upload.' },
        allowHosts: { type: 'array', items: { type: 'string' }, description: 'Host names the page may load scripts and styles from.' },
      },
    },
  },
  {
    name: 'survey_download_url',
    description:
      'Get a signed GET link (15 minutes) to download all data of a project you own as one ZIP for analysis: README.txt (what every file and column means), '
      + 'responses_wide.csv, responses_raw.json, stimuli.csv, survey.json, page.html (for pages), references.bib, CITATION.cff. '
      + 'Same rows as Studio and the Results page: silicon runs never; the researcher\'s practice runs with includePractice:true, or when the survey itself includes them (includeResearcherPractice). '
      + `At most ${DOWNLOAD_MAX_ROWS} responses and ${MB(DOWNLOAD_MAX_JSON_BYTES)} of response data per download; larger projects use the CSV export on the Results page in the site. `
      + 'Only the project owner can get a link. Run the returned curl line.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        includePractice: { type: 'boolean', description: 'Include the researcher\'s own practice runs (default false; they are always included when the survey sets includeResearcherPractice).' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'template_publish',
    description:
      'PLATFORM ADMINS ONLY (checked on the server), and only for a project the admin owns. Publish it directly as an approved template (shown in the homepage library unless showOnLanding:false), '
      + 'or, with templateId and overwrite:true, overwrite that template from the project (survey config, details and media). Templates are stored online; no repository sync is needed. '
      + 'Everyone else uses survey_save_as_template (admin review). Needs surveys:publish and confirm:true. '
      + 'Media are copied to the template first; a large library can take more than one call: when the reply has status "copying", call again with the same arguments until it is published.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        templateId: { type: 'string', description: 'Existing template to overwrite (needs overwrite:true). Omit to create a new one.' },
        overwrite: { type: 'boolean', description: 'Required with templateId: confirms that the template is replaced.' },
        name: { type: 'string' },
        description: { type: 'string' },
        author: { type: 'string' },
        year: { type: 'string' },
        category: { type: 'string' },
        paperUrl: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        showOnLanding: { type: 'boolean', description: 'Show it in the homepage template library (default true).' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'name', 'author', 'year', 'confirm'],
    },
  },
  {
    name: 'template_tags',
    description:
      'PLATFORM ADMINS ONLY. Read or set the classification tags of published templates, used by the /templates filters. '
      + 'Dimensions: source (paper | ai | demo, one), modality, task, concept, participants, sample (one), country and city (free text). '
      + 'Without templates: lists every approved template with its tags and the allowed values. With templates: each item sets the named '
      + 'dimensions for one template (replacing that dimension\'s values unless merge:true); other dimensions and other tags stay. Needs surveys:publish and confirm:true to write.',
    inputSchema: {
      type: 'object',
      properties: {
        templates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              templateId: { type: 'string' },
              facets: { type: 'object', description: 'e.g. {"task":["pairwise"],"concept":["safety","greenery"],"city":["Berlin"]}' },
              merge: { type: 'boolean', description: 'Add values instead of replacing them.' },
            },
            required: ['templateId', 'facets'],
          },
        },
        confirm: { type: 'boolean' },
      },
    },
  },
  {
    name: 'paper_list',
    description:
      'PLATFORM ADMINS ONLY. Read the paper library (shown on /papers when status is "approved"; "candidate" papers, including the weekly scan\'s, wait for review). '
      + 'Filter by search (words in the title), doi, status, templateId, or linked (true: has a template, false: none). Up to 200 per call; page with offset. Needs surveys:read.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Words in the title.' },
        doi: { type: 'string' },
        status: { type: 'string', enum: PAPER_STATUSES },
        templateId: { type: 'string' },
        linked: { type: 'boolean' },
        reviewed: { type: 'boolean', description: 'true: facets were saved by an admin; false: still guessed from keywords.' },
        detail: { type: 'boolean', description: 'Also return each abstract and its current facets (for tagging).' },
        limit: { type: 'number', description: 'Default 50, at most 200.' },
        offset: { type: 'number' },
      },
    },
  },
  {
    name: 'paper_save',
    description:
      `PLATFORM ADMINS ONLY. Add or update up to ${PAPER_SAVE_MAX} papers in the paper library. Each paper is found by id, else DOI, else exact title + year; `
      + 'a found paper gets only the fields you give, a new one needs a title and starts as "candidate" unless you give status. '
      + 'status "approved" shows it on /papers. templateId links the paper to an existing template (that is how a template and its paper are aligned; use "" to unlink). '
      + 'Take DOI, authors, year and venue from the paper or Crossref, never from memory. Every paper is reported as inserted, updated or error. Needs surveys:publish and confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        papers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Existing paper id (to change its DOI or title).' },
              doi: { type: 'string' },
              title: { type: 'string' },
              authors: { type: 'array', items: { type: 'string' } },
              year: { type: 'number' },
              venue: { type: 'string' },
              abstract: { type: 'string' },
              paperUrl: { type: 'string' },
              keywords: { type: 'array', items: { type: 'string' } },
              status: { type: 'string', enum: PAPER_STATUSES },
              templateId: { type: 'string' },
              facets: {
                type: 'object',
                description: 'Tags from reading the paper, same vocabulary as template_tags (no source): '
                  + '{"survey":"yes"|"no", "concept":[...], "task":[...], "modality":[...], "participants":[...], "sample":["lt100"|"100to1000"|"gt1000"], "country":["China"], "city":["Wuhan"]}. '
                  + 'Leave a dimension empty when the paper does not say it. Replaces earlier facets; null removes them.',
              },
            },
          },
        },
        confirm: { type: 'boolean' },
      },
      required: ['papers', 'confirm'],
    },
  },
  {
    name: 'news_list',
    description: 'PLATFORM ADMINS ONLY. List news posts (drafts, published, archived), newest change first. Needs surveys:read.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'published', 'archived'] },
        limit: { type: 'number', description: 'Default 30, at most 100.' },
      },
    },
  },
  {
    name: 'news_save',
    description:
      'PLATFORM ADMINS ONLY. Save a news post (English required, Chinese optional, Markdown body) as a DRAFT; an admin publishes it in 平台管理 → News. '
      + 'With id or an existing slug the same post is updated. A published post is changed only with confirmLive:true, when Peter asked for that edit in the chat; it stays published. '
      + 'Never state facts you have not checked (e.g. say a paper is under review unless it is published). Needs surveys:publish and confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        slug: { type: 'string', description: 'URL name; default from titleEn.' },
        titleEn: { type: 'string' },
        titleZh: { type: 'string' },
        summaryEn: { type: 'string' },
        summaryZh: { type: 'string' },
        bodyEn: { type: 'string', description: 'Markdown.' },
        bodyZh: { type: 'string', description: 'Markdown.' },
        coverUrl: { type: 'string', description: 'https image URL, e.g. a template image on media.sp-survey.org.' },
        confirmLive: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
      required: ['titleEn', 'bodyEn', 'confirm'],
    },
  },
  {
    name: 'model_bench_routes',
    description: 'PLATFORM ADMINS ONLY. Which providers and models the admin can bench for the built-in Assistant\'s SP-Scheme page writer (own keys and free-model routes), and the fixed study descriptions every model gets. Needs surveys:read.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'model_bench_start',
    description: 'PLATFORM ADMINS ONLY. Run the fixed study descriptions through one model with the production page writer (Studio import check + repair rounds) on the server, keys never leave it. Pass the same benchId to put several models in one bench. Results arrive in a few minutes: model_bench_result. Uses the model provider\'s quota. Needs surveys:publish and confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string' },
        model: { type: 'string' },
        prompts: { type: 'array', items: { type: 'string' }, description: 'Description ids (default: all).' },
        benchId: { type: 'string', description: 'Existing bench to add this model to (lowercase letters, digits, dashes).' },
        confirm: { type: 'boolean' },
      },
      required: ['provider', 'model', 'confirm'],
    },
  },
  {
    name: 'model_bench_result',
    description: 'PLATFORM ADMINS ONLY. Results of a model bench: per model and description, passed, first try, repair rounds, question count, problems, time and token use. includeHtml {promptId, model} also returns that page. Needs surveys:read.',
    inputSchema: {
      type: 'object',
      properties: {
        benchId: { type: 'string' },
        includeHtml: { type: 'object', properties: { promptId: { type: 'string' }, model: { type: 'string' } } },
      },
      required: ['benchId'],
    },
  },
  {
    name: 'wiki_list',
    description: 'PLATFORM ADMINS ONLY. List SP-Wiki pages online (/docs/<page_key>), the built-in page keys, and wiki submissions with their status, to decide whether to add a page, edit one, or revise a submission. Needs surveys:read.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wiki_submit',
    description:
      'PLATFORM ADMINS ONLY. Propose an SP-Wiki page in one language (Markdown): a new page, an edit of an existing page (pageKey), or a revision of a waiting submission (submissionId). '
      + 'It is saved as a pending submission; an admin approves it in 平台管理 → Doc / News 审核, which publishes it. Write one page per language. Needs surveys:publish and confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['en', 'zh'] },
        title: { type: 'string' },
        summary: { type: 'string' },
        body: { type: 'string', description: 'Markdown, 20 to 80,000 characters.' },
        changeReason: { type: 'string', description: 'Why the page or edit is needed (at least 10 characters).' },
        sourceNotes: { type: 'string', description: 'Sources: DOIs, links.' },
        pageKey: { type: 'string', description: 'Existing page to edit.' },
        submissionId: { type: 'string', description: 'Waiting submission to revise.' },
        templateId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['language', 'title', 'body', 'changeReason', 'confirm'],
    },
  },
  {
    name: 'survey_list_projects',
    description: 'List projects owned by the authenticated user.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'survey_create_project',
    description: 'Create a new survey project. The share / live URL follows this config immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        surveyConfig: { type: 'object' },
      },
      required: ['name'],
    },
  },
  {
    name: 'survey_update_project',
    description: 'Update project you own: name, description, and metadata (author, year, category, tags, website, huggingfaceDataset).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        author: { type: 'string' },
        year: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        website: { type: 'string' },
        huggingfaceDataset: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_delete_project',
    description: 'Permanently delete a project you own (DB row + R2 media prefix when configured). Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'survey_duplicate_project',
    description: 'Duplicate an owned project (config + metadata). Optional copyMedia:true copies R2 files.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        copyMedia: { type: 'boolean' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_export_project',
    description: 'Export an owned project as a sanitized JSON package (project + surveyConfig + metadata).',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_import_project',
    description: 'Import a previously exported project package into a new owned project.',
    inputSchema: {
      type: 'object',
      properties: {
        package: { type: 'object' },
        name: { type: 'string' },
        description: { type: 'string' },
        surveyConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'survey_import_qualtrics',
    description: 'Create a new project from a Qualtrics survey file (.qsf, passed as its JSON object or text). Common question types are converted deterministically; the result includes qualtricsReport listing questions not converted and logic to rebuild (display logic, randomizers, piped text).',
    inputSchema: {
      type: 'object',
      properties: {
        qsf: { description: 'The .qsf file content: a JSON object or a JSON string.' },
        name: { type: 'string', description: 'Project name (default: the Qualtrics survey name).' },
      },
      required: ['qsf'],
    },
  },
  {
    name: 'survey_list_templates',
    description: 'List approved templates plus your own pending template submissions.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'survey_get_template',
    description: 'Read one template (metadata, sanitized surveyConfig, and media: how many images it has and where they are served from).',
    inputSchema: {
      type: 'object',
      properties: { templateId: { type: 'string' } },
      required: ['templateId'],
    },
  },
  {
    name: 'survey_create_from_template',
    description: 'Create a new project from a template (does not auto-copy template media).',
    inputSchema: {
      type: 'object',
      properties: {
        templateId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['templateId'],
    },
  },
  {
    name: 'survey_save_as_template',
    description: 'Submit an owned project as a template for admin review. Requires confirm:true. Copies R2 media when configured.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        confirm: { type: 'boolean' },
        name: { type: 'string' },
        description: { type: 'string' },
        author: { type: 'string' },
        year: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'survey_apply_main_page',
    description: 'Apply to Publish to Main Page (live listing pending admin review). Requires confirm:true. Not the same as survey_publish version snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        confirm: { type: 'boolean' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        author: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        onlineStart: { type: 'string', description: 'ISO datetime' },
        onlineEnd: { type: 'string', description: 'ISO datetime' },
      },
      required: ['projectId', 'confirm', 'onlineStart', 'onlineEnd'],
    },
  },
  {
    name: 'media_list',
    description: 'List media objects and preloadedImages for an owned project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'media_import_from_template',
    description:
      'PREFERRED way to seed project media: copy an existing published template\'s R2 media into an owned project. '
      + 'Use this instead of generating or uploading synthetic images. A large template is copied over several calls: '
      + 'when the reply has remaining > 0, call it again (copied files are skipped). Publish again afterwards. Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        templateId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'confirm'],
    },
  },
  {
    name: 'media_delete',
    description: 'Delete specific R2 keys under an owned project prefix. Requires confirm:true.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        keys: { type: 'array', items: { type: 'string' } },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'keys', 'confirm'],
    },
  },
  {
    name: 'media_upload',
    description:
      'LAST RESORT: upload one REAL media file (base64) the researcher explicitly provided. Max 8MB decoded. '
      + 'DO NOT use for AI-generated, DALL·E/Midjourney/synthetic, or placeholder images. '
      + 'Prefer media_import_from_template, existing project Media Dataset, or ask the user to use Admin → 预览媒体库. '
      + 'Optional folder + updatePreloaded (default true).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        filename: { type: 'string' },
        data: { type: 'string', description: 'Base64 file bytes (data: URL prefix allowed) — real researcher file only' },
        folder: { type: 'string' },
        contentType: { type: 'string' },
        updatePreloaded: { type: 'boolean' },
      },
      required: ['projectId', 'filename', 'data'],
    },
  },
  {
    name: 'survey_get_media_dataset',
    description: 'Read Media Dataset folder tags (mediaFolderTags set/category) for an owned project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_update_media_dataset',
    description: 'Update Media Dataset folder tags/folders for set/category assignment modes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        mediaFolderTags: { type: 'object', description: 'Map folder path → "set" | "category"' },
        mediaFolders: { type: 'array', items: { type: 'string' } },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'skill_list',
    description: 'List approved public skills plus your private skill library.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'skill_get',
    description: 'Get one skill (sourceHtml when approved or owned by you).',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string' },
        revision: { type: 'number', description: 'Optional immutable revision; defaults to current.' },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'skill_save',
    description:
      'Create or update a private skill. Requires confirm:true. '
      + 'HARD RULES (save is rejected if violated): sourceHtml MUST call SPSkill.setAnswer(...); '
      + 'MUST use spskill-init or SPSkill.getConfig/getImages; NEVER parent.postMessage skill-result aliases; '
      + 'ONE focused task per skill (do not pack attention_map+route_trace+budget_lab+… into one HTML); '
      + 'configSchema/resultSchema must be arrays of {key,label,type} objects. '
      + 'YOU pick resultSchema[].type: rating scale→rating; numeric/count→number|count; annotation→points|path|polygon|bbox; '
      + 'media→rating/number/boolean/scaleGroup/mediaChoice/mediaRankedList/mediaMatrix+imageUrl; '
      + 'text→choice/text/rankedList/allocation; composite ratings/words/choice/text→compositeBlocks; color→color; forced comparison→pairwiseChoice; slider comparison→pairwisePreference. '
      + 'Every field MUST map exactly to an existing native question/results/export family. json, legacy pairwise, and analysisHtml are rejected for new revisions. '
      + 'Declare exactly one resultSchema field per Skill; use compositeBlocks or separate Skills when appropriate. '
      + 'Include native settings (options/rows/columns/dimensions/min/max/budget) in resultSchema. '
      + 'Include imageUrl in answers for per-stimulus grouping. '
      + 'Prefer preset_* skillquestion when a preset fits. Does not submit for public review.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        sourceHtml: { type: 'string' },
        configSchema: { type: 'array' },
        defaultConfig: { type: 'object' },
        resultSchema: {
          type: 'array',
          description: '[{key,label,type}] — type from catalog so analysis/export match native question types.',
        },
        exampleAnswer: {
          type: 'object',
          description: 'Required non-empty object matching resultSchema; used to validate the result contract.',
        },
        confirm: { type: 'boolean' },
      },
      required: ['name', 'sourceHtml', 'resultSchema', 'exampleAnswer', 'confirm'],
    },
  },
  {
    name: 'survey_list_responses',
    description: 'List survey response summaries for an owned project (results:read). Optional includeAnswers for full answer payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        includePractice: { type: 'boolean' },
        includeAnswers: { type: 'boolean' },
        dataSource: { type: 'string', enum: ['human', 'practice', 'silicon'] },
        siliconRunId: { type: 'string' },
        excludeFlagged: { type: 'boolean' },
        dateFrom: { type: 'string', description: 'YYYY-MM-DD' },
        dateTo: { type: 'string', description: 'YYYY-MM-DD' },
        timezone: { type: 'string' },
        sessionId: { type: 'string' },
        surveyRevision: { type: 'string', description: 'Recorded questionnaire revision; typed exports and summaries automatically select one version when revisions differ.' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_export_responses',
    description: 'Export owned project responses as JSON, wide/long/summary CSV, a typed per-question analysis bundle, or the citable dataset package (README, LICENSE, CITATION.cff, datapackage.json, anonymised data) (results:read).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        format: { type: 'string', enum: ['json', 'wide_csv', 'both', 'long_csv', 'summary_csv', 'analysis_bundle', 'dataset_package'] },
        questionName: { type: 'string', description: 'Optional single-question filter.' },
        dataSource: { type: 'string', enum: ['human', 'practice', 'silicon'] },
        siliconRunId: { type: 'string' },
        includePractice: { type: 'boolean' },
        excludeFlagged: { type: 'boolean' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        timezone: { type: 'string' },
        sessionId: { type: 'string' },
        surveyRevision: { type: 'string', description: 'Recorded questionnaire revision; typed exports and summaries automatically select one version when revisions differ.' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_results_summary',
    description: 'Typed results summary with per-question contract/revision, n_answered, summary rows, and fallback warnings (results:read).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        view: { type: 'string', enum: ['overview', 'question'] },
        dataSource: { type: 'string', enum: ['human', 'practice', 'silicon'] },
        siliconRunId: { type: 'string' },
        includePractice: { type: 'boolean' },
        excludeFlagged: { type: 'boolean' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
        timezone: { type: 'string' },
        sessionId: { type: 'string' },
        surveyRevision: { type: 'string', description: 'Recorded questionnaire revision; typed exports and summaries automatically select one version when revisions differ.' },
        questionName: { type: 'string' },
        dimensionId: { type: 'string' },
        mediaKey: { type: 'string' },
        catalogOffset: { type: 'number' },
        catalogLimit: { type: 'number' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_delete_response',
    description: 'Delete one survey response for an owned project. Requires confirm:true and surveys:write.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        responseId: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'responseId', 'confirm'],
    },
  },
  {
    name: 'survey_get_draft',
    description: 'Read a project draft and draftUpdatedAt concurrency token. An imported page (spSite.html) is shown as { id, bytes, note } to keep this small; survey_replace_draft keeps the stored page while spSite.id is unchanged, and sp_scheme_import replaces it.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_validate',
    description: 'Validate a surveyConfig or the current project draft.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        surveyConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'survey_apply_operations',
    description: 'Apply deterministic survey operations. Saves update the draft. Version-managed projects require survey_publish to update the participant link.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        operations: { type: 'array', items: OPERATION_ITEM_SCHEMA },
        expectedDraftUpdatedAt: { type: 'string', description: 'Required optimistic concurrency token from survey_get_draft.draftUpdatedAt' },
        clientMutationId: { type: 'string' },
      },
      required: ['projectId', 'operations', 'expectedDraftUpdatedAt'],
    },
  },
  {
    name: 'survey_replace_draft',
    description: 'Replace the full surveyConfig (escape hatch). Saves update the draft. Version-managed projects require survey_publish to update the participant link. '
      + 'An imported page (spSite) is kept while spSite.id is unchanged (its html and allowedHosts always come from storage) and removed when spSite is left out; only sp_scheme_import can change the page.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        surveyConfig: { type: 'object' },
        expectedDraftUpdatedAt: { type: 'string', description: 'Required optimistic concurrency token from survey_get_draft.draftUpdatedAt' },
        clientMutationId: { type: 'string' },
      },
      required: ['projectId', 'surveyConfig', 'expectedDraftUpdatedAt'],
    },
  },
  {
    name: 'survey_acquire_lease',
    description: 'Acquire an edit lease so the in-browser assistant does not overwrite your edits from this AI client.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        sessionId: { type: 'string' },
        ttlMinutes: { type: 'number' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_release_lease',
    description: 'Release an edit lease.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        sessionId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_preview_urls',
    description: 'Get the links of a project: participant (the link to share; the custom /s/<slug> link when set), studio (the owner\'s project page with preview, media, link and data), admin and liveSurvey.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_publish',
    description: 'Release the saved draft and media manifest to the participant link, enabling version management. Review the draft first. Returns links.participant (the link to share) and links.studio. Homepage listing still uses Publish to Main Page in Admin.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        summary: { type: 'string' },
        expectedDraftUpdatedAt: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'expectedDraftUpdatedAt', 'confirm'],
    },
  },
  {
    name: 'survey_list_versions',
    description: 'List published versions for rollback.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'survey_rollback',
    description: 'Rollback published config to a previous version.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        version: { type: 'number' },
        expectedDraftUpdatedAt: { type: 'string' },
        confirm: { type: 'boolean' },
      },
      required: ['projectId', 'version', 'expectedDraftUpdatedAt', 'confirm'],
    },
  },
  {
    name: 'silicon_list_runs',
    description: 'List the silicon-sample (AI respondent) pretest runs of an owned project, newest first (results:read). Read-only; runs are started in the browser.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'silicon_run_responses',
    description: 'Read the answers of one silicon-sample run of an owned project (results:read). Silicon answers are for pretesting and never replace human data.',
    inputSchema: {
      type: 'object',
      properties: { runId: { type: 'string' } },
      required: ['runId'],
    },
  },
  {
    name: 'credentials_status',
    description: 'Check whether a Platform Assistant API key is configured (never returns the key).',
    inputSchema: { type: 'object', properties: {} },
  },
];

/** Tools only platform admins can use: hidden from everyone else in tools/list (the server checks again on every call). */
export const ADMIN_ONLY_TOOLS = new Set(['template_publish', 'template_tags', 'paper_list', 'paper_save', 'news_list', 'news_save', 'wiki_list', 'wiki_submit', 'model_bench_routes', 'model_bench_start', 'model_bench_result']);

// title + hints for every tool (MCP tool annotations; the Claude connector directory requires them).
// read: only reads. destructive: may overwrite or delete what is already there. All tools act on SP-Survey only (openWorldHint false).
const READ = { readOnlyHint: true, destructiveHint: false };
const ADD = { readOnlyHint: false, destructiveHint: false };
const CHANGE = { readOnlyHint: false, destructiveHint: true };
const TOOL_ANNOTATIONS = {
  survey_capabilities: ['Read how to use SP-Survey', READ],
  sp_scheme_spec: ['Get the SP-Scheme page spec', READ],
  sp_scheme_upload_url: ['Get an upload link for a study page or zip', ADD],
  sp_scheme_import: ['Import a study page (SP-Scheme)', CHANGE],
  survey_download_url: ['Get a download link for study data', READ],
  template_publish: ['Publish a project as a template (admin)', CHANGE],
  template_tags: ['Read or set template classification tags (admin)', CHANGE],
  paper_list: ['List papers in the paper library (admin)', READ],
  model_bench_routes: ['List models an admin can bench (admin)', READ],
  model_bench_start: ['Bench a model on SP-Scheme pages (admin)', ADD],
  model_bench_result: ['Read model bench results (admin)', READ],
  paper_save: ['Save papers to the paper library (admin)', CHANGE],
  news_list: ['List news posts (admin)', READ],
  news_save: ['Save a news draft (admin)', CHANGE],
  wiki_list: ['List SP-Wiki pages (admin)', READ],
  wiki_submit: ['Submit an SP-Wiki page for review (admin)', ADD],
  survey_list_projects: ['List my projects', READ],
  survey_create_project: ['Create a survey project', ADD],
  survey_update_project: ['Update project details', CHANGE],
  survey_delete_project: ['Delete a project', CHANGE],
  survey_duplicate_project: ['Duplicate a project', ADD],
  survey_export_project: ['Export a project package', READ],
  survey_import_project: ['Import a project package', ADD],
  survey_import_qualtrics: ['Import a Qualtrics survey (.qsf)', ADD],
  survey_list_templates: ['List templates', READ],
  survey_get_template: ['Read a template', READ],
  survey_create_from_template: ['Create a project from a template', ADD],
  survey_save_as_template: ['Submit a project as a template', ADD],
  survey_apply_main_page: ['Apply to list a survey on the homepage', ADD],
  media_list: ['List project media', READ],
  media_import_from_template: ['Copy template media into a project', ADD],
  media_delete: ['Delete project media files', CHANGE],
  media_upload: ['Upload a media file', ADD],
  survey_get_media_dataset: ['Read media folder tags', READ],
  survey_update_media_dataset: ['Update media folder tags', CHANGE],
  skill_list: ['List custom question skills', READ],
  skill_get: ['Read a custom question skill', READ],
  skill_save: ['Save a custom question skill', CHANGE],
  survey_list_responses: ['List survey responses', READ],
  survey_export_responses: ['Export survey responses', READ],
  survey_results_summary: ['Summarise survey results', READ],
  survey_delete_response: ['Delete a survey response', CHANGE],
  survey_get_draft: ['Read a project draft', READ],
  survey_validate: ['Check a survey for problems', READ],
  survey_apply_operations: ['Edit survey questions', CHANGE],
  survey_replace_draft: ['Replace the whole survey draft', CHANGE],
  survey_acquire_lease: ['Start an edit lease', ADD],
  survey_release_lease: ['End an edit lease', ADD],
  survey_preview_urls: ['Get project links', READ],
  survey_publish: ['Publish the survey to the participant link', CHANGE],
  survey_list_versions: ['List published versions', READ],
  survey_rollback: ['Roll back to a published version', CHANGE],
  silicon_list_runs: ['List AI-respondent pretest runs', READ],
  silicon_run_responses: ['Read AI-respondent pretest answers', READ],
  credentials_status: ['Check the assistant API key status', READ],
};

export function toolAnnotations(name) {
  const entry = TOOL_ANNOTATIONS[name];
  if (!entry) return null;
  const [title, hints] = entry;
  return { title, ...hints, openWorldHint: false };
}

/** The tool list a caller sees: admin tools only for platform admins. */
export async function listToolsFor(env, auth) {
  let admin = false;
  try {
    admin = await isPlatformAdmin(env, auth?.userId);
  } catch {
    admin = false;
  }
  return TOOLS
    .filter((t) => admin || !ADMIN_ONLY_TOOLS.has(t.name))
    .map((t) => {
      const annotations = toolAnnotations(t.name);
      return {
        name: t.name,
        ...(annotations ? { title: annotations.title } : {}),
        description: t.description,
        inputSchema: t.inputSchema,
        ...(annotations ? { annotations } : {}),
      };
    });
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

async function callTool(env, auth, request, name, args = {}) {
  // For MCP opaque tokens without a Supabase JWT, use service-role helpers
  // that always filter by auth.userId.
  const useService = auth.kind === 'mcp';

  switch (name) {
    case 'survey_capabilities':
      return toolResult({
        ...(await handleAgentDiscovery(request, env)),
        capabilities: DESIGN_CAPABILITIES,
        skillAnalysisGuide: buildSkillAnalysisGuideText(),
        skillAnalysisGuideBlurb: skillAnalysisGuideBlurb(),
      });
    case 'sp_scheme_spec': {
      requireScope(auth, 'surveys:read');
      return toolResult(spSchemeSpec());
    }
    case 'sp_scheme_upload_url': {
      requireScope(auth, 'surveys:write');
      requireScope(auth, 'media:write');
      return toolResult(await createSpSchemeUploadUrl(env, mcpCtx(auth), request));
    }
    case 'sp_scheme_import': {
      requireScope(auth, 'surveys:write');
      requireScope(auth, 'media:write');
      return toolResult(await importSpScheme(env, mcpCtx(auth), args, request));
    }
    case 'survey_download_url': {
      requireScope(auth, 'results:read');
      return toolResult(await createDownloadUrl(env, mcpCtx(auth), args, request));
    }
    case 'template_publish': {
      requireScope(auth, 'surveys:publish');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to publish this project as a template.' }, true);
      if (args.templateId != null && args.templateId !== '' && args.overwrite !== true) {
        return toolResult({ error: `This replaces the template ${String(args.templateId).slice(0, 96)} (its survey, details and media) for everyone. Set overwrite:true to do that, or leave templateId out to publish a new template.`, code: 'OVERWRITE_REQUIRED' }, true);
      }
      return toolResult(await publishTemplate(env, mcpCtx(auth), args.projectId, args, request));
    }
    case 'template_tags': {
      const writes = Array.isArray(args.templates) && args.templates.length > 0;
      requireScope(auth, writes ? 'surveys:publish' : 'surveys:read');
      if (!(await isPlatformAdmin(env, auth.userId))) return toolResult({ error: 'Only platform admins can change template tags.', code: 'ADMIN_ONLY' }, true);
      if (!writes) return toolResult(await listTemplateFacets(env));
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to save these tags.' }, true);
      const saved = await saveTemplateFacets(env, args.templates);
      return toolResult(saved, saved.updated === 0);
    }
    case 'paper_list': {
      requireScope(auth, 'surveys:read');
      if (!(await isPlatformAdmin(env, auth.userId))) return toolResult({ error: 'Only platform admins can read the paper library here.', code: 'ADMIN_ONLY' }, true);
      return toolResult(await listPapers(env, args));
    }
    case 'paper_save': {
      requireScope(auth, 'surveys:publish');
      if (!(await isPlatformAdmin(env, auth.userId))) return toolResult({ error: 'Only platform admins can change the paper library.', code: 'ADMIN_ONLY' }, true);
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to save these papers.' }, true);
      const saved = await savePapers(env, mcpCtx(auth), args.papers);
      return toolResult(saved, saved.errors > 0 && saved.inserted + saved.updated === 0);
    }
    case 'news_list':
    case 'news_save':
    case 'wiki_list':
    case 'wiki_submit': {
      const writes = name === 'news_save' || name === 'wiki_submit';
      requireScope(auth, writes ? 'surveys:publish' : 'surveys:read');
      if (!(await isPlatformAdmin(env, auth.userId))) return toolResult({ error: 'Only platform admins can use news and wiki tools.', code: 'ADMIN_ONLY' }, true);
      if (writes && !args.confirm) return toolResult({ error: 'Set confirm:true to save.' }, true);
      if (name === 'news_list') return toolResult(await listNews(env, args));
      if (name === 'news_save') return toolResult(await saveNewsDraft(env, mcpCtx(auth), args));
      if (name === 'wiki_list') return toolResult(await listWiki(env));
      return toolResult(await submitWiki(env, mcpCtx(auth), args));
    }
    case 'model_bench_routes':
    case 'model_bench_start':
    case 'model_bench_result': {
      const writes = name === 'model_bench_start';
      requireScope(auth, writes ? 'surveys:publish' : 'surveys:read');
      if (!(await isPlatformAdmin(env, auth.userId))) return toolResult({ error: 'Only platform admins can bench models.', code: 'ADMIN_ONLY' }, true);
      if (writes && !args.confirm) return toolResult({ error: 'Set confirm:true to run the bench (it uses the model provider\'s quota).' }, true);
      const bench = await import('../agent/modelBench.mjs');
      if (name === 'model_bench_routes') return toolResult(await bench.listBenchRoutes(env, auth.userId));
      if (name === 'model_bench_result') return toolResult(await bench.readModelBench(env, args));
      const { dispatchAgentRun } = await import('../agent/runtime/runDispatcher.mjs');
      return toolResult(await bench.startModelBench(env, auth.userId, args, {
        dispatch: (job) => dispatchAgentRun(env, null, job),
      }));
    }
    case 'survey_list_projects': {
      requireScope(auth, 'surveys:read');
      if (useService) return toolResult(await listOwnedViaService(env, auth.userId));
      return toolResult(await listProjects(env, auth.accessToken));
    }
    case 'survey_create_project': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        // Create via service role with explicit user_id
        const { createProject: create } = await import('../agent/projectHandlers.mjs');
        // Temporarily mint: use service role path by inserting with user id
        const result = await createViaService(env, auth.userId, args, request);
        return toolResult(trimResultSiteHtml(result));
      }
      return toolResult(trimResultSiteHtml(await createProject(env, auth.accessToken, auth.userId, args, request)));
    }
    case 'survey_update_project': {
      requireScope(auth, 'surveys:write');
      if (useService) return toolResult(await updateMetaViaService(env, auth.userId, args));
      return toolResult(await updateProjectMeta(env, auth.accessToken, args.projectId, args, auth.userId));
    }
    case 'survey_delete_project': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) {
        return toolResult({ error: 'Set confirm:true to permanently delete this owned project.' }, true);
      }
      return toolResult(await deleteOwnedProject(env, mcpCtx(auth), args.projectId));
    }
    case 'survey_duplicate_project': {
      requireScope(auth, 'surveys:write');
      return toolResult(await duplicateProject(env, mcpCtx(auth), args.projectId, args, request));
    }
    case 'survey_export_project': {
      requireScope(auth, 'surveys:read');
      return toolResult(await exportProject(env, mcpCtx(auth), args.projectId));
    }
    case 'survey_import_project': {
      requireScope(auth, 'surveys:write');
      return toolResult(await importProject(env, mcpCtx(auth), args, request));
    }
    case 'survey_import_qualtrics': {
      requireScope(auth, 'surveys:write');
      let qsf = args.qsf;
      try {
        if (typeof qsf === 'string') qsf = JSON.parse(qsf);
      } catch {
        return toolResult({ error: 'qsf is not valid JSON.' }, true);
      }
      let converted;
      try {
        converted = qsfToSurveyConfig(qsf);
      } catch (err) {
        return toolResult({ error: err?.message || String(err) }, true);
      }
      const name = String(args.name || converted.report.title).trim().slice(0, 200) || 'Imported Qualtrics survey';
      const createArgs = {
        name,
        description: `Imported from Qualtrics (${converted.report.converted} questions)`,
        surveyConfig: { ...converted.surveyConfig, title: name },
      };
      const created = useService
        ? await createViaService(env, auth.userId, createArgs, request)
        : await createProject(env, auth.accessToken, auth.userId, createArgs, request);
      return toolResult({ ...created, qualtricsReport: converted.report }, !!created?.error);
    }
    case 'survey_list_templates': {
      requireScope(auth, 'surveys:read');
      return toolResult(await listTemplates(env, mcpCtx(auth)));
    }
    case 'survey_get_template': {
      requireScope(auth, 'surveys:read');
      return toolResult(await getTemplate(env, mcpCtx(auth), args.templateId));
    }
    case 'survey_create_from_template': {
      requireScope(auth, 'surveys:write');
      return toolResult(await createFromTemplate(env, mcpCtx(auth), args, request));
    }
    case 'survey_save_as_template': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to submit as template.' }, true);
      return toolResult(await saveAsTemplate(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_apply_main_page': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to apply to Main Page.' }, true);
      return toolResult(await applyMainPage(env, mcpCtx(auth), args.projectId, args));
    }
    case 'media_list': {
      requireScope(auth, 'surveys:read');
      return toolResult(await listProjectMedia(env, mcpCtx(auth), args.projectId));
    }
    case 'media_import_from_template': {
      requireScope(auth, 'media:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to import template media.' }, true);
      return toolResult(await importMediaFromTemplate(env, mcpCtx(auth), args.projectId, args));
    }
    case 'media_delete': {
      requireScope(auth, 'media:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to delete media keys.' }, true);
      return toolResult(await deleteProjectMedia(env, mcpCtx(auth), args.projectId, args));
    }
    case 'media_upload': {
      requireScope(auth, 'media:write');
      return toolResult(await uploadProjectMedia(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_get_media_dataset': {
      requireScope(auth, 'surveys:read');
      return toolResult(await getMediaDataset(env, mcpCtx(auth), args.projectId));
    }
    case 'survey_update_media_dataset': {
      requireScope(auth, 'surveys:write');
      return toolResult(await updateMediaDataset(env, mcpCtx(auth), args.projectId, args));
    }
    case 'skill_list': {
      requireScope(auth, 'surveys:read');
      return toolResult(await listSkills(env, mcpCtx(auth)));
    }
    case 'skill_get': {
      requireScope(auth, 'surveys:read');
      return toolResult(await getSkill(env, mcpCtx(auth), args.skillId, args.revision));
    }
    case 'skill_save': {
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to save a skill.' }, true);
      return toolResult(await saveSkill(env, mcpCtx(auth), args));
    }
    case 'survey_list_responses': {
      requireScope(auth, 'results:read');
      return toolResult(await listResponses(env, mcpCtx(auth), args.projectId, args));
    }
    case 'silicon_list_runs': {
      requireScope(auth, 'results:read');
      if (useService) {
        await assertOwned(env, auth.userId, args.projectId);
        return toolResult(await listSiliconRunsService(env, args.projectId));
      }
      return toolResult(await listSiliconRuns(env, auth, args.projectId));
    }
    case 'silicon_run_responses': {
      requireScope(auth, 'results:read');
      if (!args.runId) return toolResult({ error: 'runId is required' }, true);
      if (useService) {
        await assertOwned(env, auth.userId, await siliconRunProjectId(env, args.runId));
        return toolResult(await listSiliconResponsesService(env, args.runId));
      }
      return toolResult(await listSiliconResponses(env, auth, args.runId));
    }
    case 'survey_export_responses': {
      requireScope(auth, 'results:read');
      return toolResult(await exportResponses(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_results_summary': {
      requireScope(auth, 'results:read');
      return toolResult(await summarizeResponses(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_delete_response': {
      // Destructive — require write scope (not results:read).
      requireScope(auth, 'surveys:write');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to delete a response.' }, true);
      return toolResult(await deleteResponse(env, mcpCtx(auth), args.projectId, args));
    }
    case 'survey_get_draft': {
      requireScope(auth, 'surveys:read');
      // The page HTML (up to 3 MB) stays out of the agent's context.
      if (useService) return toolResult(trimResultSiteHtml(await getDraftViaService(env, auth.userId, args.projectId, request)));
      return toolResult(trimResultSiteHtml(await getDraft(env, auth.accessToken, args.projectId, request)));
    }
    case 'survey_validate': {
      requireScope(auth, 'surveys:read');
      if (useService) {
        const { validateSurveyConfig } = await import('../designProtocol.mjs');
        if (args.surveyConfig) {
          const validation = validateSurveyConfig(args.surveyConfig);
          return toolResult({ success: validation.valid, validation });
        }
        const draft = await getDraftViaService(env, auth.userId, args.projectId, request);
        return toolResult({ success: draft.validation.valid, validation: draft.validation });
      }
      return toolResult(await validateProject(env, auth.accessToken, args.projectId, args));
    }
    case 'survey_apply_operations': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        return toolResult(trimResultSiteHtml(await applyOpsViaService(env, auth.userId, args.projectId, args)));
      }
      return toolResult(trimResultSiteHtml(await applyProjectOperations(env, auth.accessToken, args.projectId, args, 'codex')));
    }
    case 'survey_replace_draft': {
      requireScope(auth, 'surveys:write');
      // Both paths keep the stored page when spSite comes back without its HTML.
      if (useService) {
        return toolResult(trimResultSiteHtml(await saveDraftViaService(env, auth.userId, args.projectId, args)));
      }
      return toolResult(trimResultSiteHtml(await saveDraft(env, auth.accessToken, args.projectId, args, 'codex')));
    }
    case 'survey_acquire_lease': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        return toolResult(await leaseViaService(env, auth.userId, args.projectId, args));
      }
      return toolResult(await acquireLease(env, auth.accessToken, auth.userId, args.projectId, args));
    }
    case 'survey_release_lease': {
      requireScope(auth, 'surveys:write');
      if (useService) {
        await supabaseRest(env, {
          path: '/rest/v1/project_edit_leases',
          method: 'DELETE',
          serviceRole: true,
          query: `?project_id=eq.${encodeURIComponent(args.projectId)}&user_id=eq.${encodeURIComponent(auth.userId)}`,
        });
        return toolResult({ success: true });
      }
      return toolResult(await releaseLease(env, auth.accessToken, args.projectId, args));
    }
    case 'survey_preview_urls': {
      requireScope(auth, 'surveys:read');
      if (useService) {
        const row = await linkRow(env, mcpCtx(auth), args.projectId);
        if (!row) throw Object.assign(new Error('Project not found'), { status: 404, code: 'PROJECT_NOT_FOUND' });
        const { buildProjectUrls } = await import('../designProtocol.mjs');
        const origin = env.APP_URL || new URL(request.url).origin;
        return toolResult({ success: true, urls: buildProjectUrls(args.projectId, origin, row) });
      }
      return toolResult(await previewUrls(env, auth.accessToken, args.projectId, request));
    }
    case 'survey_publish': {
      requireScope(auth, 'surveys:publish');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to publish.' }, true);
      if (!args.restoreVersion) {
        const row = await loadOwned(env, { ...mcpCtx(auth), projectId: args.projectId });
        const config = row.survey_config_draft ?? row.survey_config ?? {};
        const mediaProblem = checkPublishMedia({ ...config, imageDatasetConfig: row.image_dataset_config || config.imageDatasetConfig }, row.preloaded_images);
        if (mediaProblem) {
          return toolResult({
            error: mediaProblem.message,
            code: mediaProblem.code,
            questions: mediaProblem.questions,
            next: 'Put images in the project media library first (media_import_from_template, media_upload, or the media library in Studio), then call survey_publish again.',
          }, true);
        }
      }
      let published;
      try {
        published = useService
          ? await publishViaService(env, auth.userId, args.projectId, args)
          : await publishProject(env, auth.accessToken, args.projectId, args);
      } catch (error) {
        if (/draft has no pages/i.test(String(error?.message || ''))) {
          return toolResult(await noPagesError(env, mcpCtx(auth), args.projectId), true);
        }
        throw error;
      }
      return toolResult({ ...published, links: await publishLinks(env, mcpCtx(auth), args.projectId, request) });
    }
    case 'survey_list_versions': {
      requireScope(auth, 'surveys:read');
      if (useService) {
        await assertOwned(env, auth.userId, args.projectId);
        const rows = await supabaseRest(env, {
          path: '/rest/v1/project_config_versions',
          serviceRole: true,
          query: `?project_id=eq.${encodeURIComponent(args.projectId)}&select=version,published_at,change_summary&order=version.desc`,
        });
        return toolResult({ success: true, versions: rows || [] });
      }
      return toolResult(await listVersions(env, auth.accessToken, args.projectId));
    }
    case 'survey_rollback': {
      requireScope(auth, 'surveys:publish');
      if (!args.confirm) return toolResult({ error: 'Set confirm:true to rollback.' }, true);
      if (useService) {
        return toolResult(await publishViaService(env, auth.userId, args.projectId, { ...args, restoreVersion: Number(args.version) }));
      }
      return toolResult(await rollbackProject(env, auth.accessToken, args.projectId, args));
    }
    case 'credentials_status':
      return toolResult(await getCredentialStatus(env, auth.userId));
    default:
      return toolResult({ error: `Unknown tool: ${name}` }, true);
  }
}

async function assertOwned(env, userId, projectId) {
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=id`,
  });
  if (!rows?.[0]) {
    throw Object.assign(new Error('Project not found'), { status: 404, code: 'PROJECT_NOT_FOUND' });
  }
}

/** The id and custom-link slug of an owned project (null when not found). */
async function linkRow(env, ctx, projectId) {
  const { isSafeProjectId } = await import('../designProtocol.mjs');
  if (!isSafeProjectId(projectId)) {
    throw Object.assign(new Error('Invalid project id'), { status: 400, code: 'INVALID_PROJECT_ID' });
  }
  const owner = ctx.serviceRole ? `&user_id=eq.${encodeURIComponent(ctx.userId)}` : '';
  // Older databases have no public_slug column yet: fall back to the id link.
  for (const select of ['id,public_slug', 'id']) {
    let rows;
    try {
      // eslint-disable-next-line no-await-in-loop
      rows = await supabaseRest(env, {
        path: '/rest/v1/projects',
        accessToken: ctx.accessToken,
        serviceRole: Boolean(ctx.serviceRole),
        query: `?id=eq.${encodeURIComponent(projectId)}${owner}&select=${select}`,
      });
    } catch (error) {
      if (select === 'id') throw error;
      continue;
    }
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  return null;
}

async function publishLinks(env, ctx, projectId, request) {
  const { buildProjectUrls } = await import('../designProtocol.mjs');
  const row = await linkRow(env, ctx, projectId).catch(() => null);
  const urls = buildProjectUrls(projectId, env.APP_URL || new URL(request.url).origin, row);
  return { participant: urls.participant, studio: urls.studio };
}

// release_project_version refuses a draft without pages. A page imported as it
// is has none, until supabase/release_site_pages.sql has been run once.
async function noPagesError(env, ctx, projectId) {
  let sitePage = false;
  try {
    const { loadOwned } = await import('../agent/projectLifecycle.mjs');
    const row = await loadOwned(env, { ...ctx, projectId });
    const config = row.survey_config_draft ?? row.survey_config ?? {};
    sitePage = typeof config?.spSite?.html === 'string' && config.spSite.html.length > 0;
  } catch {
    sitePage = false;
  }
  return sitePage
    ? {
      error: 'This page cannot be published yet: the database still uses the release check that requires declared question pages. A platform admin must run supabase/release_site_pages.sql once in the Supabase SQL editor; then call survey_publish again.',
      code: 'SITE_PAGES_SQL_REQUIRED',
    }
    : {
      error: 'The draft has no pages. Import a page with sp_scheme_import or add questions, then publish.',
      code: 'DRAFT_HAS_NO_PAGES',
    };
}

async function updateMetaViaService(env, userId, body) {
  await assertOwned(env, userId, body.projectId);
  const existingRows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(body.projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  });
  const existing = existingRows?.[0];
  const patch = {};
  if (body?.name != null) {
    const name = String(body.name || '').trim().slice(0, 160);
    if (!name) throw Object.assign(new Error('Project name cannot be empty.'), { status: 400 });
    patch.name = name;
  }
  if (body?.description != null) {
    patch.description = String(body.description || '').trim();
  }
  const metaKeys = ['author', 'year', 'category', 'tags', 'website', 'huggingfaceDataset', 'metadata'];
  if (metaKeys.some((k) => body?.[k] !== undefined)) {
    patch.metadata = normalizeProjectMetadata(body, { ...(existing?.metadata || {}), ...metadataFromRow(existing || {}) });
  }
  if (!Object.keys(patch).length) {
    throw Object.assign(new Error('Provide name, description, and/or metadata fields to update.'), { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(body.projectId)}&user_id=eq.${encodeURIComponent(userId)}`,
    body: patch,
    prefer: 'return=representation',
  });
  const row = Array.isArray(rows) ? rows[0] : { ...existing, ...patch, id: body.projectId };
  return { success: true, project: projectCardFromRow(row) };
}

async function getDraftViaService(env, userId, projectId, request) {
  await assertOwned(env, userId, projectId);
  // Reuse handler by temporarily using service role through a patched access —
  // simplest: duplicate read using service role.
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}&select=*`,
  });
  const row = rows?.[0];
  if (!row) throw Object.assign(new Error('Project not found'), { status: 404 });
  const { sanitizeForAgent, validateSurveyConfig, buildProjectUrls } = await import('../designProtocol.mjs');
  const surveyConfig = row.survey_config_draft ?? row.survey_config ?? {};
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: sanitizeForAgent(surveyConfig),
    draftUpdatedAt: row.draft_updated_at || row.updated_at,
    publishedVersion: row.published_version || 0,
    validation: validateSurveyConfig(surveyConfig),
    urls: buildProjectUrls(projectId, env.APP_URL || new URL(request.url).origin, row),
  };
}

async function createViaService(env, userId, body, request) {
  const {
    createDefaultSurveyConfig,
    validateSurveyConfig,
    sanitizeForAgent,
    findSecretFields,
    buildProjectUrls,
    isSafeProjectId,
  } = await import('../designProtocol.mjs');
  if (findSecretFields(body).length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), { status: 400 });
  }
  const name = String(body?.name || '').trim();
  if (!name) throw Object.assign(new Error('Project name is required.'), { status: 400 });
  const { hydrateSkillContracts } = await import('../agent/skillContracts.mjs');
  const { postProcessAiConfig } = await import('../designProtocol.mjs');
  const surveyConfig = await hydrateSkillContracts(
    env,
    postProcessAiConfig(body?.surveyConfig || createDefaultSurveyConfig(name, body?.description || '')),
    userId,
  );
  const validation = validateSurveyConfig(surveyConfig);
  if (!validation.valid) throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });
  const id = `proj_${Date.now()}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  if (!isSafeProjectId(id)) throw new Error('Invalid id');
  const now = new Date().toISOString();
  const metadata = normalizeProjectMetadata(body, {});
  const row = {
    id,
    user_id: userId,
    name,
    description: body?.description || '',
    survey_config: surveyConfig,
    survey_config_draft: surveyConfig,
    draft_updated_at: now,
    metadata,
    last_writer: { source: 'codex', at: now },
    updated_at: now,
  };
  await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'POST',
    serviceRole: true,
    body: row,
  });
  return {
    success: true,
    project: sanitizeForAgent(projectCardFromRow(row)),
    surveyConfig: sanitizeForAgent(surveyConfig),
    draftUpdatedAt: now,
    validation,
    urls: buildProjectUrls(id, env.APP_URL || new URL(request.url).origin),
  };
}

async function saveDraftViaService(env, userId, projectId, body) {
  await assertOwned(env, userId, projectId);
  const {
    validateSurveyConfig, restoreStoredSecrets, findSecretFields, sanitizeForAgent, postProcessAiConfig,
  } = await import('../designProtocol.mjs');
  if (findSecretFields(body?.surveyConfig).length) {
    throw Object.assign(new Error('Do not send credentials through the agent API.'), { status: 400 });
  }
  const rows = await supabaseRest(env, {
    path: '/rest/v1/projects',
    serviceRole: true,
    query: `?id=eq.${encodeURIComponent(projectId)}&select=survey_config_draft,survey_config,draft_updated_at`,
  });
  const row = rows?.[0];
  if (!body.expectedDraftUpdatedAt) {
    throw Object.assign(new Error('expectedDraftUpdatedAt is required. Call survey_get_draft first.'), {
      status: 400,
      code: 'MISSING_EXPECTED_DRAFT_UPDATED_AT',
      draftUpdatedAt: row?.draft_updated_at || null,
    });
  }
  // A stale draft is a conflict before the page or the config is checked.
  if (row?.draft_updated_at && !sameDraftStamp(body.expectedDraftUpdatedAt, row.draft_updated_at)) {
    throw Object.assign(new Error('Project draft changed. Re-read before updating.'), {
      status: 409,
      code: 'CONFLICT',
      draftUpdatedAt: row.draft_updated_at,
    });
  }
  // A config read without its page HTML (survey_get_draft) keeps the stored page;
  // only sp_scheme_import changes it.
  const incoming = keepStoredSiteHtml(body?.surveyConfig, row?.survey_config_draft ?? row?.survey_config);
  const { hydrateSkillContracts } = await import('../agent/skillContracts.mjs');
  const hydratedConfig = await hydrateSkillContracts(env, postProcessAiConfig(incoming), userId);
  const validation = validateSurveyConfig(hydratedConfig);
  if (!validation.valid) throw Object.assign(new Error('Survey validation failed.'), { status: 400, validation });

  const merged = restoreStoredSecrets(hydratedConfig, row?.survey_config_draft ?? row?.survey_config);
  const now = new Date().toISOString();
  const saved = await supabaseRest(env, {
    path: '/rest/v1/projects',
    method: 'PATCH',
    serviceRole: true,
    // Guarded on the stamp read above, so a save in between is not overwritten.
    query: `?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}`
      + (row?.draft_updated_at ? `&draft_updated_at=eq.${encodeURIComponent(row.draft_updated_at)}` : '')
      + '&select=id',
    body: {
      survey_config: merged,
      survey_config_draft: merged,
      draft_updated_at: now,
      updated_at: now,
      last_writer: { source: 'codex', at: now },
    },
    prefer: 'return=representation',
  });
  if (!Array.isArray(saved) || !saved.length) {
    throw Object.assign(new Error('Project draft changed. Re-read before updating.'), {
      status: 409,
      code: 'CONFLICT',
    });
  }
  return { success: true, projectId, draftUpdatedAt: now, validation, surveyConfig: sanitizeForAgent(merged) };
}

async function applyOpsViaService(env, userId, projectId, body) {
  if (!body.expectedDraftUpdatedAt) {
    throw Object.assign(new Error('expectedDraftUpdatedAt is required. Call survey_get_draft first.'), {
      status: 400,
      code: 'MISSING_EXPECTED_DRAFT_UPDATED_AT',
    });
  }
  const draft = await getDraftViaService(env, userId, projectId, { url: 'https://local' });
  const { applyOperations, postProcessAiConfig, validateSurveyConfig } = await import('../designProtocol.mjs');
  const next = applyOperations(draft.surveyConfig, body.operations || []);
  next.surveyConfig = postProcessAiConfig(next.surveyConfig);
  next.validation = validateSurveyConfig(next.surveyConfig);
  if (!next.validation.valid) {
    throw Object.assign(new Error('Survey validation failed after operations.'), {
      status: 400,
      validation: next.validation,
    });
  }
  const saved = await saveDraftViaService(env, userId, projectId, {
    surveyConfig: next.surveyConfig,
    expectedDraftUpdatedAt: body.expectedDraftUpdatedAt,
    clientMutationId: body.clientMutationId,
  });
  return { ...saved, applied: next.applied, inverse: next.inverse, surveyConfig: saved.surveyConfig };
}

async function leaseViaService(env, userId, projectId, body) {
  await assertOwned(env, userId, projectId);
  const sessionId = body.sessionId || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + (Math.min(body.ttlMinutes || 30, 120) * 60 * 1000)).toISOString();
  await supabaseRest(env, {
    path: '/rest/v1/project_edit_leases',
    method: 'POST',
    serviceRole: true,
    body: {
      project_id: projectId,
      holder: 'codex',
      session_id: sessionId,
      user_id: userId,
      expires_at: expiresAt,
    },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return { success: true, lease: { projectId, holder: 'codex', sessionId, expiresAt } };
}

async function publishViaService(env, userId, projectId, body) {
  await assertOwned(env, userId, projectId);
  if (!body.expectedDraftUpdatedAt) throw Object.assign(new Error('Read the draft first and supply expectedDraftUpdatedAt.'), { status: 400 });
  const result = await supabaseRest(env, {
    path: '/rest/v1/rpc/release_project_version', method: 'POST', serviceRole: true,
    body: { p_project_id: projectId, p_owner: userId,
      p_expected_draft_updated_at: body.expectedDraftUpdatedAt,
      p_summary: body.summary || null, p_restore_version: body.restoreVersion || null },
  });
  return { success: true, ...result };
}

export async function handleMcpRequest(request, env, auth) {
  if (request.method === 'GET') {
    // Optional SSE stream — return empty endpoint info for Streamable HTTP clients.
    return new Response(null, { status: 405 });
  }
  if (request.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }

  let message;
  try {
    message = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  const respond = async (id, result) => new Response(JSON.stringify({
    jsonrpc: '2.0',
    id,
    result,
  }), { headers: { 'content-type': 'application/json' } });

  const { id, method, params } = message || {};

  try {
    if (method === 'initialize') {
      return respond(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'sp-survey-platform', title: 'SP-Survey', version: '1.1.0' },
        instructions: 'SP-Survey (sp-survey.org) runs image-based perception surveys. To start a new study, call sp_scheme_spec.',
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return new Response(null, { status: 202 });
    }
    if (method === 'tools/list') {
      return respond(id, { tools: await listToolsFor(env, auth) });
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      const result = await callTool(env, auth, request, name, args);
      return respond(id, result);
    }
    if (method === 'ping') {
      return respond(id, {});
    }
    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return respond(id, toolResult({
      error: error.message,
      code: error.code || 'ERROR',
    }, true));
  }
}

function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// silence unused import warnings for tree helpers intentionally re-exported above
void ensureAccessToken;
void withUserScopedClient;
void listVersions;
void releaseLease;
void rollbackProject;
void applyProjectOperations;
void saveDraft;
void publishProject;
void getDraft;
void createProject;
void acquireLease;
void previewUrls;
void validateProject;
void listProjects;
