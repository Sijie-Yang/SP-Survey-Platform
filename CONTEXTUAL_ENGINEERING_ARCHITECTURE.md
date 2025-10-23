# 🧠 Contextual Engineering Architecture

## 📐 Overall System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE LAYER                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                  ChatAssistant Component                          │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐    │  │
│  │  │   Header   │  │   Settings   │  │  Conversation Display │    │  │
│  │  │ ⚙️ 🔽 ✕   │  │   Dialog     │  │    (Auto-scroll)      │    │  │
│  │  └────────────┘  └──────────────┘  └───────────────────────┘    │  │
│  │  ┌────────────────────────────────────────────────────────────┐  │  │
│  │  │            Message Input + Send Button                     │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONTEXTUAL ENGINEERING CORE                        │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    3-Layer Memory System                         │  │
│  │                                                                  │  │
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │  │
│  │  ┃  Layer 1: SESSION LEARNING (localStorage)              ┃  │  │
│  │  ┃  ┌──────────────────────────────────────────────────┐  ┃  │  │
│  │  ┃  │ • User Expertise Level                          │  ┃  │  │
│  │  ┃  │ • Historical Preferences (scales, image counts) │  ┃  │  │
│  │  ┃  │ • Project Statistics (iterations, categories)  │  ┃  │  │
│  │  ┃  │ • Smart Recommendations                         │  ┃  │  │
│  │  ┃  │                                                  │  ┃  │  │
│  │  ┃  │ Persistence: Across browser sessions            │  ┃  │  │
│  │  ┃  │ Scope: Cross-project, User-level                │  ┃  │  │
│  │  ┃  └──────────────────────────────────────────────────┘  ┃  │  │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │  │
│  │                              ↕                                   │  │
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │  │
│  │  ┃  Layer 2: WORKING MEMORY (sessionStorage)          ┃  │  │
│  │  ┃  ┌──────────────────────────────────────────────────┐  ┃  │  │
│  │  ┃  │ • Current Survey Goal                           │  ┃  │  │
│  │  ┃  │ • Iteration History                             │  ┃  │  │
│  │  ┃  │ • Design Decisions & Rationale                  │  ┃  │  │
│  │  ┃  │ • Active Project Context                        │  ┃  │  │
│  │  ┃  │                                                  │  ┃  │  │
│  │  ┃  │ Persistence: Current session only               │  ┃  │  │
│  │  ┃  │ Scope: Project-specific                         │  ┃  │  │
│  │  ┃  └──────────────────────────────────────────────────┘  ┃  │  │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │  │
│  │                              ↕                                   │  │
│  │  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │  │
│  │  ┃  Layer 3: CONVERSATION HISTORY (sessionStorage)    ┃  │  │
│  │  ┃  ┌──────────────────────────────────────────────────┐  ┃  │  │
│  │  ┃  │ • User Messages                                  │  ┃  │  │
│  │  ┃  │ • AI Responses                                   │  ┃  │  │
│  │  ┃  │ • Message Metadata (timestamp, intent)          │  ┃  │  │
│  │  ┃  │ • System Messages                                │  ┃  │  │
│  │  ┃  │                                                  │  ┃  │  │
│  │  ┃  │ Persistence: Current session only               │  ┃  │  │
│  │  ┃  │ Scope: Project-specific                         │  ┃  │  │
│  │  ┃  └──────────────────────────────────────────────────┘  ┃  │  │
│  │  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                       INTELLIGENT ROUTING LAYER                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  Backend API (/api/openai/chat)                  │  │
│  │                                                                  │  │
│  │  ┌─────────────────────────────────────────────────────────┐   │  │
│  │  │            Intent Classification (LLM-based)            │   │  │
│  │  │  • Analyze user message + current survey state          │   │  │
│  │  │  • Classify intent: generate / adjust / question        │   │  │
│  │  │  • Include conversation history for context             │   │  │
│  │  └─────────────────────────────────────────────────────────┘   │  │
│  │                            ↓                                     │  │
│  │  ┌───────────┬──────────────────┬─────────────────────────┐    │  │
│  │  │ GENERATE  │     ADJUST       │       QUESTION          │    │  │
│  │  │  Intent   │     Intent       │        Intent           │    │  │
│  │  └─────┬─────┴────────┬─────────┴───────────┬─────────────┘    │  │
│  │        ↓              ↓                     ↓                   │  │
│  │  ┌─────────┐   ┌─────────────┐   ┌──────────────────┐         │  │
│  │  │ Create  │   │   Modify    │   │  Answer with     │         │  │
│  │  │ New     │   │  Existing   │   │  Information     │         │  │
│  │  │ Survey  │   │  Survey     │   │  (No changes)    │         │  │
│  │  └─────────┘   └─────────────┘   └──────────────────┘         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                           LLM PROCESSING LAYER                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     OpenAI GPT-4o Integration                    │  │
│  │                                                                  │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │              Dynamic Context Injection                    │  │  │
│  │  │  ┌─────────────────────────────────────────────────────┐  │  │  │
│  │  │  │ System Prompt (Base Rules + Question Types)        │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Session Context (User Preferences + Expertise)     │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Working Context (Survey Goal + Design Decisions)   │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Conversation History (Last 10 messages)            │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ Current Survey Config (if exists)                  │  │  │  │
│  │  │  ├─────────────────────────────────────────────────────┤  │  │  │
│  │  │  │ User Message (Current request)                     │  │  │  │
│  │  │  └─────────────────────────────────────────────────────┘  │  │  │
│  │  └───────────────────────────────────────────────────────────┘  │  │
│  │                              ↓                                   │  │
│  │  ┌───────────────────────────────────────────────────────────┐  │  │
│  │  │           Response Generation (JSON Mode)                 │  │  │
│  │  │  • Structured output with surveyConfig                    │  │  │
│  │  │  • Natural language explanation                           │  │  │
│  │  │  • Automatic retry on parse errors                        │  │  │
│  │  └───────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↕
┌─────────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Survey Builder Component                      │  │
│  │  • Apply generated/adjusted config to editor                     │  │
│  │  • Update working memory with new iteration                      │  │
│  │  • Record design decisions                                       │  │
│  │  • Update session learning statistics                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Data Flow Diagram

