import { createCartographAgent, type CallTool } from "./core.js";

/**
 * Standalone entry for a LangGraph server (`pnpm dev:agent`, or a LangSmith
 * deployment via langgraph.json). Tools call the Cartograph app over HTTP with
 * the credential; the app verifies it and reads through RLS.
 *
 * The app itself does not need this: with AGENT_URL unset it runs the same
 * agent in-process (src/server/ask-agent.ts in the app).
 */

const APP_URL = (process.env.CARTOGRAPH_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const callOverHttp: CallTool = async (name, body, credential) => {
  const res = await fetch(`${APP_URL}/api/agent/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) return `Tool error (${res.status}): ${text.slice(0, 300)}`;
  return text;
};

export const graph = createCartographAgent(callOverHttp);
