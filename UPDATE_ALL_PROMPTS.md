# 批量更新所有端点的 Prompt

## 需要添加的关键规则

在所有 prompt 中添加：

```
**CRITICAL RULE FOR STREETSCAPE SURVEYS:**
No standalone text questions about streetscapes! All streetscape-related questions MUST be paired with images.
Only socioeconomic/demographic questions (age, gender, education, occupation) can be pure text.

For streetscape questions, you MUST either:
- Use image-based question types (imagerating, imagepicker, imageranking, etc.)
- OR use "image" display + text question (both on SAME page)

❌ NEVER: Ask about street appearance/features without showing the street image!
```

## 待更新端点列表

1. ✅ Line 571 - `/api/openai/generate-survey` (已完成)
2. ⏳ Line 837 - `/api/openai/adjust-survey`
3. ⏳ Line 993 - `/api/openai/generate-questions`
4. ⏳ Line 1257 - `/api/openai/chat` (generate branch)
5. ⏳ Line 1337 - `/api/openai/chat` (adjust branch)
6. ⏳ Line 1400 - `/api/openai/chat` (question branch)

## 更新策略

由于其他端点的 prompt 比较简短，我会：
1. 在开头添加关键规则强调
2. 保持简洁，不重复 generate-survey 的详细例子
3. 引用 generate-survey 的完整规则

## 简化版本（用于其他端点）

```
IMPORTANT FOR STREETSCAPE SURVEYS:
- Pure text questions ONLY for demographics (age, gender, education, occupation)
- All streetscape questions MUST have images (use imagerating/imagepicker/etc. OR image display + text)
- NEVER ask about streets without showing street images

[rest of existing prompt...]
```

