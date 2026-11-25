import type { DurableSource } from "../scanner/durable-sources.js";
import { hashContent, slugifyHeading } from "./hash.js";
import type {
  CandidateFact,
  ExtractedSource,
  KnowledgeKind,
} from "./types.js";

function uniqueSectionSlug(base: string, taken: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(candidate);
  return candidate;
}

const SIGNAL_PATTERNS: Array<{
  pattern: RegExp;
  kind: KnowledgeKind;
  weight: number;
}> = [
  {
    pattern: /\b(adr|decision|decided|trade-?off|rationale|we chose|why we)\b/i,
    kind: "decision",
    weight: 5,
  },
  {
    pattern:
      /\b(architecture|boundary|boundaries|module|system design|component)\b/i,
    kind: "architecture",
    weight: 4,
  },
  {
    pattern:
      /\b(standard|convention|must|should|principle|guideline|coding)\b/i,
    kind: "standard",
    weight: 4,
  },
  {
    pattern:
      /\b(domain|invariant|constraint|non-negotiable|business rule)\b/i,
    kind: "domain",
    weight: 4,
  },
  {
    pattern: /\b(goal|purpose|vision|mission|problem|overview)\b/i,
    kind: "overview",
    weight: 2,
  },
];

const HARD_NOISE_HEADINGS =
  /^(changelog|license|install(ation)?|getting started|quick start|contributing|table of contents|toc|status)\b/i;

const SOFT_NOISE_HEADINGS = /^(security)\b/i;

const MIN_SECTION_CHARS = 40;
const MAX_FACT_CHARS = 12_000;

export interface ExtractOptions {
  commit?: string;
}

export function extractFromSource(
  source: DurableSource,
  content: string,
  options: ExtractOptions = {},
): ExtractedSource {
  const contentHash = hashContent(content);
  const trimmed = stripFrontmatter(content).trim();

  if (!trimmed) {
    return {
      relativePath: source.relativePath,
      contentHash,
      facts: [],
      heuristicSkips: [],
      skipped: true,
      skipReason: "empty file",
    };
  }

  if (source.kind === "adr") {
    const fact = buildFact({
      source,
      title: firstHeading(trimmed) ?? source.relativePath,
      body: trimmed,
      knowledgeKind: "decision",
      score: 10,
      sectionSlug: "document",
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    });
    return {
      relativePath: source.relativePath,
      contentHash,
      facts: fact ? [fact] : [],
      heuristicSkips: [],
      skipped: !fact,
      ...(fact ? {} : { skipReason: "content below minimum signal" }),
    };
  }

  const sections = splitMarkdownSections(trimmed);
  const facts: CandidateFact[] = [];
  const heuristicSkips: CandidateFact[] = [];
  const takenSlugs = new Set<string>();

  for (const [index, section] of sections.entries()) {
    const scored = scoreSection(
      section.heading,
      section.body,
      source.kind,
      index === 0,
    );
    if (!scored) {
      continue;
    }
    const fact = buildFact({
      source,
      title: section.heading || source.relativePath,
      body: section.body,
      knowledgeKind: scored.kind,
      score: scored.score,
      sectionSlug: uniqueSectionSlug(
        slugifyHeading(section.heading || "body"),
        takenSlugs,
      ),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    });
    if (!fact) {
      continue;
    }
    if (scored.keep) {
      facts.push(fact);
    } else {
      heuristicSkips.push(fact);
    }
  }

  facts.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  return {
    relativePath: source.relativePath,
    contentHash,
    facts,
    heuristicSkips,
    skipped: facts.length === 0,
    ...(facts.length === 0
      ? { skipReason: "no high-signal sections matched heuristics" }
      : {}),
  };
}

interface Section {
  heading: string;
  body: string;
}

function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  if (!match || match.index !== 0) {
    return content;
  }
  return content.slice(match[0].length);
}

function splitMarkdownSections(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let heading = "";
  let bodyLines: string[] = [];
  let inFence = false;

  const flush = (): void => {
    const body = bodyLines.join("\n").trim();
    if (!heading && !body) {
      return;
    }
    sections.push({
      heading,
      body: heading ? `# ${heading}\n\n${body}` : body,
    });
    heading = "";
    bodyLines = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      bodyLines.push(line);
      continue;
    }
    if (!inFence) {
      const match = /^(#{1,3})\s+(.+)$/.exec(line);
      if (match?.[2]) {
        flush();
        heading = match[2].trim();
        continue;
      }
    }
    bodyLines.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ heading: "", body: content }];
}

function scoreSection(
  heading: string,
  body: string,
  sourceKind: DurableSource["kind"],
  isFirst: boolean,
): { kind: KnowledgeKind; score: number; keep: boolean } | undefined {
  const text = `${heading}\n${body}`;
  if (text.trim().length < MIN_SECTION_CHARS) {
    return undefined;
  }

  const hardNoise = HARD_NOISE_HEADINGS.test(heading.trim());
  const softNoise = SOFT_NOISE_HEADINGS.test(heading.trim());
  let bestKind: KnowledgeKind = sourceKind === "readme" ? "overview" : "other";
  let score = sourceKind === "docs" ? 1 : sourceKind === "readme" ? 1 : 0;
  let strongSignal = false;

  for (const signal of SIGNAL_PATTERNS) {
    if (signal.pattern.test(text)) {
      score += signal.weight;
      if (signal.weight >= 4) {
        strongSignal = true;
        bestKind = signal.kind;
      } else if (bestKind === "other" || bestKind === "overview") {
        bestKind = signal.kind;
      }
    }
  }

  const noise = hardNoise || (softNoise && !strongSignal);

  if (!noise && sourceKind === "readme" && isFirst) {
    score += 3;
    bestKind = "overview";
  }

  return { kind: bestKind, score, keep: !noise && score >= 3 };
}

function buildFact(input: {
  source: DurableSource;
  title: string;
  body: string;
  knowledgeKind: KnowledgeKind;
  score: number;
  commit?: string;
  sectionSlug: string;
}): CandidateFact | undefined {
  const content = input.body.trim().slice(0, MAX_FACT_CHARS);
  if (content.length < MIN_SECTION_CHARS) {
    return undefined;
  }

  const provenance: CandidateFact["provenance"] = {
    sourcePath: input.source.relativePath,
    kind: input.source.kind,
  };
  if (input.commit !== undefined) {
    provenance.commit = input.commit;
  }

  return {
    id: `orto:${input.source.relativePath}#${input.sectionSlug}`,
    title: input.title.slice(0, 160),
    content,
    knowledgeKind: input.knowledgeKind,
    score: input.score,
    provenance,
  };
}

function firstHeading(content: string): string | undefined {
  let inFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = /^#{1,3}\s+(.+)$/.exec(line);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}
