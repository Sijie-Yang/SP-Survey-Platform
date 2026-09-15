/** Feature flag: default on. Set AGENT_RUNTIME=0 / false / off to use the legacy chatHandler. */

export function useAgentRuntime(env) {
  const raw = String(env?.AGENT_RUNTIME ?? env?.REACT_APP_AGENT_RUNTIME ?? '1').toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'legacy';
}