### **User Input Flow**

```
┌─────────────┐
│    USER     │
│  Types msg  │
└──────┬──────┘
       │
       ↓
┌──────────────────────────────────────────────────────┐
│  handleSendMessage (SurveyBuilder.js)                │
│  • Validate API key                                  │
│  • Add user message to conversation history          │
│  • Build API history (last 10 messages)              │
│  • Enrich with Session + Working context            │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  sendChatMessage (chatApi.js)                        │
│  POST /api/openai/chat                               │
│  {                                                    │
│    message: "Create thermal survey",                 │
│    currentConfig: {...},                             │
│    conversationHistory: [...],                       │
│    apiKey: "sk-..."                                  │
│  }                                                    │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  Backend Intent Router (server.js)                   │
│  • Build intentPrompt with message + config state    │
│  • Call OpenAI to classify: generate/adjust/question │
│  • Route to appropriate LLM handler                  │
└────────────────────┬─────────────────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       ↓             ↓             ↓
┌──────────┐  ┌──────────┐  ┌──────────┐
│ Generate │  │  Adjust  │  │ Question │
│  Survey  │  │  Survey  │  │  Answer  │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     └─────────────┼─────────────┘
                   ↓
┌──────────────────────────────────────────────────────┐
│  OpenAI API Call (with full context)                 │
│  • System prompt (rules + examples)                  │
│  • Session context (preferences)                     │
│  • Working context (project goals)                   │
│  • Conversation history                              │
│  • Current message                                   │
│  → Response with surveyConfig (if generate/adjust)   │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  Response Processing (SurveyBuilder.js)              │
│  • Add AI response to conversation history           │
│  • If surveyConfig present:                          │
│    - Apply to editor (onChange)                      │
│    - Update working memory (goal, iteration)         │
│    - Record design decisions                         │
│    - Update session learning stats                   │
└────────────────────┬─────────────────────────────────┘
                     │
                     ↓
┌──────────────────────────────────────────────────────┐
│  UI Update                                           │
│  • Show AI message in chat                           │
│  • Update survey preview                             │
│  • Auto-scroll to bottom                             │
│  • Enable input for next message                     │
└──────────────────────────────────────────────────────┘
```

---

