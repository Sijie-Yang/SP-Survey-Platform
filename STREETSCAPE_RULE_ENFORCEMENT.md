# Streetscape Survey Rule Enforcement

## 📋 Overview

This document describes the critical rule and flexible page composition guidelines enforced across all AI endpoints to ensure proper question design for streetscape surveys.

---

## 🚨 Critical Rule

**NO STANDALONE TEXT QUESTIONS ABOUT STREETSCAPES!**

**ALL non-socioeconomic text questions MUST have "image" display before them.**

Only demographic/socioeconomic questions (age, gender, education, occupation, income) can be pure text.

Any text question about streets, visual perception, or observations MUST be preceded by an "image" display element.

---

## 💡 Understanding the Rule

**Key Question: What type of text question is this?**

```
Is this text question about age, gender, education, occupation, or income?
├─ YES → Pure text question (NO image display needed)
└─ NO → Is it about streets, visual perception, or observations?
    └─ YES → MUST have "image" display before it!
```

**Examples:**
- ✅ "What is your age?" → Pure text (socioeconomic)
- ✅ "What is your occupation?" → Pure text (socioeconomic)
- ❌ "Describe this street" → **WRONG!** Must have image display first
- ✅ [image display] + "Describe this street" → **CORRECT!**
- ❌ "What do you think about street lighting?" → **WRONG!** Must have image display first
- ✅ [image display] + "What do you think about this street's lighting?" → **CORRECT!**

---

## 📄 Page Composition Rules

**Each page can contain ONE OR MORE of the following:**

### **Type 1: Socioeconomic Questions (Multiple Allowed)**
```json
{
  "title": "Background Information",
  "questions": [
    {"type": "radiogroup", "name": "age", "title": "Age group?", "choices": ["18-24", "25-34", "35-44", "45+"]},
    {"type": "radiogroup", "name": "gender", "title": "Gender?", "choices": ["Male", "Female", "Other"]},
    {"type": "dropdown", "name": "education", "title": "Education level?", "choices": ["High school", "Bachelor", "Master", "PhD"]}
  ]
}
```
✓ Multiple socioeconomic questions on same page  
✓ Pure text questions ONLY for: age, gender, education, occupation, income

---

### **Type 2: Image-Based Streetscape Questions (Multiple Allowed)**
```json
{
  "title": "Street Assessment",
  "questions": [
    {
      "type": "imagerating",
      "name": "comfort",
      "title": "Rate the comfort",
      "imageCount": 1,
      "imageSelectionMode": "huggingface_random",
      "rateMin": 1,
      "rateMax": 5,
      "choices": []
    },
    {
      "type": "imagepicker",
      "name": "preference",
      "title": "Which street do you prefer?",
      "imageCount": 4,
      "imageSelectionMode": "huggingface_random",
      "choices": []
    }
  ]
}
```
✓ Multiple image-based questions on same page  
✓ Use: `imagerating`, `imagepicker`, `imageranking`, `imageboolean`, `imagematrix`

---

### **Type 3: Image Display + Text Questions (Multiple Groups Allowed)**

**This is the ONLY way to ask text questions about streets!**

```json
{
  "title": "Street Description",
  "questions": [
    {"type": "image", "name": "street_1", "imageCount": 1, "imageSelectionMode": "huggingface_random", "choices": []},
    {"type": "comment", "name": "description_1", "title": "Describe what you see"},
    {"type": "text", "name": "impression_1", "title": "First impression?"},
    {"type": "radiogroup", "name": "walkable_1", "title": "Is it walkable?", "choices": ["Yes", "No"]}
  ]
}
```
✓ One `image` display MUST be followed by one or MORE text questions  
✓ Multiple text questions can refer to the same image  
✓ Forms a BINDING GROUP  
✓ **ALL non-socioeconomic text questions MUST use this pattern**

---

## 🔄 Flexible Mixing (NEW)

**Types 2 and 3 can intermix on the same page** (both are streetscape questions):

```json
{
  "title": "Mixed Streetscape Assessment",
  "questions": [
    {"type": "imagerating", "name": "rate_1", "title": "Rate this street", "imageCount": 1, "imageSelectionMode": "huggingface_random", "choices": []},
    
    {"type": "image", "name": "ref_1", "imageCount": 1, "imageSelectionMode": "huggingface_random", "choices": []},
    {"type": "comment", "name": "desc_1", "title": "Describe this street"},
    {"type": "text", "name": "feel_1", "title": "How does it make you feel?"},
    
    {"type": "imagepicker", "name": "pick_1", "title": "Pick preferred street", "imageCount": 3, "imageSelectionMode": "huggingface_random", "choices": []},
    
    {"type": "image", "name": "ref_2", "imageCount": 1, "imageSelectionMode": "huggingface_random", "choices": []},
    {"type": "comment", "name": "desc_2", "title": "Describe this different street"}
  ]
}
```

✓ Valid: `[imagerating, image+2texts, imagepicker, image+1text]`  
✓ Both Type 2 and Type 3 are streetscape questions, so they can coexist on same page

---

## ❌ Incorrect Usage

### **WRONG #1: Standalone streetscape text question**
```json
{
  "type": "comment",
  "name": "street_opinion",
  "title": "What do you think about the street's appearance?"
}
```
❌ This asks about street appearance without showing any image!

---

