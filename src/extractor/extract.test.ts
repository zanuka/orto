import { extractFromSource } from "./extract.js";
import type { DurableSource } from "../scanner/durable-sources.js";

function source(
  relativePath: string,
  kind: DurableSource["kind"],
): DurableSource {
  return {
    absolutePath: `/tmp/${relativePath}`,
    relativePath,
    kind,
  };
}

describe("extractFromSource", () => {
  it("keeps ADR documents as decision facts", () => {
    const content = `# ADR 0001: Use TypeScript

## Decision

We will use TypeScript for the CLI.

## Consequences

Stronger typing for config schemas.
`;
    const result = extractFromSource(source("docs/adr/0001.md", "adr"), content, {
      commit: "abc123",
    });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.knowledgeKind).toBe("decision");
    expect(result.facts[0]?.provenance.commit).toBe("abc123");
    expect(result.facts[0]?.id).toContain("docs/adr/0001.md");
  });

  it("extracts high-signal README sections and skips install noise", () => {
    const content = `# Orto

Company brain config for AI agents.

## Goal

Seed Hindsight memory banks from durable project docs and architecture decisions.

## Quick Start

\`\`\`bash
# From your project root
npx @orto-ai/cli init
\`\`\`

## Installation

npm install -g whatever

## Core Principles

Prefer durable knowledge over ephemeral content. Local control is non-negotiable.

## Contributing

Please open an issue.
`;
    const result = extractFromSource(source("README.md", "readme"), content);
    const titles = result.facts.map((f) => f.title);
    expect(titles.some((t) => /goal/i.test(t))).toBe(true);
    expect(titles.some((t) => /principle/i.test(t))).toBe(true);
    expect(titles.some((t) => /orto/i.test(t))).toBe(true);
    expect(titles.some((t) => /install/i.test(t))).toBe(false);
    expect(titles.some((t) => /quick start/i.test(t))).toBe(false);
    expect(titles.some((t) => /from your project root/i.test(t))).toBe(false);
    expect(titles.some((t) => /contributing/i.test(t))).toBe(false);
    expect(result.heuristicSkips.map((fact) => fact.title)).toContain(
      "Quick Start",
    );
    expect(result.facts.map((fact) => fact.id)).not.toEqual(
      expect.arrayContaining(result.heuristicSkips.map((fact) => fact.id)),
    );
  });

  it("keeps an architecture section and records a changelog section as a heuristic skip", () => {
    const content = `# Fixture

## Architecture

The module boundary is a local-first architecture decision. We chose to keep the Hindsight bank on the machine. This invariant is a project standard.

## Changelog

This generated changelog is a badge wall and a table of contents. The notes are a TODO pile, not a decision.
`;
    const result = extractFromSource(source("README.md", "readme"), content);
    expect(result.facts.map((fact) => fact.id)).toContain(
      "orto:README.md#architecture",
    );
    expect(result.facts.map((fact) => fact.id)).not.toContain(
      "orto:README.md#changelog",
    );
    expect(result.heuristicSkips.map((fact) => fact.id)).toContain(
      "orto:README.md#changelog",
    );
    const changelog = result.heuristicSkips.find(
      (fact) => fact.id === "orto:README.md#changelog",
    );
    expect(changelog?.content).toMatch(/changelog/i);
    expect(changelog?.content).not.toMatch(/local-first/);
  });

  it("strips MDX frontmatter before scoring sections", () => {
    const content = `---
title: Nike SNKRS
description: Launch work.
status: shipped
---

## Architecture

I owned the SNKRS web launch experience under production traffic constraints and shared component boundaries.

## Contributions

I built the product-first launch surface and reusable component libraries for the platform.
`;
    const result = extractFromSource(
      source("src/content/works/nike-snkrs-juno.mdx", "docs"),
      content,
    );
    const blob = result.facts.map((fact) => fact.content).join("\n");
    expect(result.facts.length).toBeGreaterThan(0);
    expect(blob).not.toMatch(/^title:/m);
    expect(blob).not.toContain("status: shipped");
    expect(result.facts.some((fact) => /architecture/i.test(fact.title))).toBe(
      true,
    );
  });

  it("keeps a security standard and still skips a vulnerability mailbox", () => {
    const standard = extractFromSource(
      source("docs/security-standard.md", "docs"),
      `# Security standard

API keys must never be committed. This coding standard applies to every package in the repo.
`,
    );
    expect(standard.facts.map((fact) => fact.knowledgeKind)).toContain("standard");
    expect(standard.heuristicSkips).toHaveLength(0);

    const mailbox = extractFromSource(
      source("docs/security.md", "docs"),
      `# Security

Report vulnerabilities to the private list for this repository only.
`,
    );
    expect(mailbox.facts).toHaveLength(0);
    expect(mailbox.heuristicSkips.length).toBeGreaterThan(0);
  });

  it("keeps changelog headings skipped even when the notes say we decided", () => {
    const result = extractFromSource(
      source("docs/changelog.md", "docs"),
      `# Changelog

We decided to rename the CLI in 0.2. This changelog entry is not an architecture decision record.
`,
    );
    expect(result.facts).toHaveLength(0);
    expect(result.heuristicSkips.length).toBeGreaterThan(0);
  });

  it("skips empty files", () => {
    const result = extractFromSource(source("README.md", "readme"), "   \n");
    expect(result.skipped).toBe(true);
    expect(result.facts).toHaveLength(0);
  });
});