## 🧩 Component Interaction Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       FRONTEND (React)                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  SurveyBuilder.js                                          │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  State Management                                     │ │ │
│  │  │  • conversationMessages                               │ │ │
│  │  │  • userMessage, isLoading, apiKeyValid               │ │ │
│  │  │  • recommendations, contextEnabled                   │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Refs (Persistent Objects)                           │ │ │
│  │  │  • conversationHistoryRef → conversationHistory.js   │ │ │
│  │  │  • workingMemoryRef → workingMemory.js              │ │ │
│  │  │  • sessionLearningRef → sessionLearning.js          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Event Handlers                                       │ │ │
│  │  │  • handleSendMessage()                               │ │ │
│  │  │  • handleValidateApiKey()                            │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                          ↓ renders                        │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  ChatAssistant.js                                    │ │ │
│  │  │  • Header (status, download, clear, settings)       │ │ │
│  │  │  • Recommendations display                           │ │ │
│  │  │  • Message list (scrollable)                         │ │ │
│  │  │  • Input + Send button                               │ │ │
│  │  │  • Settings Dialog (API key, CE toggle)             │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Context Modules (src/lib/)                               │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  conversationHistory.js (sessionStorage)             │ │ │
│  │  │  • addMessage(role, content, metadata)               │ │ │
│  │  │  • getAllMessages()                                   │ │ │
│  │  │  • getFormattedForOpenAI(limit)                      │ │ │
│  │  │  • clear(), export()                                 │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  workingMemory.js (sessionStorage)                   │ │ │
│  │  │  • setSurveyGoal(goal)                               │ │ │
│  │  │  • addIteration(config, instruction)                 │ │ │
│  │  │  • addDesignDecision(decision, rationale)            │ │ │
│  │  │  • getContextForAI()                                 │ │ │
│  │  │  • clear()                                           │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  sessionLearning.js (localStorage)                   │ │ │
│  │  │  • recordProjectInteraction(id, category, action)    │ │ │
│  │  │  • updateUserExpertise(level)                        │ │ │
│  │  │  • recordUserPreference(key, value)                  │ │ │
│  │  │  • getRecommendations(category)                      │ │ │
│  │  │  • getContextForAI(category)                         │ │ │
│  │  │  • export()                                          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  chatApi.js                                                │ │
│  │  • sendChatMessage(msg, config, history, key)             │ │
│  │  • validateApiKey(key)                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                ↕ HTTP
┌──────────────────────────────────────────────────────────────────┐
│                       BACKEND (Node.js/Express)                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  server.js                                                 │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  POST /api/openai/chat                               │ │ │
│  │  │  1. Receive: message, currentConfig, history, key    │ │ │
│  │  │  2. Build intentPrompt                               │ │ │
│  │  │  3. Call OpenAI to classify intent                   │ │ │
│  │  │  4. Route to handler:                                │ │ │
│  │  │     • generate → Full survey creation                │ │ │
│  │  │     • adjust → Modify existing survey                │ │ │
│  │  │     • question → Answer without changes              │ │ │
│  │  │  5. Build enriched messages array                    │ │ │
│  │  │  6. Call OpenAI with full context                    │ │ │
│  │  │  7. Parse response (with retry)                      │ │ │
│  │  │  8. Return surveyConfig + message                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  POST /api/openai/validate-key                       │ │ │
│  │  │  • Test API key with simple completion               │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                                ↕ API
┌──────────────────────────────────────────────────────────────────┐
│                       OPENAI API                                 │
│  • GPT-4o model                                                  │
│  • JSON mode enabled                                             │
│  • Structured output with retry                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 💾 Storage Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      BROWSER STORAGE                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  localStorage (Persistent, Cross-Session)              │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Key: surveybuilder_session_learning             │ │ │
│  │  │  Value: {                                        │ │ │
│  │  │    userExpertise: "intermediate",               │ │ │
│  │  │    preferences: {                                │ │ │
│  │  │      ratingScale: "1-7",                        │ │ │
│  │  │      imageCount: 4,                             │ │ │
│  │  │      includeNeutral: true                       │ │ │
│  │  │    },                                           │ │ │
│  │  │    projectHistory: [                            │ │ │
│  │  │      {                                          │ │ │
│  │  │        projectId: "abc123",                    │ │ │
│  │  │        category: "thermal",                    │ │ │
│  │  │        iterations: 5,                          │ │ │
│  │  │        timestamp: "2025-10-23T..."             │ │ │
│  │  │      }                                          │ │ │
│  │  │    ],                                           │ │ │
│  │  │    stats: {                                     │ │ │
│  │  │      totalProjects: 8,                         │ │ │
│  │  │      avgIterations: 4.3,                       │ │ │
│  │  │      categoryBreakdown: {                      │ │ │
│  │  │        thermal: 3,                             │ │ │
│  │  │        safety: 2,                              │ │ │
│  │  │        aesthetics: 3                           │ │ │
│  │  │      }                                          │ │ │
│  │  │    }                                            │ │ │
│  │  │  }                                              │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  sessionStorage (Temporary, Session-Only)              │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Key: surveybuilder_conversation_[projectId]     │ │ │
│  │  │  Value: {                                        │ │ │
│  │  │    projectId: "abc123",                         │ │ │
│  │  │    messages: [                                   │ │ │
│  │  │      {                                          │ │ │
│  │  │        role: "user",                           │ │ │
│  │  │        content: "Create thermal survey",       │ │ │
│  │  │        timestamp: "2025-10-23T10:30:00",       │ │ │
│  │  │        metadata: { intent: "generate" }        │ │ │
│  │  │      },                                         │ │ │
│  │  │      {                                          │ │ │
│  │  │        role: "assistant",                      │ │ │
│  │  │        content: "Generated survey...",         │ │ │
│  │  │        timestamp: "2025-10-23T10:30:05",       │ │ │
│  │  │        metadata: { surveyGenerated: true }     │ │ │
│  │  │      }                                          │ │ │
│  │  │    ],                                           │ │ │
│  │  │    metadata: {                                  │ │ │
│  │  │      totalMessages: 10,                        │ │ │
│  │  │      startTime: "2025-10-23T10:00:00"          │ │ │
│  │  │    }                                            │ │ │
│  │  │  }                                              │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │  Key: surveybuilder_working_memory_[projectId]   │ │ │
│  │  │  Value: {                                        │ │ │
│  │  │    projectId: "abc123",                         │ │ │
│  │  │    surveyGoal: "Assess thermal comfort...",     │ │ │
│  │  │    iterations: [                                 │ │ │
│  │  │      {                                          │ │ │
│  │  │        timestamp: "2025-10-23T10:30:05",       │ │ │
│  │  │        instruction: "Create initial survey",   │ │ │
│  │  │        configSnapshot: {...}                   │ │ │
│  │  │      }                                          │ │ │
│  │  │    ],                                           │ │ │
│  │  │    designDecisions: [                           │ │ │
│  │  │      {                                          │ │ │
│  │  │        decision: "Use 1-7 scale",              │ │ │
│  │  │        rationale: "User preference",           │ │ │
│  │  │        timestamp: "2025-10-23T10:35:00"        │ │ │
│  │  │      }                                          │ │ │
│  │  │    ]                                            │ │ │
│  │  │  }                                              │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 Context Injection Strategy

