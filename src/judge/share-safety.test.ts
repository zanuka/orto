import { describe, expect, it } from "vitest";
import {
  containsPrivateHostname,
  formatShareSafetyLines,
  heuristicShareSafety,
  interpretShareSafety,
  judgeShareSafety,
  shareSafetyQuestions,
} from "./share-safety.js";
import type { Judge, JudgeEvaluateInput, JudgeResult } from "./types.js";

const INTERNAL = `# Internal runbook

SSH to db.internal.corp.
The database listens on 10.0.4.12.
Customer acme-billing is reached at vpn.corp.example.
`;

const PUBLIC_STANDARDS = `# Coding standards

These coding standards are public by design.
Contributors may share them.
No private hosts or customer names appear here.
`;

class ScriptedJudge implements Judge {
  readonly id = "jev" as const;
  readonly calls: JudgeEvaluateInput[] = [];
  safe = 0.95;
  leaks = 0.04;
  sensitivity = 0;
  profile = "public_ok";
  confidence = 0.94;

  async evaluate(input: JudgeEvaluateInput): Promise<JudgeResult> {
    this.calls.push(input);
    return {
      judgeId: "jev",
      answers: {
        safe_outside_trusted_network: { type: "noul", noul: this.safe },
        leaks_internal_urls_or_customers: { type: "noul", noul: this.leaks },
        sensitivity: {
          type: "score",
          score: this.sensitivity,
          legend: { "0": "public", "3": "internal" },
          probabilities: { [String(this.sensitivity)]: this.confidence },
          confidence: this.confidence,
        },
        profile_ok: {
          type: "choice",
          choice: this.profile,
          probabilities: { [this.profile]: this.confidence },
          confidence: this.confidence,
        },
      },
    };
  }
}

describe("share safety", () => {
  it("asks the four share questions", () => {
    const questions = shareSafetyQuestions();
    expect(questions.safe_outside_trusted_network?.type).toBe("noul");
    expect(questions.leaks_internal_urls_or_customers?.type).toBe("noul");
    expect(questions.sensitivity?.type).toBe("score");
    expect(questions.profile_ok?.type).toBe("choice");
  });

  it("detects private hostnames", () => {
    expect(containsPrivateHostname(INTERNAL)).toBe(true);
    expect(containsPrivateHostname(PUBLIC_STANDARDS)).toBe(false);
  });

  it("an internal runbook cannot pass public_ok even when Jev is highly confident", () => {
    const decision = interpretShareSafety({
      text: INTERNAL,
      confidence: 0.8,
      answers: {
        safe_outside_trusted_network: { type: "noul", noul: 0.99 },
        leaks_internal_urls_or_customers: { type: "noul", noul: 0.01 },
        sensitivity: {
          type: "score",
          score: 0,
          legend: {},
          probabilities: { "0": 0.99 },
          confidence: 0.99,
        },
        profile_ok: {
          type: "choice",
          choice: "public_ok",
          probabilities: { public_ok: 0.99 },
          confidence: 0.99,
        },
      },
    });
    expect(decision.profileOk).not.toBe("public_ok");
    expect(decision.allowPublic).toBe(false);
    expect(decision.reason).toMatch(/private hostname/);
  });

  it("a public-by-design standards doc can pass public_ok", () => {
    const decision = interpretShareSafety({
      text: PUBLIC_STANDARDS,
      confidence: 0.8,
      answers: {
        safe_outside_trusted_network: { type: "noul", noul: 0.96 },
        leaks_internal_urls_or_customers: { type: "noul", noul: 0.03 },
        sensitivity: {
          type: "score",
          score: 0,
          legend: {},
          probabilities: { "0": 0.94 },
          confidence: 0.94,
        },
        profile_ok: {
          type: "choice",
          choice: "public_ok",
          probabilities: { public_ok: 0.95 },
          confidence: 0.95,
        },
      },
    });
    expect(decision.profileOk).toBe("public_ok");
    expect(decision.allowPublic).toBe(true);
    expect(decision.agentMessage).toMatch(/Jev does not publish/);
  });

  it("heuristic blocks the runbook and allows the standards doc", () => {
    expect(heuristicShareSafety(INTERNAL).allowPublic).toBe(false);
    expect(heuristicShareSafety(INTERNAL).profileOk).toBe("local_only");
    expect(heuristicShareSafety(PUBLIC_STANDARDS).allowPublic).toBe(true);
    expect(heuristicShareSafety(PUBLIC_STANDARDS).profileOk).toBe("public_ok");
  });

  it("private-host text never calls TypeSafe", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeShareSafety({
      text: INTERNAL,
      judge,
      confidence: 0.8,
    });
    expect(decision.allowPublic).toBe(false);
    expect(judge.calls).toHaveLength(0);
  });

  it("uses Jev for a public standards doc", async () => {
    const judge = new ScriptedJudge();
    const decision = await judgeShareSafety({
      text: PUBLIC_STANDARDS,
      judge,
      confidence: 0.8,
    });
    expect(decision.source).toBe("jev");
    expect(decision.allowPublic).toBe(true);
    expect(judge.calls).toHaveLength(1);
    expect((judge.calls[0]?.state as { type?: string }).type).toBe("share_safety");
  });

  it("formatShareSafetyLines reports the block", () => {
    const lines = formatShareSafetyLines({
      decision: heuristicShareSafety(INTERNAL),
    });
    expect(lines.some((line) => line.includes("allow public: no"))).toBe(true);
    expect(lines.some((line) => line.includes("Share safety: local_only"))).toBe(true);
  });
});
