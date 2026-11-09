import { buildStarterMentalModels } from "./mental-models.js";
import type { BankTemplateInput, HindsightBankTemplate } from "./types.js";

export function generateHindsightBankTemplate(
  input: BankTemplateInput,
): HindsightBankTemplate {
  const name = input.projectName;

  return {
    version: "1",
    bank: {
      retain_mission: [
        `This bank holds durable knowledge for the ${name} software project.`,
        "Always extract: architectural decisions and trade-offs, coding standards and conventions,",
        "domain invariants, API design choices, tech stack facts, module boundaries,",
        "operational constraints, and explicit ADRs or decision records.",
        "Ignore: transient debugging output, one-off chat notes, generated lockfile noise,",
        "secrets/credentials, and ephemeral WIP comments.",
      ].join(" "),
      retain_extraction_mode: input.retainExtractionMode ?? "verbose",
      enable_observations: true,
      observations_mission: [
        `Synthesize stable facts about ${name}: tech stack, architecture patterns,`,
        "team conventions, domain vocabulary, and how the codebase is organized.",
        "Prefer long-lived project truths over session-specific details.",
      ].join(" "),
      reflect_mission: [
        `You are the durable project memory for ${name}.`,
        "When reflecting, prefer established architecture, ADRs, coding standards,",
        "and domain invariants. Cite provenance when recalling decisions.",
        "Do not invent conventions that are not in the bank.",
      ].join(" "),
      disposition_skepticism: 4,
      disposition_literalism: 4,
      disposition_empathy: 2,
      entities_allow_free_form: true,
      entity_labels: [
        {
          key: "knowledge_kind",
          type: "value",
          values: [
            { value: "decision" },
            { value: "standard" },
            { value: "architecture" },
            { value: "domain" },
            { value: "api" },
            { value: "ops" },
          ],
        },
        {
          key: "durability",
          type: "value",
          values: [
            { value: "stable" },
            { value: "evolving" },
            { value: "deprecated" },
          ],
        },
      ],
    },
    mental_models: buildStarterMentalModels({
      projectName: name,
      ...(input.mentalModelIds !== undefined
        ? { mentalModelIds: input.mentalModelIds }
        : {}),
      ...(input.taggingMode !== undefined
        ? { taggingMode: input.taggingMode }
        : {}),
      ...(input.customTagsByModelId !== undefined
        ? { customTagsByModelId: input.customTagsByModelId }
        : {}),
      ...(input.refreshPolicy !== undefined
        ? { refreshPolicy: input.refreshPolicy }
        : {}),
    }),
    directives: [
      {
        name: "prefer-durable-sources",
        content:
          "Prefer ADRs, architecture docs, standards, and AGENTS.md over chat history or ephemeral notes when answering project questions.",
        priority: 10,
        is_active: true,
        tags: ["knowledge"],
      },
      {
        name: "cite-provenance",
        content:
          "When recalling a decision or standard, mention the source document or ADR if known.",
        priority: 8,
        is_active: true,
        tags: ["knowledge"],
      },
      {
        name: "do-not-invent-conventions",
        content:
          "Do not invent coding conventions or architecture rules that are not present in the bank. If unsure, say so.",
        priority: 10,
        is_active: true,
        tags: ["safety"],
      },
      {
        name: "local-first",
        content:
          "Assume local-first and self-hostable defaults unless the bank explicitly documents a cloud requirement.",
        priority: 5,
        is_active: true,
        tags: ["principles"],
      },
    ],
  };
}