```
┌─────────────────────────────────────────────────────────────┐
│             LLM PROMPT CONSTRUCTION                         │
│                                                             │
│  messages = [                                               │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ SYSTEM: Base Instructions                           │ │
│    │ • Available question types (text + image)           │ │
│    │ • Decision tree (demographics vs visual)            │ │
│    │ • Image configuration rules                         │ │
│    │ • JSON structure requirements                       │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ SYSTEM: Session Context (if contextEnabled)        │ │
│    │ • User expertise: "intermediate"                    │ │
│    │ • Preferences: 1-7 scales, 4 images, neutral option│ │
│    │ • History: 3 thermal surveys, avg 4.3 iterations   │ │
│    │ • Patterns: Prefers demographics first, images 2nd │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ SYSTEM: Working Context (if contextEnabled)        │ │
│    │ • Goal: "Assess thermal comfort in urban spaces"   │ │
│    │ • Iterations: 2 previous versions                   │ │
│    │ • Decisions: "Use 1-7 scale per user preference"   │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ USER: (from conversation history[0])                │ │
│    │ "Create a thermal comfort survey"                   │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ ASSISTANT: (from conversation history[1])           │ │
│    │ "Generated survey with 3 pages..."                  │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ USER: (from conversation history[2])                │ │
│    │ "Add more imagerating questions"                    │ │
│    └─────────────────────────────────────────────────────┘ │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ ASSISTANT: (from conversation history[3])           │ │
│    │ "Added 3 imagerating questions..."                  │ │
│    └─────────────────────────────────────────────────────┘ │
│    ...  (up to last 10 messages)                          │
│    ┌─────────────────────────────────────────────────────┐ │
│    │ USER: Current Message                               │ │
│    │ "Change all scales to 1-9"                          │ │
│    └─────────────────────────────────────────────────────┘ │
│  ]                                                          │
│                                                             │
│  → OpenAI API Call                                          │
│  → Response with full context awareness                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔀 Intent Classification Flow

```
┌──────────────────────────────────────────────────────┐
│  User Message: "Add an imagepicker question"        │
└────────────────────┬─────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  Build Intent Prompt                                 │
│  {                                                    │
│    message: "Add an imagepicker question",           │
│    currentSurveyExists: true,                        │
│    pageCount: 3,                                     │
│    questionCount: 12                                 │
│  }                                                    │
└────────────────────┬─────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  OpenAI Classification (GPT-4o)                      │
│  Prompt: "Classify this user intent..."             │
│  Response must be: generate / adjust / question      │
└────────────────────┬─────────────────────────────────┘
                     ↓
             ┌───────┴───────┐
             │    "adjust"   │
             └───────┬───────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  Route to Adjust Handler                             │
│  • Include current survey config                     │
│  • Include conversation history                      │
│  • Include enriched context                          │
│  • Call OpenAI: "Modify this survey..."             │
└────────────────────┬─────────────────────────────────┘
                     ↓
