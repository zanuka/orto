import { describe, expect, it } from "vitest";
import {
  heuristicDenyMcpRetain,
  interpretMcpRetain,
  judgeMcpRetain,
  looksLikeDurableProjectKnowledge,
  looksLikeSessionFluff,
  mcpRetainQuestions,
  MCP_RETAIN_DENY_MESSAGE,
  MCP_RETAIN_SUGGEST_SEED_MESSAGE,
} from "./mcp-retain.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const ADR_TEXT = `# ADR 0001: Keep the bank local

## Context

Agents need durable project knowledge.

## Decision

We keep the Hindsight bank on the machine. This architecture decision is a project invariant.
`;

const CHAT_TEXT = `User: can you help debug this?
Assistant: I just tried X and got a stack trace. Here's the output.
User: okay, try this instead
Assistant: Working on it. Let me know if you want a diff.`;

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  durable = 0.94;
  fluff = 0.05;
  action = "allow";
  actionConfidence = 0.92;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        is_durable_project_knowledge: { type: "noul", noul: this.durable },
        is_session_fluff: { type: "noul", noul: this.fluff },
        action: {
          type: "choice",
          choice: this.action,
          probabilities: { [this.action]: this.actionConfidence },
          confidence: this.actionConfidence,
        },
      },
    };
  }
}

describe("mcp retain guardrail", () => {
  it("asks durable, fluff, and action questions", () => {
    expect(Object.keys(mcpRetainQuestions())).toEqual([
      "is_durable_project_knowledge",
      "is_session_fluff",
      "action",
    ]);
  });

  it("heuristically denies chat-shaped retain payloads", () => {
    expect(looksLikeSessionFluff(CHAT_TEXT)).toBe(true);
    const decision = heuristicDenyMcpRetain(CHAT_TEXT);
    expect(decision.verdict).toBe("deny");
    expect(decision.source).toBe("heuristic");
    expect(decision.agentMessage).toBe(MCP_RETAIN_DENY_MESSAGE);
  });

  it("heuristically allows ADR-shaped retain payloads", () => {
    expect(looksLikeDurableProjectKnowledge(ADR_TEXT)).toBe(true);
    const decision = heuristicDenyMcpRetain(ADR_TEXT);
    expect(decision.verdict).toBe("allow");
    expect(decision.source).toBe("heuristic");
  });

  it("defaults to deny when the payload is ambiguous", () => {
    const decision = heuristicDenyMcpRetain(
      "Some notes about tomorrow's meeting agenda items.",
    );
    expect(decision.verdict).toBe("deny");
  });

  it("allows a confident durable ADR when the judge is on", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeMcpRetain({
      text: ADR_TEXT,
      judge,
      confidence: 0.8,
    });
    expect(decision.verdict).toBe("allow");
    expect(decision.source).toBe("jev");
    expect(judge.calls[0]?.questions).toEqual(mcpRetainQuestions());
  });

  it("denies confident session fluff even if action says allow", () => {
    const decision = interpretMcpRetain({
      confidence: 0.8,
      answers: {
        is_durable_project_knowledge: { type: "noul", noul: 0.2 },
        is_session_fluff: { type: "noul", noul: 0.95 },
        action: {
          type: "choice",
          choice: "allow",
          probabilities: { allow: 0.9 },
          confidence: 0.9,
        },
      },
    });
    expect(decision.verdict).toBe("deny");
    expect(decision.reason).toBe("session fluff");
  });

  it("suggests seed instead when the action says so", () => {
    const decision = interpretMcpRetain({
      confidence: 0.8,
      answers: {
        is_durable_project_knowledge: { type: "noul", noul: 0.9 },
        is_session_fluff: { type: "noul", noul: 0.1 },
        action: {
          type: "choice",
          choice: "suggest_seed_instead",
          probabilities: { suggest_seed_instead: 0.91 },
          confidence: 0.91,
        },
      },
    });
    expect(decision.verdict).toBe("suggest_seed_instead");
    expect(decision.agentMessage).toBe(MCP_RETAIN_SUGGEST_SEED_MESSAGE);
  });

  it("defaults to deny on low-confidence action", () => {
    const decision = interpretMcpRetain({
      confidence: 0.8,
      answers: {
        is_durable_project_knowledge: { type: "noul", noul: 0.7 },
        is_session_fluff: { type: "noul", noul: 0.3 },
        action: {
          type: "choice",
          choice: "allow",
          probabilities: { allow: 0.4 },
          confidence: 0.4,
        },
      },
    });
    expect(decision.verdict).toBe("deny");
    expect(decision.reason).toContain("default deny");
  });

  it("uses the heuristic path when the judge is off", async () => {
    const decision = await judgeMcpRetain({
      text: CHAT_TEXT,
      confidence: 0.8,
    });
    expect(decision.source).toBe("heuristic");
    expect(decision.verdict).toBe("deny");
  });
});
