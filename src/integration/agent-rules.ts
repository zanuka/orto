import { buildSingleBankMcpUrl } from "./mcp-url.js";

export const AGENTS_BANK_BEGIN = "<!-- orto:hindsight-bank -->";
export const AGENTS_BANK_END = "<!-- /orto:hindsight-bank -->";

export interface AgentRulesInput {
  projectName: string;
  bankId: string;
  baseUrl: string;
}

export function buildAgentsBankSection(input: AgentRulesInput): string {
  const mcpUrl = buildSingleBankMcpUrl(input.baseUrl, input.bankId);
  return [
    AGENTS_BANK_BEGIN,
    "",
    "## Project memory bank (Hindsight)",
    "",
    `Prefer the project Hindsight bank \`${input.bankId}\` for durable ${input.projectName} context (architecture, decisions, standards, domain invariants).`,
    "",
    `- Prefer \`reflect\` (or read mental models) for architecture, standards, and "how we work" / playbook questions.`,
    `- Prefer \`recall\` for narrow fact lookup and provenance hunting.`,
    `- Do not use MCP \`retain\` for chat, diffs, scratch notes, or "I just tried X" session junk.`,
    `- For durable knowledge, write or update repo docs/ADRs, then run \`orto seed\` or \`orto store\` (MCP retain is gated; default deny on fluff / low confidence).`,
    `- Optional: before recall/reflect, harnesses may call \`judgeNeedsBank\` (\`ORTO_JEV_NEEDS_BANK=1\`; default off) so pure code tasks skip the bank.`,
    `- Optional: after a PR/merge/task summary, harnesses may call \`judgeTaskFollowup\` (\`ORTO_JEV_TASK_FOLLOWUP=1\`; default off) for \`retain_to_bank\` | \`pr_only\` | \`both\` (queue \`orto store\`/\`seed\`, never MCP-retain).`,
    `- Optional: before dispatching multi-agent work, harnesses may call \`judgeEscalateDispatch\` (\`ORTO_JEV_ESCALATE_DISPATCH=1\`; default off) with the distro charter list (Noul \`needs_captain\` + Choice \`crewmate\`; never invent workers).`,
    `- Use Hindsight MCP before rediscovering the same facts from scattered docs.`,
    `- MCP endpoint (single-bank): \`${mcpUrl}\``,
    `- Treat repo docs and ADRs as source of truth; use the bank as the agent-facing memory of those sources.`,
    `- Do not dump secrets, credentials, or ephemeral chat into the bank.`,
    `- Orto is harness-agnostic: Claude Code, Codex, Cursor, Pi, and other agent workflows share this bank.`,
    "",
    AGENTS_BANK_END,
    "",
  ].join("\n");
}

export function upsertAgentsBankSection(
  existing: string,
  input: AgentRulesInput,
): string {
  const section = buildAgentsBankSection(input).trimEnd();
  const begin = existing.indexOf(AGENTS_BANK_BEGIN);
  const end = existing.indexOf(AGENTS_BANK_END);

  if (begin !== -1 && end !== -1 && end > begin) {
    const before = existing.slice(0, begin).trimEnd();
    const after = existing.slice(end + AGENTS_BANK_END.length).replace(/^\n+/, "");
    const parts = [before, "", section];
    if (after.trim().length > 0) {
      parts.push("", after.trimStart());
    }
    return `${parts.join("\n").trimEnd()}\n`;
  }

  const trimmed = existing.trimEnd();
  if (trimmed.length === 0) {
    return `${section}\n`;
  }
  return `${trimmed}\n\n${section}\n`;
}

export function buildCursorBankRule(input: AgentRulesInput): string {
  const mcpUrl = buildSingleBankMcpUrl(input.baseUrl, input.bankId);
  return [
    "---",
    `description: Prefer the project Hindsight bank (${input.bankId}) for durable context`,
    "alwaysApply: true",
    "---",
    "",
    `# Hindsight bank: ${input.projectName}`,
    "",
    `Use the project memory bank \`${input.bankId}\` via Hindsight MCP when answering questions about architecture, decisions, coding standards, or domain rules.`,
    "",
    `- Prefer \`reflect\` (or mental models) for architecture, standards, and "how we work" questions.`,
    `- Prefer \`recall\` for narrow facts and provenance.`,
    `- Never MCP-\`retain\` chat, diffs, or session scratch. Persist durable claims with \`orto seed\` / \`orto store\` instead.`,
    `- Optional: before recall/reflect, call \`judgeNeedsBank\` when \`ORTO_JEV_NEEDS_BANK=1\` (default off) so pure code tasks skip the bank.`,
    `- Optional: after a PR/merge/task summary, call \`judgeTaskFollowup\` when \`ORTO_JEV_TASK_FOLLOWUP=1\` (default off) for \`retain_to_bank\` | \`pr_only\` | \`both\`.`,
    `- Optional: before dispatching multi-agent work, call \`judgeEscalateDispatch\` when \`ORTO_JEV_ESCALATE_DISPATCH=1\` (default off) with the distro charter list.`,
    `- MCP URL: \`${mcpUrl}\``,
    `- Docs and ADRs remain authoritative; the bank is how agents inherit them across sessions.`,
    `- Never retain secrets or credentials into the bank.`,
    `- Works with Claude Code, Codex, Cursor, Pi, and other agent workflows that speak MCP.`,
    "",
  ].join("\n");
}