┌──────────────────────────────────────────────────────┐
│  Return Modified Survey Config                       │
│  {                                                    │
│    message: "Added imagepicker to Page 3",          │
│    surveyConfig: { ... },                           │
│    intent: "adjust"                                  │
│  }                                                    │
└──────────────────────────────────────────────────────┘
```

---

## 📈 Learning & Adaptation Flow

```
┌─────────────────────────────────────────────────────┐
│  User creates thermal survey                        │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Session Learning Records:                          │
│  • Category: "thermal"                              │
│  • Preferences detected:                            │
│    - Rating scale: 1-7                              │
│    - Image count: 4 per question                    │
│    - Structure: Demographics → Images → Text        │
│  • Iterations: 5                                    │
│  • Completion time: 15 minutes                      │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  localStorage Updated                               │
│  projectHistory.push({...})                         │
│  stats.avgIterations = recalculate()                │
│  preferences.update(detectedPreferences)            │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Next Time: User starts another thermal survey     │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  Session Learning Provides Context:                 │
│  "User has created 3 thermal surveys before.        │
│   Typical preferences:                              │
│   - 1-7 rating scales                               │
│   - 4 images per question                           │
│   - Average 4.3 iterations to finalize              │
│   Recommendation: Start with similar structure"     │
└─────────────────────┬───────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│  AI generates survey pre-configured with            │
│  user's learned preferences                         │
│  → Fewer iterations needed                          │
│  → Faster survey creation                           │
│  → Better user experience                           │
└─────────────────────────────────────────────────────┘
```

---

## 🎨 Visual Summary

### **Key Innovation: Multi-Layer Memory**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Traditional AI Assistant                         ┃
┃  • Stateless (no memory between sessions)         ┃
┃  • No user preference learning                    ┃
┃  • Same response for same prompt every time       ┃
┃  • High iteration count to get desired result     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                         VS
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  Contextual Engineering                           ┃
┃  ✓ 3-layer persistent memory                      ┃
┃  ✓ Learns user preferences automatically          ┃
┃  ✓ Adapts responses based on history              ┃
┃  ✓ Reduces iterations through smart defaults      ┃
┃  ✓ Context-aware multi-turn conversations         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## 🚀 Benefits

1. **Personalization**: AI learns and adapts to each user's preferences
2. **Efficiency**: Fewer iterations needed to achieve desired survey
3. **Context Awareness**: Multi-turn conversations with full memory
4. **Smart Recommendations**: Data-driven suggestions based on past behavior
5. **Progressive Enhancement**: System gets better the more you use it

---

## 📚 File Structure

```
src/
├── components/admin/
│   ├── SurveyBuilder.js       # Main container with CE integration
│   └── ChatAssistant.js       # Chat UI component
├── lib/
│   ├── conversationHistory.js # Layer 3: Session conversation
│   ├── workingMemory.js       # Layer 2: Project context
│   ├── sessionLearning.js     # Layer 1: Cross-session learning
│   └── chatApi.js             # Frontend API client
server.js                      # Backend with intelligent routing
```

---

**This architecture demonstrates a novel approach to AI-assisted survey design, moving beyond simple prompt-response to a truly context-aware, learning system.**

---

# 📚 Appendix: Complete System Documentation

This section consolidates all related documentation for the Contextual Engineering system and survey design platform.

---

## A. Question Types Reference

### 📊 Complete Question Types List (16 Types)

| Display Name (UI) | JSON Type | Category | Description |
|-------------------|-----------|----------|-------------|
| **Text Input** | `text` | Text-Based | Single-line text input |
| **Text Multi-line Input** | `comment` | Text-Based | Multi-line text area |
| **Text Single Choice** | `radiogroup` | Text-Based | Radio buttons (single selection) |
| **Text Multiple Choice** | `checkbox` | Text-Based | Checkboxes (multiple selection) |
| **Text Dropdown** | `dropdown` | Text-Based | Dropdown menu |
| **Text Ranking** | `ranking` | Text-Based | Drag-and-drop ranking |
| **Text Rating Scale** | `rating` | Text-Based | Numeric rating scale |
| **Text Yes/No** | `boolean` | Text-Based | Yes/No question |
| **Text Instruction** | `expression` | Text-Based | Display-only text/instructions |
| **Matrix** | `matrix` | Text-Based | Grid of questions |
| **Image Display** | `image` | Image Display | Show images (no question) |
| **Image Choice** | `imagepicker` | Image-Based | Select one or more images |
| **Image Ranking** | `imageranking` | Image-Based | Rank images by dragging |
| **Image Rating Scale** | `imagerating` | Image-Based | Rate images on numeric scale |
| **Image Yes/No** | `imageboolean` | Image-Based | Yes/No about an image |
| **Image Matrix** | `imagematrix` | Image-Based | Rate multiple images on criteria |

### 📂 Categories

**🔤 Text-Based Questions (10 types)** - For demographics/socioeconomic data:
- `text`, `comment`, `radiogroup`, `checkbox`, `dropdown`, `ranking`, `rating`, `boolean`, `expression`, `matrix`

**🖼️ Image Display (1 type)** - Show reference images:
- `image` - Must be followed by at least ONE text question

**🎨 Image-Based Questions (5 types)** - For visual perception:
- `imagepicker`, `imageranking`, `imagerating`, `imageboolean`, `imagematrix`
- All must include: `imageSelectionMode: "huggingface_random"`, `imageCount`, `choices: []`

### 🎯 Quick Reference

| Scenario | Type | Example |
|----------|------|---------|
| Demographics | `radiogroup` | "What is your age group?" |
| Open feedback | `comment` | "Additional comments" |
| Occupation | `text` | "What is your occupation?" |
| Rate comfort | `imagerating` | "Rate thermal comfort 1-5" |
| Choose preferred | `imagepicker` | "Pick your favorite street" |
| Rank by preference | `imageranking` | "Rank these streets" |
| Show then ask | `image` + `comment` | Show image → "Describe it" |
| Yes/No about image | `imageboolean` | "Would you feel safe?" |
| Multi-criteria | `imagematrix` | Rate on safety, comfort, beauty |

---

## B. Streetscape Survey Rules

### 🚨 Critical Rule

**NO STANDALONE TEXT QUESTIONS ABOUT STREETSCAPES!**

ALL non-socioeconomic text questions MUST have "image" display before them.

Only demographic questions (age, gender, education, occupation, income) can be pure text.

### 💡 Decision Tree

```
Is this text question about age, gender, education, occupation, or income?
├─ YES → Pure text question (NO image display needed)
└─ NO → Is it about streets, visual perception, or observations?
    └─ YES → MUST have "image" display before it!
