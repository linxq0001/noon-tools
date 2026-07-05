# DeepSeek timeout and lightweight copy design

## Goal

Make noon product generation stop feeling stuck at `调用模型`. Keep DeepSeek as an optional copy improvement step, but make it bounded, smaller, and safe to skip.

Success means:

- A single product generation job never waits indefinitely for DeepSeek copy beautification.
- The log shows when DeepSeek starts, how long it ran, and whether it completed, timed out, or fell back.
- If DeepSeek fails or times out, the existing rule-based noon product remains usable.
- DeepSeek output is limited to the highest-value marketplace copy fields so the request is smaller and faster.

## Current behavior

`POST /api/noon-generate-jobs` starts `scripts/collect-1688.js --from-meta ... --deepseek true`, so single-product regeneration always enters the DeepSeek beautification path.

Inside `applyDeepSeekBeautification`, the script sends the full copy-improvement payload and waits for `fetch` to finish. Logs currently show the model call start and final success or failure, but there is no timeout and no periodic progress.

Image vision is already gated behind `DEEPSEEK_ENABLE_IMAGE_VISION=true`, so this design does not change image classification. The slow path addressed here is text copy beautification.

## Recommended approach

Use a bounded lightweight DeepSeek copy step:

1. Add a default DeepSeek copy timeout, for example 20 seconds.
2. Abort the chat completion request with `AbortController` when the timeout is reached.
3. Reduce the requested AI patch to product group title, Arabic group title, model name, variant English title, variant Arabic title, and English description.
4. Keep rule-generated feature bullets unless DeepSeek completes quickly and returns safe replacements in the existing schema.
5. Record `ai_generation.status` as `completed`, `failed`, or `timeout`, always with elapsed seconds.
6. Log a clear fallback line when timeout or failure occurs.

This keeps the existing generation contract: the output file is still produced from the rule-based data, and AI only patches safe copy fields.

## Alternatives considered

### Disable DeepSeek by default

Fastest and simplest. Single-product generation would use local rules unless the user explicitly asks for AI. The downside is lower copy quality, especially Arabic phrasing.

### Async post-generation beautification

Generate the JSON immediately, then run DeepSeek in a second background job and update the file later. This gives the best perceived speed, but it adds state, race handling, and UI complexity. It is too much for the current complaint.

### Switch provider

Using another model could be faster, but it does not solve the local product contract. Timeout and fallback are still needed even with a faster provider.

## User-facing behavior

The log should change from a long silent wait to something like:

```text
[deepseek] 调用模型: deepseek-v4-flash，超时 20s，轻量文案模式
[deepseek] DeepSeek 超时 20.1s，已保留规则生成文案。
```

On success:

```text
[deepseek] 调用模型: deepseek-v4-flash，超时 20s，轻量文案模式
[deepseek] 已完成标题、描述美化，耗时 8.4s。
```

No new UI setting is required for the first implementation. If needed later, the timeout can be made configurable, but the first version should keep one conservative default.

## Data flow

```text
buildNoonProduct
  -> generate full rule-based product
  -> applyDeepSeekBeautification when --deepseek true
       -> build lightweight AI input
       -> fetch with AbortController timeout
       -> parse and validate JSON
       -> apply safe copy patch
       -> record status and elapsed time
  -> hoist common fields
  -> write noon-product-attributes.json
```

## Error handling

- Missing API key keeps the existing skipped behavior.
- Timeout writes `ai_generation.status = "timeout"` and keeps rule-generated copy.
- HTTP error, invalid JSON, or unsafe copy writes `status = "failed"` and keeps rule-generated copy.
- No failure path should block writing `noon-product-attributes.json`.
- Logs must avoid printing API keys or full request payloads.

## Testing

Add focused tests around the helper behavior rather than a full external API test:

- A mocked delayed DeepSeek request times out and preserves rule-generated fields.
- A mocked successful response patches only allowed copy fields.
- A mocked malformed response records failure and preserves rule-generated fields.
- Existing noon product generation tests continue to pass.

Manual verification:

- Run one product generation with a fake or delayed DeepSeek endpoint and confirm timeout fallback appears in logs.
- Run one product generation without `DEEPSEEK_API_KEY` and confirm the existing skip behavior still works.

## Out of scope

- Changing image vision behavior.
- Adding a new model provider.
- Adding a UI control for timeout or AI mode.
- Reworking product generation into separate async beautification jobs.
