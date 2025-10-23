# Streetscape Survey Rule Enforcement

## 📋 Overview

This document describes the critical rule enforced across all AI endpoints to ensure proper question design for streetscape surveys.

---

## 🚨 Critical Rule

**NO STANDALONE TEXT QUESTIONS ABOUT STREETSCAPES!**

All streetscape-related questions MUST be paired with images.
Only demographic/socioeconomic questions can be pure text.

---

## ✅ Correct Usage

### **Scenario 1: Demographics (Text Only)**
```json
{
  "type": "radiogroup",
  "name": "age",
  "title": "What is your age group?",
  "choices": ["18-24", "25-34", "35-44", "45+"]
}
```
✓ Pure text questions are ONLY for demographics: age, gender, education, occupation, income

---

### **Scenario 2: Streetscape Visual Assessment (Image-Based Questions)**
```json
{
  "type": "imagerating",
  "name": "thermal_comfort",
  "title": "How comfortable does this street look?",
  "imageCount": 1,
  "imageSelectionMode": "huggingface_random",
  "randomImageSelection": true,
  "rateMin": 1,
  "rateMax": 5,
  "minRateDescription": "Not comfortable",
  "maxRateDescription": "Very comfortable",
  "choices": []
}
```
✓ Use image-based question types: `imagerating`, `imagepicker`, `imageranking`, `imageboolean`, `imagematrix`

---

### **Scenario 3: Streetscape Description (Image Display + Text)**
```json
{
  "title": "Street Description",
  "questions": [
    {
      "type": "image",
      "name": "street_ref_1",
      "imageSelectionMode": "huggingface_random",
      "imageCount": 1,
      "choices": []
    },
    {
      "type": "comment",
      "name": "street_description",
      "title": "Describe what you see in this street scene",
      "isRequired": true
    }
  ]
}
```
✓ Image display and text question MUST be on the SAME PAGE

---

## ❌ Incorrect Usage

### **WRONG: Standalone streetscape text question**
```json
{
  "type": "comment",
  "name": "street_opinion",
  "title": "What do you think about the street's appearance?"
}
```
❌ This asks about street appearance without showing any image!

---

### **WRONG: Image and text question on different pages**
```json
// Page 1
{
  "title": "Street View",
  "questions": [
    {"type": "image", "name": "street_1", ...}
  ]
}

// Page 2
{
  "title": "Your Opinion",
  "questions": [
    {"type": "comment", "name": "opinion", "title": "Describe the street"}
  ]
}
```
❌ Image and text question are split across pages!

---

## 🎯 Why This Rule?

1. **User Experience**: Users cannot answer questions about street appearance without seeing the street
2. **Data Quality**: Visual context is essential for meaningful responses about streetscapes
3. **Logical Consistency**: All streetscape questions require visual reference
4. **Platform Design**: The system is built for visual perception surveys

---

## 📊 Implementation Status

All 6 AI endpoints have been updated with this rule:

| Endpoint | Status | Commit |
|----------|--------|--------|
| `/api/openai/generate-survey` | ✅ Updated | 992ada6 |
| `/api/openai/adjust-survey` | ✅ Updated | 489dfb9 |
| `/api/openai/generate-questions` | ✅ Updated | 489dfb9 |
| `/api/openai/chat` (generate) | ✅ Updated | 76634f9 |
| `/api/openai/chat` (adjust) | ✅ Updated | 76634f9 |
| `/api/openai/chat` (question) | ✅ Updated | 76634f9 |

---

## 🔄 Decision Tree

```
Is this a demographic/socioeconomic question?
├─ YES → Use pure text question (age, gender, education, occupation)
└─ NO → Is this about streetscape?
    └─ YES → MUST use images!
        ├─ Option A: Image-based question type (imagerating, imagepicker, etc.)
        └─ Option B: "image" display + text question (SAME page!)
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

Last Updated: 2025-10-23
Branch: `feature/contextual-engineering`