```

### 📄 Page Composition Rules

**Each page can contain ONE OR MORE of:**

1. **Type 1: Socioeconomic Questions** (Multiple Allowed)
   - Pure text questions for demographics
   - Example: age, gender, education, occupation

2. **Type 2: Image-Based Streetscape Questions** (Multiple Allowed)
   - Use: `imagerating`, `imagepicker`, `imageranking`, `imageboolean`, `imagematrix`
   - Can have multiple on same page

3. **Type 3: Image Display + Text Questions** (Multiple Groups Allowed)
   - Structure: One `image` followed by one or MORE text questions
   - Forms a BINDING GROUP
   - This is the ONLY way to ask text questions about streets!

### 🔄 Flexible Mixing

Types 2 and 3 can intermix on the same page (both are streetscape questions):

```json
{
  "title": "Mixed Assessment",
  "questions": [
    {"type": "imagerating", "name": "rate_1", ...},
    {"type": "image", "name": "ref_1", ...},
    {"type": "comment", "name": "desc_1", ...},
    {"type": "text", "name": "feel_1", ...},
    {"type": "imagepicker", "name": "pick_1", ...}
  ]
}
```

### ❌ Common Mistakes

1. **Standalone streetscape text question**
   ```json
   {"type": "comment", "title": "Describe the street"}  // ❌ No image!
   ```

2. **Image display without text questions**
   ```json
   {"type": "image", ...}  // ❌ Must be followed by text questions!
   ```

3. **Breaking the binding**
   ```json
   [
     {"type": "image", ...},
     {"type": "imagerating", ...},  // ❌ Breaks binding!
     {"type": "comment", ...}        // ❌ Too late!
   ]
   ```

### ✅ Correct Patterns

```json
// Pattern 1: Socioeconomic (no image)
{"type": "radiogroup", "name": "age", ...}

// Pattern 2: Image-based streetscape
{"type": "imagerating", "name": "comfort", ...}

