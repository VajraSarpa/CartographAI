import "server-only";
import { createCartographAgent, type CallTool } from "cartograph-agent/core";
import { callAgentTool } from "./agent-tools";

/**
 * The Ask agent, running inside the app (used when AGENT_URL is unset).
 * Same agent as the standalone LangGraph server (cartograph-agent/), but its
 * tools call callAgentTool directly instead of over HTTP. The credential is
 * still minted per question and verified on every tool call, and every read
 * still goes through RLS as that credential.
 */
const callInProcess: CallTool = async (name, body, credential) => {
  const result = await callAgentTool(name, credential, body);
  const text = JSON.stringify(result.body);
  // same shape the HTTP transport returns, so the agent sees one format
  return result.status === 200 ? text : `Tool error (${result.status}): ${text.slice(0, 300)}`;
};

let agent: ReturnType<typeof createCartographAgent> | null = null;

export function inProcessAgent() {
  agent ??= createCartographAgent(callInProcess);
  return agent;
}

export { flushTraces } from "cartograph-agent/core";