### **WRONG #2: Image display without following text questions**
```json
{
  "title": "Street View",
  "questions": [
    {"type": "image", "name": "street_1", "imageCount": 1, "imageSelectionMode": "huggingface_random", "choices": []}
  ]
}
```
❌ Image display must be followed by at least ONE text question!

---

### **WRONG #3: Breaking the binding (inserting image-based question between image and its text)**
```json
{
  "title": "Mixed (WRONG)",
  "questions": [
    {"type": "image", "name": "street_1", ...},
    {"type": "imagerating", "name": "rate_1", ...},  // ❌ Breaks binding!
    {"type": "comment", "name": "desc_1", "title": "Describe street_1"}  // ❌ Too late!
  ]
}
```
❌ Text questions must immediately follow their image display (before any image-based question)

---

## 🎯 Why This Rule?

1. **User Experience**: Users cannot answer questions about street appearance without seeing the street
   - ❌ "Describe the street's appearance" (without image) → User: "Which street?"
   - ✅ [image] + "Describe this street's appearance" → User can see and respond

2. **Data Quality**: Visual context is essential for meaningful responses about streetscapes
   - Without images, users might imagine different scenarios
   - With images, all responses refer to the same visual stimulus

3. **Logical Consistency**: ALL streetscape questions require visual reference
   - **Exception**: Only socioeconomic questions (age, gender, education, occupation, income)
   - **Rule**: Everything else about streets needs an image display

4. **Platform Design**: The system is built for visual perception surveys
   - Streetscape = visual by definition
   - Text questions about streets without images violate the core purpose

---

## 📊 Implementation Status

All 6 AI endpoints have been updated with flexible page composition rules:

| Endpoint | Status | Initial | Flexible Mixing | Latest Commit |
|----------|--------|---------|-----------------|---------------|
| `/api/openai/generate-survey` | ✅ Updated | 992ada6 | 3674050 | Full detailed rules |
| `/api/openai/adjust-survey` | ✅ Updated | 489dfb9 | 3674050 | Concise version |
| `/api/openai/generate-questions` | ✅ Updated | 489dfb9 | 3674050 | Array-focused |
| `/api/openai/chat` (generate) | ✅ Updated | 76634f9 | 3674050 | Concise version |
| `/api/openai/chat` (adjust) | ✅ Updated | 76634f9 | 3674050 | Concise version |
| `/api/openai/chat` (question) | ✅ Updated | 76634f9 | 3674050 | User-facing |

**Update History:**
- **992ada6-76634f9**: Initial rule enforcement (no standalone streetscape text questions)
- **3674050**: Flexible mixing support (Types 2 and 3 can intermix, multiple questions per type)
- **022a253**: Critical clarification (ALL non-socioeconomic text questions MUST have image display)

---

## 🔄 Decision Tree (Updated)

```
For EACH TEXT QUESTION, ask:

Q1: What is this text question about?
├─ About age, gender, education, occupation, or income?
│  └─ YES → Type 1: Pure text question (NO image needed) ✅
│
└─ NO → About streets, visual perception, or observations?
   └─ YES → Type 3: MUST use image display + text question ✅
           [image, text1, text2, ...]
   
   ❌ NEVER: Standalone text question about streets without image display!


For EACH PAGE, plan:

1. What type(s) of questions do I need?
   ├─ Only demographics? → Type 1 (multiple pure text questions)
   ├─ Only streetscape ratings/selections? → Type 2 (multiple image-based questions)
   ├─ Only streetscape text questions? → Type 3 (image + multiple text questions)
   └─ Mixed streetscape questions? → Combine Type 2 and Type 3
       Example: [imagerating, image+text+text, imagepicker]

2. If using Type 3, are the groups properly structured?
   ├─ [image, text, text, imagerating] → ✓ Valid (binding maintained)
   ├─ [image, imagerating, text] → ❌ Invalid (binding broken)
   └─ [image, text, text, image, text] → ✓ Valid (two separate groups)

3. Double-check: Any text questions about streets without image display?
   ├─ NO → ✓ Valid survey
   └─ YES → ❌ Invalid! Add image display before those text questions
```

---

## 📝 Prompt Simplification

As part of this update, all prompts were also simplified:
- Removed decorative symbols (═══, 📝, 🖼️, 🎨, ✓, ✗, ⚠️)
- Reduced prompt length by ~40%
- Improved LLM comprehension
- Maintained all critical information

---

## 🎉 Result

- **Consistent**: Same rule across all endpoints
- **Clear**: Simple and easy to understand
- **Effective**: LLM generates correct question types
- **Maintainable**: Cleaner, more concise prompts

---

## 📚 Related Documents

- `PROMPT_SIMPLIFICATION_PLAN.md` - Initial planning (deleted after completion)
- `PROMPT_COMPARISON_SUMMARY.md` - Comparison with main branch style
- `CONTEXTUAL_ENGINEERING.md` - AI memory system
- `CHAT_UI_GUIDE.md` - User guide for ChatGPT-style UI

---

## 🎉 Key Benefits of Flexible Mixing

1. **Realistic Survey Design**: Mirrors actual research patterns where multiple question types coexist
2. **Greater Flexibility**: Designers can organize questions more naturally
3. **Maintains Quality**: Still enforces critical binding rules
4. **Better AI Understanding**: Clear structure for binding relationships
5. **Complex Multi-Topic Pages**: Supports sophisticated survey designs

---

Last Updated: 2025-10-23 (Critical Clarification: ALL non-socioeconomic text questions need image display)
Branch: `feature/contextual-engineering`

