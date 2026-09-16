/**
 * Restricted ToolRegistry — only explicitly registered domain tools.
 * No shell, filesystem, or arbitrary HTTP.
 */

const BLOCKED = /^(shell|bash|exec|python|fs_|file_|fetch_url|web_browse|browser_)/i;

export function createToolRegistry(initial = []) {
  const tools = new Map();
  for (const tool of initial) registerTool(tools, tool);
  return {
    register: (tool) => registerTool(tools, tool),
    list: () => [...tools.values()].map(({ execute, risk, executionMode, domain, ...def }) => def),
    get: (name) => tools.get(name) || null,
    names: () => [...tools.keys()],
    async execute(name, args, ctx) {
      if (BLOCKED.test(name)) {
        throw Object.assign(new Error(`Tool not allowed: ${name}`), { status: 403 });
      }
      const tool = tools.get(name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 400 });
      if (ctx?.permission && tool.minPermission) {
        if (!permissionAllows(ctx.permission, tool.minPermission)) {
          throw Object.assign(new Error(`Permission ${ctx.permission} cannot run ${name}`), {
            status: 403,
            code: 'INSUFFICIENT_PERMISSION',
          });
        }
      }
      if (
        tool.risk
        && typeof ctx?.approvalGate === 'function'
        && !ctx?.approvedToolCalls?.has?.(ctx.toolCallId)
      ) {
        await ctx.approvalGate({
          toolCallId: ctx.toolCallId,
          name,
          risk: tool.risk,
          args: args || {},
        });
      }
      return tool.execute(args || {}, ctx);
    },
  };
}

function registerTool(map, tool) {
  if (!tool?.name || typeof tool.execute !== 'function') {
    throw new Error('Tool requires name and execute()');
  }
  if (BLOCKED.test(tool.name)) {
    throw new Error(`Refusing to register blocked tool: ${tool.name}`);
  }
  map.set(tool.name, {
    name: tool.name,
    description: tool.description || '',
    parameters: tool.parameters || { type: 'object', properties: {} },
    minPermission: tool.minPermission || 'ask',
    domain: tool.domain || 'survey',
    risk: tool.risk || null,
    executionMode: tool.executionMode || (tool.minPermission === 'ask' ? 'parallel' : 'exclusive'),
    execute: tool.execute,
  });
}

const RANK = { ask: 0, edit_draft: 1, media: 2 };

export function permissionAllows(have, need) {
  return (RANK[have] ?? 0) >= (RANK[need] ?? 0);
}

export function summarizeToolResult(name, result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  if (result.summary) return result.summary;
  if (result.message) return result.message;
  if (result.applied) return `${name}: applied ${result.applied.length} operation(s)`;
  if (result.validation) {
    return result.validation.valid ? `${name}: valid` : `${name}: validation failed`;
  }
  return `${name} completed`;
}
