# 🤖 AI Chat Assistant - User Guide

## 🎨 New Interface Overview

```
┌────────────────────────────────────────────────────────────┐
│ 🤖 AI Assistant   [✓ Connected]   [🔽] [✕] [⚙️]          │ ← Header
├────────────────────────────────────────────────────────────┤
│ 💡 Smart Recommendations (if available)                   │ ← Recommendations Bar
│ [Chip] [Chip] [Chip]                                       │
├────────────────────────────────────────────────────────────┤
│                   Chat History Area                        │ ← Conversation Display
│ (400px height, auto-scroll to bottom)                      │
│                                                             │
│ 👤 You · 4:30 PM                                           │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Create a thermal comfort survey                     │   │ ← User Message
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ 🤖 AI Assistant · 4:31 PM  [generate]                      │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Generated new survey with 3 pages                   │   │ ← AI Response
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
├────────────────────────────────────────────────────────────┤
│ Type your message... (supports Shift+Enter)           [📤]│ ← Input Area
│ 🧠 Contextual Engineering enabled • I remember...          │
└────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Step 1: Configure API Key

1. Click **⚙️ Settings** button (top right)
2. Paste your OpenAI API Key
3. Click **Validate**
4. See **✓ Connected** badge appear
5. Close settings dialog

### Step 2: Start Chatting!

Just type naturally in the input box. The AI will automatically detect what you want:

#### Example 1: Generate New Survey
```
You: Create a thermal comfort survey with demographics and image ratings

AI: ✓ Detected intent: generate
    Generated new survey with 3 pages
    [Survey appears in editor]
```

#### Example 2: Modify Existing Survey
```
You: Add an imagepicker question for street type preference

AI: ✓ Detected intent: adjust
    Adjusted survey based on your request
    [Question added to survey]
```

#### Example 3: Ask Questions
```
You: What question types are available?

AI: ✓ Detected intent: question
    We have 16 question types including...
```

---

## 🎯 Key Features

### 1. **Intelligent Intent Detection**

No need to choose "Generate" vs "Adjust" buttons. The AI figures it out:

- **"Create/Generate/Build..."** → Generates new survey
- **"Add/Change/Remove/Modify..."** → Adjusts existing survey
- **"What/How/Why..."** → Answers your question

### 2. **Multi-Turn Conversations**

The AI remembers everything in the session:

```
You: Create a streetscape survey
AI:  ✓ Generated survey with 2 pages

