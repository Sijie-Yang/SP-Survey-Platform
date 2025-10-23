# Prompt Simplification Plan

## Key Issues Found (compared to main branch):

1. **Too many decorative elements**: ═══, 📝, 🖼️, 🎨, ✓, ✗, ⚠️, 🔹
2. **Over-complicated structure**: SCENARIO 1/2/3 sections are too verbose
3. **Redundant explanations**: Main branch is much more concise
4. **ASCII tree diagrams**: Should be simple bullet points

## Main Branch Style (Simple & Clean):

```
IMPORTANT GUIDELINES:
1. **For demographic/socioeconomic questions**: Use text-based questions WITHOUT images
   Example: age, gender, income

2. **For visual perception/assessment questions**: PREFER image-based questions
   Example: "Pick your preferred street", "Rate the thermal comfort"

3. **For text-based streetscape questions**: Add an "image" type question BEFORE it
   Example sequence:
   [
     {"type": "image", "name": "street_display_1", ...},
     {"type": "text", "name": "street_description", ...}
   ]

4. All image-based questions MUST include:
   - imageCount property
   - imageSelectionMode: "huggingface_random"
   - randomImageSelection: true
   - choices: []

5. For imagerating, include minRateDescription and maxRateDescription

6. NEVER use "manual" mode or provide imageLink URLs

**DECISION TREE:**
- Demographic/background question? → text-based, NO image
- Visual assessment question? → image-based question type
- Text question about streetscape? → "image" type display FIRST, then text question

Generate a professional, well-structured survey. Return ONLY valid JSON, no markdown or explanations.
```

## Actions Required:

1. Remove all decorative separators (═══)
2. Remove all emoji icons (📝🖼️🎨✓✗⚠️🔹)
3. Replace complex SCENARIO sections with concise IMPORTANT GUIDELINES
4. Replace ASCII tree diagrams with simple bullet points
5. Keep all critical information but in compact form
6. Ensure paging rule is still mentioned (image + text must be on same page)

## Endpoints to Update:

- ✅ /api/openai/generate-survey (DONE - 213 lines removed!)
- ⏳ /api/openai/adjust-survey
- ⏳ /api/openai/generate-questions  
- ⏳ /api/openai/chat (3 branches: generate, adjust, question)