// Pattern 3: Image display + text (same page!)
[
  {"type": "image", "name": "ref_1", ...},
  {"type": "comment", "name": "desc", ...},
  {"type": "text", "name": "feel", ...}
]
```

---

## C. ChatGPT-Style User Interface

### 💬 Interface Components

**Main Chat Window:**
- Header with connection status and settings
- Scrollable conversation history with avatars
- Message input field with send button
- Real-time loading status display

**Settings Dialog:**
- OpenAI API key configuration
- API key validation
- Contextual Engineering toggle
- Smart recommendations display

**Status Indicators:**
- "Thinking..." - Analyzing user intent
- "Generating survey..." - Creating new survey
- "Adjusting survey..." - Modifying existing survey
- "Processing..." - Other operations

### 🎯 Key Features

1. **Intelligent Intent Detection**
   - AI automatically determines whether to generate, adjust, or answer
   - No need to explicitly say "Generate" or "Adjust"
   - Natural conversation flow

2. **Conversation History**
   - Full context awareness across multiple messages
   - Project-specific memory isolation
   - Persistent across page reloads (per-session)

3. **Smart Recommendations**
   - Based on session learning data
   - Adapts to user's survey design patterns
   - Suggests best practices

4. **Project-Specific Memory**
   - Each project maintains independent conversation history
   - Working memory tied to specific project
   - No cross-project contamination

### 💡 User Experience Examples

**Example 1: Quick Generation**
```
User: "Create a thermal comfort survey"
AI: [Thinking...] → [Generating survey...] 
    "Generated 3-page survey with demographics, visual ratings, and preferences"
```

**Example 2: Iterative Refinement**
```
User: "Add more variety to the questions"
AI: [Adjusting survey...] 
    "Added imagepicker and imageboolean questions to increase diversity"

User: "Make all scales 1-7"
AI: [Adjusting survey...] 
    "Updated all rating scales to 1-7 range"
```

**Example 3: Contextual Awareness**
```
User: "The thermal comfort questions should come first"
AI: [Adjusting survey...] 
    "Moved thermal comfort questions to page 2, before preference questions"
    
    // AI remembers which questions are "thermal comfort" from earlier conversation
```

---

## D. Prompt Engineering Guidelines

### 🎨 AI Diversity Encouragement

**Key Principle:** AI should use varied question types to create engaging surveys.

**Guidelines Embedded in Prompts:**

1. **Text-Based Variety**
   - Mix: `text`, `comment`, `radiogroup`, `checkbox`, `dropdown`, `ranking`, `rating`, `boolean`
   - Don't repeat the same type for similar questions

2. **Image-Based Variety**
   - Use ALL five types: `imagepicker`, `imageranking`, `imagerating`, `imageboolean`, `imagematrix`
   - Don't overuse `imagerating` - balance with other types
   - Example mix: rating for comfort, picker for preference, ranking for comparison, boolean for yes/no

3. **Balanced Surveys**
   - Appropriate type for each research goal
   - Variety keeps respondents engaged
   - Demonstrates platform capabilities

**Example Instructions to AI:**

```
Instead of only imagerating, also use:
- imagepicker (preference selection)
- imageranking (ordering by criteria)
- imageboolean (binary assessment)
- imagematrix (multi-dimensional evaluation)

For demographics: 
- Mix radiogroup (age), dropdown (education), text (occupation)

