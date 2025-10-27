// Multi-Agent Survey Review System
// Implements collaborative survey review with multiple expert agents

/**
 * Agent Roles and Expertise
 */
const AGENTS = {
  'urban-scientist': {
    name: 'Urban Scientist',
    emoji: '🔬',
    expertise: 'Urban studies methodology, research design, spatial analysis',
    focus: [
      'Research question clarity and feasibility',
      'Sampling strategy and data collection methods',
      'Scientific rigor and validity',
      'Integration with urban theory'
    ]
  },
  'urban-designer': {
    name: 'Urban Designer',
    emoji: '🏙️',
    expertise: 'Urban design principles, streetscape quality, placemaking',
    focus: [
      'Streetscape design elements coverage',
      'Visual quality assessment criteria',
      'Design intervention evaluation',
      'Public space design considerations'
    ]
  },
  'perception-psychologist': {
    name: 'Perception Psychologist',
    emoji: '🧠',
    expertise: 'Human perception, cognitive psychology, survey methodology',
    focus: [
      'Question wording and cognitive load',
      'Response bias and anchoring effects',
      'Scale appropriateness and rating methods',
      'Participant understanding and clarity'
    ]
  },
  'test-participant': {
    name: 'Test Participant',
    emoji: '👤',
    expertise: 'User experience, survey usability, participant perspective',
    focus: [
      'Survey length and engagement',
      'Question clarity from user perspective',
      'Interface usability and flow',
      'Motivation and completion likelihood'
    ]
  },
  'data-analyst': {
    name: 'Data Analyst',
    emoji: '📊',
    expertise: 'Statistical analysis, data quality, measurement validity',
    focus: [
      'Data quality and completeness',
      'Statistical analysis readiness',
      'Variable measurement and operationalization',
      'Data export and analysis workflow'
    ]
  }
};

/**
 * Review Configuration
 */
const REVIEW_CONFIG = {
  maxRounds: 3,  // Maximum review rounds before force termination
  minApprovalScore: 0.7,  // Minimum approval ratio to pass (70%)
  enableOneOnOne: true,  // Enable 1v1 review mode
  enableGroupDiscussion: true,  // Enable group discussion mode
  autoTriggerAfterGenerate: true,  // Auto-trigger review after generate
  autoTriggerAfterAdjust: true  // Auto-trigger review after adjust
};

/**
 * Generate system prompt for an agent
 */
function getAgentSystemPrompt(agentId, surveyConfig, reviewMode = 'individual', customAgents = null) {
  const agentsConfig = customAgents || AGENTS;
  const agent = agentsConfig[agentId];
  
  const basePrompt = `You are an expert ${agent.name} (${agent.expertise}).

Your role is to review streetscape perception surveys and provide constructive feedback.

YOUR EXPERTISE AREAS:
${agent.focus.map((f, i) => `${i + 1}. ${f}`).join('\n')}

REVIEW GUIDELINES:
- Be specific and actionable in your feedback
- Focus on your area of expertise
- Consider both strengths and areas for improvement
- Suggest concrete improvements when pointing out issues
- Rate the survey on a scale of 1-10 for your domain
- Provide a brief justification for your rating`;

  if (reviewMode === 'individual') {
    return `${basePrompt}

RESPONSE FORMAT:
Provide your review in the following JSON structure:
{
  "rating": <number 1-10>,
  "strengths": ["strength 1", "strength 2", ...],
  "concerns": ["concern 1", "concern 2", ...],
  "suggestions": ["suggestion 1", "suggestion 2", ...],
  "verdict": "approve" | "revise" | "major-revision",
  "summary": "Brief overall assessment"
}

- "approve": Survey is good, only minor suggestions
- "revise": Needs specific improvements (provide in suggestions)
- "major-revision": Significant issues that need addressing`;
  } else {
    // Group discussion mode
    return `${basePrompt}

You are participating in a group discussion with other experts. Build on others' comments and provide your unique perspective.

RESPONSE FORMAT:
{
  "comments": "Your thoughts on the survey and others' feedback",
  "keyPoints": ["point 1", "point 2", ...],
  "agreement": ["What you agree with from others"],
  "additions": ["What you want to add that wasn't mentioned"],
  "verdict": "approve" | "revise" | "major-revision"
}`;
  }
}