You: Add more image questions
AI:  ✓ Added 3 imagerating questions to page 2
     (AI knows which survey you're talking about!)

You: Change scales to 1-7
AI:  ✓ Updated all rating scales to 1-7
     (AI remembers the previous changes!)
```

### 3. **Contextual Engineering** (Optional)

When enabled (default: ON):
- AI learns your preferences (rating scales, image counts, etc.)
- Remembers your past projects
- Provides personalized recommendations
- Tracks your expertise level

Toggle in **Settings → Contextual Engineering**

### 4. **Smart Recommendations**

Based on your history, you'll see tips like:
- "You've created 3 thermal surveys before. Avg iterations: 4.3"
- "For thermal surveys, you typically prefer 1-7 scales"
- "Pro tip: Start with a template and modify it"

---

## ⌨️ Keyboard Shortcuts

- **Enter**: Send message
- **Shift + Enter**: New line in message
- **Cmd/Ctrl + Shift + R**: Hard refresh (clear cache)

---

## 🔧 Settings Dialog

Click **⚙️** button to access:

### OpenAI API Key
- Input field with password masking
- Validate button
- Stored in session (not saved to disk)

### Contextual Engineering
- Toggle ON/OFF
- See what's included:
  - Conversation History
  - Working Memory
  - Session Learning

---

## 💡 Pro Tips

### Tip 1: Be Natural
```
✅ Good: "Create a thermal comfort survey"
✅ Good: "Add an imagepicker"
✅ Good: "Change all scales to 1-7"

❌ Avoid: JSON syntax or technical terms
```

### Tip 2: Iterative Design
```
1. Start simple: "Create a basic streetscape survey"
2. Refine: "Add more image questions"
3. Adjust: "Change the rating scales"
4. Polish: "Add a demographics page at the start"
```

### Tip 3: Use Context
```
You: Create a survey about thermal comfort
AI:  ✓ Generated survey

You: Make it longer
AI:  ✓ (knows you mean the thermal survey)

You: Add Chinese language support
AI:  ✓ (applies to the same survey)
```

---

## 📊 Message Types

Messages show different badges based on action:

- **[generate]**: New survey created
- **[adjust]**: Existing survey modified
- **[question]**: Information provided
- **[system]**: Status messages (API key, errors)

---

## 🐛 Troubleshooting

### "Please configure API key first"
→ Click ⚙️ Settings, add API key, click Validate

### No response after sending message
→ Check browser console (F12) for errors
→ Verify backend is running on http://localhost:3001

### AI generates wrong type of action
→ Be more explicit: "Generate a NEW survey" or "Adjust my CURRENT survey"

### Conversation history not showing
→ Enable "Contextual Engineering" in Settings
→ Check browser's sessionStorage is not disabled

---

## 🔄 Conversation Management

### Download History
Click **🔽** button → Downloads JSON file with:
- All messages
- Timestamps
- Metadata
- Statistics

### Clear History
Click **✕** button → Confirms and clears all messages

---

## 🎓 Example Conversation

```
┌────────────────────────────────────────────────────────────┐
│ You: Create a thermal comfort survey                       │
├────────────────────────────────────────────────────────────┤
│ AI: Generated new survey with 3 pages                      │
│     ✓ Page 1: Demographics                                 │
│     ✓ Page 2: Thermal Comfort Assessment                   │
│     ✓ Page 3: Preferences                                  │
├────────────────────────────────────────────────────────────┤
│ You: Add an imagepicker question for street type           │
├────────────────────────────────────────────────────────────┤
│ AI: Adjusted survey based on your request                  │
│     ✓ Added imagepicker to Page 3                          │
│     ✓ Question: "Which street type do you prefer?"         │
│     ✓ Shows 4 random images from dataset                   │
├────────────────────────────────────────────────────────────┤
│ You: Change all rating scales to 1-7                       │
├────────────────────────────────────────────────────────────┤
│ AI: Adjusted survey based on your request                  │
│     ✓ Updated 4 imagerating questions                      │
│     ✓ New scale: 1 (Very Uncomfortable) to 7 (Very Comfortable) │
├────────────────────────────────────────────────────────────┤
│ You: Perfect! How many questions total?                    │
├────────────────────────────────────────────────────────────┤
│ AI: Your survey has 12 questions across 3 pages:           │
│     - Page 1 (Demographics): 3 questions                   │
│     - Page 2 (Assessment): 4 questions                     │
│     - Page 3 (Preferences): 5 questions                    │
└────────────────────────────────────────────────────────────┘
```

---

## 🆚 Old UI vs New UI

### Old Interface (Hidden):
- Separate "Generate" and "Adjust" sections
- Had to choose which action
- Settings in collapsed accordion
- History in separate section

### New Interface (Current):
- **Single input box** for everything
- AI **auto-detects** your intent
- **Settings in dialog** (⚙️ button)
- **History always visible** in chat
- **Cleaner, modern design**

---

## 🚀 Advanced Features

### 1. Multi-Language Support
```
You: Create a survey in Chinese and English
AI: ✓ Generated bilingual survey
```

### 2. Template-Based Generation
```
You: Generate a survey similar to the SPECS template
AI: ✓ Generated survey based on SPECS structure
```

### 3. Conditional Logic
```
You: Add skip logic - show page 2 only if age > 18
AI: ✓ Added conditional visibility rules
```

---

## 📈 Contextual Engineering Benefits

With CE enabled, AI progressively gets better:

**First Survey:**
```
You: Create a thermal survey
AI:  [Uses default settings]
```

**Third Survey:**
```
You: Create another thermal survey
AI:  [Automatically uses 1-7 scales, 4 images per question]
     (Learned from your past preferences!)
```

**Fifth Survey:**
```
You: Make a thermal survey
AI:  [Matches your typical structure: 3 pages, demographics first]
     Shows: "Based on your 4 previous thermal surveys..."
```

---

## 🎉 Enjoy Your New AI Assistant!

Questions? Check the console (F12) for debug logs or open an issue on GitHub.

Happy survey building! 🚀