For streetscape text:
- Use comment (description), text (impression), radiogroup (walkability)
```

### 📝 Prompt Simplification Principles

**From Complex to Simple:**

**Before (Decorative):**
```
═══════════════════════════════════════
🎨 IMAGE-BASED QUESTIONS
═══════════════════════════════════════
✓ imagerating: Rate images on scale
✓ imagepicker: Choose one/multiple
✗ NEVER use "manual" mode
```

**After (Clean):**
```
IMAGE-BASED QUESTIONS:
- imagerating: Rate images on scale
- imagepicker: Choose one/multiple
- NEVER use "manual" mode
```

**Benefits:**
- Reduced token usage (~40% reduction)
- Faster processing
- Better LLM comprehension
- Easier maintenance

---

## E. Implementation Status

### 📊 All AI Endpoints Updated

| Endpoint | Status | Features |
|----------|--------|----------|
| `/api/openai/generate-survey` | ✅ Complete | Full rules, diversity, binding |
| `/api/openai/adjust-survey` | ✅ Complete | Concise rules, diversity |
| `/api/openai/generate-questions` | ✅ Complete | Array-focused, diversity |
| `/api/openai/chat` (generate) | ✅ Complete | Intent-based, diversity |
| `/api/openai/chat` (adjust) | ✅ Complete | Context-aware, diversity |
| `/api/openai/chat` (question) | ✅ Complete | User-facing, 16 types |

### 🔄 Update History

| Date | Commit | Update |
|------|--------|--------|
| 2025-10-23 | 992ada6 | Initial streetscape rule enforcement |
| 2025-10-23 | 3674050 | Flexible page composition mixing |
| 2025-10-23 | 022a253 | Critical clarification on text questions |
| 2025-10-23 | a86b83a | Question type diversity encouragement |
| 2025-10-23 | 00fedef | ChatGPT-style loading status |
| 2025-10-23 | 68730ab | Question types reference documentation |
| 2025-10-23 | 843f308 | README update with new features |

---

## F. Technical Implementation Details

### 🔧 Source Code Locations

**Frontend Components:**
```
src/components/admin/
├── SurveyBuilder.js          # Lines 200-910: Main CE integration
├── ChatAssistant.js           # Lines 44-476: Chat UI component
├── QuestionEditor.js          # Lines 51-68: Question types definition
└── PageEditor.js              # Lines 75-92, 321-339: Type labels
```

**Backend API:**
```
server.js
├── Lines 571-830:    /api/openai/generate-survey
├── Lines 832-940:    /api/openai/adjust-survey
├── Lines 942-1148:   /api/openai/generate-questions
└── Lines 1150-1435:  /api/openai/chat (intent routing)
```

**Contextual Engineering Modules:**
```
src/lib/
├── conversationHistory.js    # Conversation memory (per-project)
├── workingMemory.js          # Project context (per-project)
├── sessionLearning.js        # User preferences (global)
└── chatApi.js                # Frontend API client
```

### 📦 Storage Architecture

**sessionStorage (Per-Project):**
- `conversation_history_${projectId}` - Chat messages
- `working_memory_${projectId}` - Design decisions

**localStorage (Global):**
- `session_learning` - User preferences, expertise, statistics

**Memory Lifecycle:**
- Session storage: Cleared on tab close
- Local storage: Persists indefinitely
- Project-specific data isolated by project ID

---

## G. Best Practices & Guidelines

### 🎯 For Survey Designers

1. **Use AI for Rapid Prototyping**
   - Start with natural language description
   - Let AI create initial structure
   - Refine manually for precision

2. **Enable Contextual Engineering**
   - Toggle on for smarter interactions
   - Each project gets independent memory
   - AI learns your preferences over time

3. **Leverage Question Type Diversity**
   - Don't stick to one type
   - Mix imagerating, imagepicker, imageranking
   - Use appropriate types for each goal

4. **Follow Streetscape Rules**
   - Demographics: pure text
   - Visual assessment: image-based questions
   - Text about streets: image display + text (same page!)

### 🛠️ For Developers

1. **Extending the System**
   - Add new question types in `QuestionEditor.js`
   - Update AI prompts in `server.js`
   - Add to diversity guidelines

2. **Modifying Memory Layers**
   - Conversation history: short-term, per-project
   - Working memory: design context, per-project
   - Session learning: long-term, cross-project

3. **Customizing AI Behavior**
   - Edit prompts in `server.js` endpoints
   - Adjust temperature (0.5-0.7 for surveys)
   - Modify max_tokens for response length

4. **Adding New Intents**
   - Update intent classification prompt
   - Add new routing logic in chat endpoint
   - Create corresponding handler

---

## H. Research & Academic Context

### 📄 Citation

This platform was developed for the Thermal Affordance research:

```bibtex
@article{yang2025thermal,
  title={Thermal comfort in sight: Thermal affordance and its visual assessment 
         for sustainable streetscape design},
  author={Yang, Sijie and Chong, Adrian and Liu, Pengyuan and Biljecki, Filip},
  journal={Building and Environment},
  pages={112569},
  year={2025},
  publisher={Elsevier}
}
```

### 🎓 Key Contributions

1. **Contextual Engineering Architecture**
   - Novel approach to AI-assisted survey design
   - Three-layer memory system
   - Project-specific vs. cross-project learning

2. **Streetscape Survey Methodology**
   - Validated question type combinations
   - Image-based assessment protocols
   - Critical binding rules for data quality

3. **Open Research Platform**
   - Reusable templates from published studies
   - Extensible architecture for new research
   - Community-driven development

---

## I. Glossary

**Contextual Engineering:** A system design approach that provides AI with dynamic, multi-layered context through conversation history, working memory, and session learning.

**Binding Group:** A set of questions where an image display element must be immediately followed by text questions about that image, forming an inseparable unit.

**Image Selection Mode:** Configuration determining how images are loaded:
- `huggingface_random`: Random selection from dataset
- `huggingface_manual`: Manually selected specific images
- `manual`: Legacy mode (deprecated)

**Intent Detection:** AI's ability to automatically determine whether user wants to generate, adjust, or ask questions, without explicit commands.

**Working Memory:** Short-term, project-specific memory tracking current survey goals, design decisions, and iteration history.

**Session Learning:** Long-term, cross-project memory learning user preferences, expertise level, and usage patterns.

**Question Type Diversity:** Principle of using varied question types to create engaging, well-balanced surveys rather than repetitive question formats.

---

**Last Updated:** 2025-10-23  
**Branch:** `feature/contextual-engineering`  
**Platform Version:** 2.0 (with Contextual Engineering)

---

**This comprehensive documentation consolidates all aspects of the Contextual Engineering system, survey design rules, question types, UI implementation, and technical details into a single authoritative reference.**

