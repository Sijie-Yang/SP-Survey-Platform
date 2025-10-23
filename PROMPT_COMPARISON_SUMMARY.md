# Prompt对比总结：Main vs Feature分支

## ✅ 已完成的改进

### 1. `/api/openai/generate-survey` 端点
- **状态**: 已简化 ✅
- **删除**: 213行冗余代码
- **结果**: 现在和 main 分支风格一致

---

## ⚠️ 仍需改进的端点

### 2. `/api/openai/adjust-survey` 端点
**当前问题**:
```
❌ 使用装饰符号: ═══, 📝, 🖼️, 🎨, ✓, ✗, ⚠️
❌ 复杂的SCENARIO格式
❌ 冗长的说明
```

**应该简化为 (参照 main)**:
```
AVAILABLE QUESTION TYPES:
Text-based: text, comment, radiogroup, checkbox...
Image-based: imagepicker, imageranking, imagerating...

IMPORTANT RULES:
1. Demographic questions → text-based WITHOUT images
2. Visual perception questions → image-based types
3. Text questions about streetscape → "image" type + text question (SAME page!)
4. All image questions MUST include: imageCount, imageSelectionMode: "huggingface_random"...

Return the COMPLETE modified survey configuration.
```

---

### 3. `/api/openai/generate-questions` 端点
**当前问题**:
```
❌ 使用装饰符号: ═══, 📝, 🖼️, 🎨, ✓, ✗, ⚠️
❌ SCENARIO 1/2/3 格式
❌ 大量示例代码（虽然有用但格式可以更简洁）
```

**应该简化为**:
```
AVAILABLE QUESTION TYPES:
Text-based: text, comment, radiogroup...
Image-based: imagepicker, imageranking, imagerating...

IMAGE-BASED QUESTION EXAMPLES:
[examples...]

IMPORTANT RULES:
1. Demographic questions → pure text
2. Visual perception questions → image-based types
3. Text about streetscape → "image" display + text question (BOTH together!)
4. Image questions MUST include: imageCount, imageSelectionMode: "huggingface_random"...

Return ONLY a JSON array of questions.
```

---

### 4. `/api/openai/chat` 端点 (3个分支)

#### 4a. Generate 分支
**当前问题**:
```
❌ 使用: 🔹, ⚠️
❌ SCENARIO 1/2/3 简化说明（虽然已经简洁但有emoji）
```

**应该去掉emoji**: 直接使用纯文本

#### 4b. Adjust 分支  
**当前问题**: 同样有emoji和装饰符号

#### 4c. Question 分支
**当前问题**: 同样有emoji

---

## 📊 对比统计

### Main 分支风格特点：
- ✅ **无装饰符号**: 纯文本，无emoji，无分隔线
- ✅ **编号列表**: 使用 1, 2, 3, 4, 5, 6 明确规则
- ✅ **简洁决策树**: 使用简单的 "→" 符号和短句
- ✅ **直接明了**: "Return ONLY valid JSON, no markdown or explanations."

### Feature 分支当前问题：
- ❌ **过度装饰**: ═══, 📝, 🖼️, 🎨, ✓, ✗, ⚠️, 🔹
- ❌ **复杂结构**: SCENARIO sections with sub-sections
- ❌ **ASCII图表**: 树形决策图
- ❌ **冗余说明**: 重复强调同样的规则

---

## 🎯 核心问题

虽然我们添加了很多内容（三种场景、分页规则等），但**格式过于复杂**：

1. **LLM可能更难解析** - 太多视觉装饰反而干扰
2. **Token浪费** - 装饰符号占用Token但无实际用途
3. **不统一** - Main分支简洁风格 vs Feature分支装饰风格

---

## 💡 建议的修复方案

### 选项1：完全遵循Main风格（推荐）
- 移除所有emoji和装饰符号
- 使用简单的1-6编号列表
- 保留所有关键信息（三种场景、分页规则）
- 用简洁的语言表达

### 选项2：保留轻度格式化
- 保留一些emoji（只用于大标题）
- 移除所有分隔线和复杂符号
- 简化SCENARIO sections

### 选项3：保持现状
- 仅修复明显错误
- 不做大规模简化

---

## 📝 详细修改示例

### 当前Feature版本（冗长）:
```
═══════════════════════════════════════════════════════════
THREE SCENARIOS
═══════════════════════════════════════════════════════════

🔹 SCENARIO 1: Demographics/Socioeconomic → Pure text questions (NO images)
🔹 SCENARIO 2: Visual Assessment → Image-based types...
🔹 SCENARIO 3: Show Image + Text → "image" display + text...
   ⚠️ CRITICAL: Image and text question MUST be in SAME PAGE!

═══════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════

✓ ALL image questions MUST include:
  - imageSelectionMode: "huggingface_random"
  ...
✗ NEVER use "manual" mode
...
```

### 推荐简化版本（参照Main）:
```
IMPORTANT GUIDELINES:
1. **For demographic/socioeconomic questions**: Use text-based questions WITHOUT images
   Example: age, gender, income, education, occupation

2. **For visual perception/assessment questions**: PREFER image-based questions  
   Example: "Pick your preferred street", "Rate the thermal comfort"

3. **For text-based streetscape questions**: Add "image" type BEFORE text question
   CRITICAL: Both must be on SAME PAGE
   Example: [{"type": "image", ...}, {"type": "text", ...}]

4. All image questions MUST include:
   - imageCount, imageSelectionMode: "huggingface_random", randomImageSelection: true, choices: []

5. For imagerating: include minRateDescription and maxRateDescription

6. NEVER use "manual" mode or provide imageLink URLs

**DECISION TREE:**
- Demographic question? → text-based, NO image
- Visual assessment? → image-based type (imagepicker, imagerating, imageranking)
- Text about streetscape? → "image" display + text question (SAME page!)

Return ONLY valid JSON, no markdown.
```

---

## 🚀 推荐行动

1. ✅ **generate-survey已完成** - 作为模板
2. ⏳ **apply same style to adjust-survey**  
3. ⏳ **apply same style to generate-questions**
4. ⏳ **apply same style to chat (3 branches)**

**预计结果**: 再减少 ~300-400 行冗余代码，保留所有关键信息