/**
 * Generate 1v1 review prompt
 */
function generate1v1ReviewPrompt(agentId, surveyConfig, round, customAgents = null) {
  const agentsConfig = customAgents || AGENTS;
  const agent = agentsConfig[agentId];
  
  return `SURVEY REVIEW REQUEST

As ${agent.name}, please review this streetscape perception survey:

${JSON.stringify(surveyConfig, null, 2)}

This is review round ${round}. Focus on:
${agent.focus.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Provide your expert assessment and specific recommendations for improvement.`;
}

/**
 * Generate group discussion prompt
 */
function generateGroupDiscussionPrompt(surveyConfig, previousReviews, round, customAgents = null) {
  const agentsConfig = customAgents || AGENTS;
  const reviewSummary = previousReviews.map(r => 
    `${agentsConfig[r.agentId].emoji} ${agentsConfig[r.agentId].name}: ${r.summary || r.comments}`
  ).join('\n\n');
  
  return `GROUP DISCUSSION - Round ${round}

SURVEY UNDER REVIEW:
${JSON.stringify(surveyConfig, null, 2)}

PREVIOUS REVIEWS:
${reviewSummary}

Now discuss as a group. Each expert should:
1. Share your perspective based on your expertise
2. Build on or challenge others' comments
3. Identify consensus areas and disagreements
4. Provide actionable recommendations

Work together to reach a collective decision on whether this survey is ready or needs revision.`;
}

/**
 * Consolidate reviews into actionable feedback
 */
function consolidateReviews(reviews) {
  const allConcerns = [];
  const allSuggestions = [];
  const ratings = [];
  const verdicts = { approve: 0, revise: 0, 'major-revision': 0 };
  
  reviews.forEach(review => {
    if (review.concerns) allConcerns.push(...review.concerns);
    if (review.suggestions) allSuggestions.push(...review.suggestions);
    if (review.rating) ratings.push(review.rating);
    if (review.verdict) verdicts[review.verdict]++;
  });
  
  const avgRating = ratings.length > 0 
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
    : null;
  
  // Determine overall verdict
  const totalReviews = reviews.length;
  let overallVerdict = 'revise';
  if (verdicts['major-revision'] > totalReviews * 0.3) {
    overallVerdict = 'major-revision';
  } else if (verdicts.approve > totalReviews * REVIEW_CONFIG.minApprovalScore) {
    overallVerdict = 'approve';
  }
  
  return {
    averageRating: avgRating,
    overallVerdict,
    verdictBreakdown: verdicts,
    topConcerns: getMostMentioned(allConcerns, 3),
    topSuggestions: getMostMentioned(allSuggestions, 5),
    needsRevision: overallVerdict !== 'approve'
  };
}

/**
 * Get most frequently mentioned items
 */
function getMostMentioned(items, limit) {
  const counts = {};
  items.forEach(item => {
    const key = item.toLowerCase().trim();
    counts[key] = (counts[key] || 0) + 1;
  });
  
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([item]) => item);
}

/**
 * Generate revision prompt for survey-designer
 */
function generateRevisionPrompt(consolidatedFeedback, reviews, customAgents = null) {
  const agentsConfig = customAgents || AGENTS;
  const agentFeedback = reviews.map(review => {
    const agent = agentsConfig[review.agentId];
    return `
${agent.emoji} ${agent.name} (Rating: ${review.rating || 'N/A'}/10, Verdict: ${review.verdict})

Concerns:
${review.concerns ? review.concerns.map(c => `- ${c}`).join('\n') : 'None'}

Suggestions:
${review.suggestions ? review.suggestions.map(s => `- ${s}`).join('\n') : 'None'}

${review.summary || review.comments || ''}
`.trim();
  }).join('\n\n---\n\n');
  
  return `MULTI-AGENT REVIEW FEEDBACK

Overall Rating: ${consolidatedFeedback.averageRating}/10
Verdict: ${consolidatedFeedback.overallVerdict.toUpperCase()}
Approval Status: ${consolidatedFeedback.verdictBreakdown.approve}/${reviews.length} agents approve

TOP CONCERNS:
${consolidatedFeedback.topConcerns.map((c, i) => `${i + 1}. ${c}`).join('\n')}

TOP SUGGESTIONS:
${consolidatedFeedback.topSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

DETAILED AGENT FEEDBACK:
${agentFeedback}

---

Based on this expert feedback, please revise the survey to address the concerns and implement the suggestions. Focus especially on the top concerns and suggestions that multiple agents mentioned.`;
}

