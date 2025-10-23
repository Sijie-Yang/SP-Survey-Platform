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

