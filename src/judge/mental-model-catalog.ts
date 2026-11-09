export const MENTAL_MODEL_CATALOG_KINDS = [
  "overview",
  "architecture",
  "decision",
  "standard",
  "domain",
  "ops",
  "api",
] as const;

export type MentalModelCatalogKind =
  (typeof MENTAL_MODEL_CATALOG_KINDS)[number];

export interface MentalModelCatalogEntry {
  id: string;
  title: string;
  kind: MentalModelCatalogKind;
  sourceQuery: (projectName: string) => string;
}

export const MENTAL_MODEL_CATALOG: readonly MentalModelCatalogEntry[] = [
  {
    id: "project-context",
    title: "Project Context",
    kind: "overview",
    sourceQuery: (name) =>
      `Summarize ${name} only from retained memories: purpose, main pipeline stages, and local-first conventions. Do not invent stack facts that are not in the bank.`,
  },
  {
    id: "architecture-decisions",
    title: "Architecture Decisions",
    kind: "decision",
    sourceQuery: (name) =>
      `What architectural decisions have been made for ${name}, including trade-offs and rationale?`,
  },
  {
    id: "coding-standards",
    title: "Coding Standards",
    kind: "standard",
    sourceQuery: (name) =>
      `What coding standards, style rules, and engineering practices should agents follow in ${name}?`,
  },
  {
    id: "module-boundaries",
    title: "Module Boundaries",
    kind: "architecture",
    sourceQuery: (name) =>
      `What are the module boundaries and ownership rules in ${name}? Which concerns must stay separated?`,
  },
  {
    id: "auth-and-identity",
    title: "Auth and Identity",
    kind: "ops",
    sourceQuery: (name) =>
      `How does ${name} handle authentication, authorization, and identity? What must agents never invent here?`,
  },
  {
    id: "release-process",
    title: "Release Process",
    kind: "ops",
    sourceQuery: (name) =>
      `What is the release, versioning, and ship process for ${name}?`,
  },
  {
    id: "testing-conventions",
    title: "Testing Conventions",
    kind: "standard",
    sourceQuery: (name) =>
      `What testing conventions and verification expectations apply in ${name}?`,
  },
  {
    id: "domain-invariants",
    title: "Domain Invariants",
    kind: "domain",
    sourceQuery: (name) =>
      `What durable domain invariants and vocabulary should agents respect in ${name}?`,
  },
  {
    id: "public-api-surface",
    title: "Public API Surface",
    kind: "api",
    sourceQuery: (name) =>
      `What is the stable public API or CLI surface for ${name}, and what must not break?`,
  },
  {
    id: "local-ops",
    title: "Local Operations",
    kind: "ops",
    sourceQuery: (name) =>
      `How do operators run, upgrade, and troubleshoot ${name} locally (Docker, env, recovery)?`,
  },
];

export function listMentalModelCatalog(): readonly MentalModelCatalogEntry[] {
  return MENTAL_MODEL_CATALOG;
}

export function catalogEntriesNotIn(
  existingIds: ReadonlySet<string>,
): MentalModelCatalogEntry[] {
  return MENTAL_MODEL_CATALOG.filter((entry) => !existingIds.has(entry.id));
}

export function renderCatalogSourceQuery(
  entry: MentalModelCatalogEntry,
  projectName: string,
): string {
  return entry.sourceQuery(projectName);
}
