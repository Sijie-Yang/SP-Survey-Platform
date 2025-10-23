# Question Types Reference

This document lists all available question types in the Survey Builder, showing their display names and JSON `type` values.

---

## 📊 Complete Question Types List

| Display Name (UI) | JSON Type Value | Category | Description |
|-------------------|----------------|----------|-------------|
| **Text Input** | `text` | Text-Based | Single-line text input field |
| **Text Multi-line Input** | `comment` | Text-Based | Multi-line text area for longer responses |
| **Text Single Choice** | `radiogroup` | Text-Based | Radio buttons for selecting one option |
| **Text Multiple Choice** | `checkbox` | Text-Based | Checkboxes for selecting multiple options |
| **Text Dropdown** | `dropdown` | Text-Based | Dropdown menu for single selection |
| **Text Ranking** | `ranking` | Text-Based | Drag-and-drop ranking of text options |
| **Text Rating Scale** | `rating` | Text-Based | Numeric rating scale with text labels |
| **Text Yes/No** | `boolean` | Text-Based | Simple Yes/No question |
| **Text Instruction** | `expression` | Text-Based | Display-only text/instructions (no input) |
| **Matrix** | `matrix` | Text-Based | Grid of questions with shared answer options |
| **Image Display** | `image` | Image Display | Shows one or more images (no question, for reference) |
| **Image Choice** | `imagepicker` | Image-Based | Select one or more images from a set |
| **Image Ranking** | `imageranking` | Image-Based | Drag-and-drop ranking of images |
| **Image Rating Scale** | `imagerating` | Image-Based | Rate images on a numeric scale |
| **Image Yes/No** | `imageboolean` | Image-Based | Yes/No question about an image |
| **Image Matrix** | `imagematrix` | Image-Based | Rate multiple images on multiple criteria |

---

## 📂 Categories

### 🔤 Text-Based Questions (10 types)
Questions that use text choices and don't require images:
- `text` - Text Input
- `comment` - Text Multi-line Input
- `radiogroup` - Text Single Choice
- `checkbox` - Text Multiple Choice
- `dropdown` - Text Dropdown
- `ranking` - Text Ranking
- `rating` - Text Rating Scale
- `boolean` - Text Yes/No
- `expression` - Text Instruction
- `matrix` - Matrix

**Use Case**: Demographic/socioeconomic questions (age, gender, education, occupation, income)

---

### 🖼️ Image Display (1 type)
Display images without asking a question:
- `image` - Image Display

**Use Case**: Show reference images before text questions about streetscapes

**Critical Rule**: Must be followed by at least ONE text question about the displayed image

---

### 🎨 Image-Based Questions (5 types)
Questions where users interact with images:
- `imagepicker` - Image Choice
- `imageranking` - Image Ranking
- `imagerating` - Image Rating Scale
- `imageboolean` - Image Yes/No
- `imagematrix` - Image Matrix

**Use Case**: Visual perception/assessment questions about streetscapes

**Technical Requirement**: All image-based questions must include:
- `imageSelectionMode: "huggingface_random"`
- `imageCount: <number>`
- `randomImageSelection: true`
- `choices: []` (empty array, or `imageLinks: []` for imagematrix)

---

## 🎯 Usage Guidelines

### For Socioeconomic Questions
Use **Text-Based Questions** only:
```json
{
  "type": "radiogroup",
  "name": "age",
  "title": "What is your age group?",
  "choices": ["18-24", "25-34", "35-44", "45+"]
}
```

### For Streetscape Visual Assessment
Use **Image-Based Questions**:
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

### For Streetscape Text Questions
Use **Image Display + Text Questions**:
```json
[
  {
    "type": "image",
    "name": "street_ref_1",
    "imageCount": 1,
    "imageSelectionMode": "huggingface_random",
    "choices": []
  },
  {
    "type": "comment",
    "name": "street_description",
    "title": "Describe what you see in this street scene",
    "isRequired": true
  }
]
```

---

## 🔍 Special Notes

### Image Ranking vs Text Ranking
- **`imageranking`**: Users drag and drop images to rank them
- **`ranking`**: Users drag and drop text options to rank them
- **Legacy**: Older surveys may use `ranking` with `isImageRanking: true` flag

### Image Display
- **`image`** type is special: it displays images but doesn't ask a question
- Must be followed by text questions (e.g., `comment`, `text`, `radiogroup`)
- Used to show reference images before asking for text descriptions/opinions

### Matrix Types
- **`matrix`**: Text-based grid (questions as rows, answer options as columns)
- **`imagematrix`**: Image-based grid (images as rows, rating criteria as columns)

### Expression
- **`expression`** type doesn't collect user input
- Used for displaying instructions, explanations, or formatted text
- Can include HTML formatting

---

## 📋 Quick Reference

### Most Common Types

| Scenario | Recommended Type | Example |
|----------|-----------------|---------|
| Age, gender, education | `radiogroup` | "What is your age group?" |
| Open-ended feedback | `comment` | "Please provide additional comments" |
| Name, occupation | `text` | "What is your occupation?" |
| Rate street comfort | `imagerating` | "Rate the thermal comfort" |
| Choose preferred street | `imagepicker` | "Which street do you prefer?" |
| Rank streets by preference | `imageranking` | "Rank these streets" |
| Show street, then ask text | `image` + `comment` | Show image → "Describe this street" |
| Yes/No about street | `imageboolean` | "Would you feel safe here?" |
| Multiple criteria rating | `imagematrix` | Rate images on safety, comfort, beauty |

---

## 🚨 Critical Rules

1. **Text questions about streetscapes** → MUST use `image` display before them
2. **Socioeconomic text questions** → NO image needed (pure text)
3. **Image-based questions** → Always use `huggingface_random` mode
4. **Image display** → Must be followed by at least ONE text question

---

## 📝 Implementation Reference

**Source Files:**
- `src/components/admin/QuestionEditor.js` (lines 51-68)
- `src/components/admin/PageEditor.js` (lines 75-92, 321-339)

**Last Updated:** 2025-10-23  
**Branch:** `feature/contextual-engineering`

