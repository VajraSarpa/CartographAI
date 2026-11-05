import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { RunTree } from "langsmith/run_trees";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";
import { serverEnv } from "@/lib/env";

// LangSmith reads LANGSMITH_TRACING / LANGSMITH_API_KEY / LANGSMITH_PROJECT /
// LANGSMITH_ENDPOINT from the environment; traceable() and wrapAnthropic()
// share one client configured from them.

let anthropic: Anthropic | null = null;

export function tracingEnabled(): boolean {
  const env = serverEnv();
  return !!env.LANGSMITH_API_KEY && env.LANGSMITH_TRACING === "true";
}

/** Anthropic client; every call is traced to LangSmith when tracing is configured. */
export function claude(): Anthropic {
  if (anthropic) return anthropic;
  const base = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 });
  anthropic = tracingEnabled() ? wrapAnthropic(base) : base;
  return anthropic;
}

/** Serverless functions freeze after responding: flush traces before that. */
export async function flushTraces(): Promise<void> {
  if (tracingEnabled()) await RunTree.getSharedClient().awaitPendingTraceBatches();
}