/**
 * Check if review should terminate
 */
function shouldTerminateReview(round, consolidatedFeedback, history, maxRounds = REVIEW_CONFIG.maxRounds) {
  // Max rounds reached
  if (round >= maxRounds) {
    return {
      terminate: true,
      reason: `Maximum review rounds (${maxRounds}) reached`
    };
  }
  
  // Approval threshold met
  if (consolidatedFeedback.overallVerdict === 'approve') {
    return {
      terminate: true,
      reason: `Survey approved by ${consolidatedFeedback.verdictBreakdown.approve}/${Object.values(consolidatedFeedback.verdictBreakdown).reduce((a, b) => a + b, 0)} agents`
    };
  }
  
  // No improvement detected (same concerns repeated)
  if (round > 1 && history.length >= 2) {
    const currentConcerns = consolidatedFeedback.topConcerns.join('|');
    const previousConcerns = history[history.length - 2].topConcerns.join('|');
    if (currentConcerns === previousConcerns) {
      return {
        terminate: true,
        reason: 'No improvement detected - same concerns persist'
      };
    }
  }
  
  return { terminate: false };
}

/**
 * Format review for display in chat UI
 */
function formatReviewForChat(agentId, review, round, customAgents = null) {
  const agentsConfig = customAgents || AGENTS;
  const agent = agentsConfig[agentId];
  
  let message = `${agent.emoji} **${agent.name}** - Round ${round}\n\n`;
  
  if (review.rating) {
    message += `**Rating:** ${review.rating}/10 | **Verdict:** ${review.verdict}\n\n`;
  }
  
  if (review.strengths && review.strengths.length > 0) {
    message += `**✅ Strengths:**\n${review.strengths.map(s => `- ${s}`).join('\n')}\n\n`;
  }
  
  if (review.concerns && review.concerns.length > 0) {
    message += `**⚠️ Concerns:**\n${review.concerns.map(c => `- ${c}`).join('\n')}\n\n`;
  }
  
  if (review.suggestions && review.suggestions.length > 0) {
    message += `**💡 Suggestions:**\n${review.suggestions.map(s => `- ${s}`).join('\n')}\n\n`;
  }
  
  if (review.summary) {
    message += `**Summary:** ${review.summary}`;
  }
  
  if (review.comments) {
    message += `**Comments:** ${review.comments}`;
  }
  
  return message;
}

/**
 * Format consolidated feedback for chat UI
 */
function formatConsolidatedFeedback(consolidated, round) {
  return `📊 **Review Summary - Round ${round}**

**Overall Rating:** ${consolidated.averageRating}/10
**Verdict:** ${consolidated.overallVerdict.toUpperCase()}
**Approval:** ${consolidated.verdictBreakdown.approve} approve | ${consolidated.verdictBreakdown.revise} revise | ${consolidated.verdictBreakdown['major-revision']} major revision

**🔴 Top Concerns:**
${consolidated.topConcerns.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**💡 Top Suggestions:**
${consolidated.topSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${consolidated.needsRevision ? '⏭️ Proceeding to next revision round...' : '✅ Survey approved! Ready for deployment.'}`;
}

module.exports = {
  AGENTS,
  REVIEW_CONFIG,
  getAgentSystemPrompt,
  generate1v1ReviewPrompt,
  generateGroupDiscussionPrompt,
  consolidateReviews,
  generateRevisionPrompt,
  shouldTerminateReview,
  formatReviewForChat,
  formatConsolidatedFeedback
};

