import { z } from "zod";
import { DEPLOYMENT_PROFILES, type DeploymentProfile } from "./profiles.js";

export const DockerConfigSchema = z.object({
  containerName: z.string().min(1),
  volumeName: z.string().min(1).optional(),
});

export const StoreConfigSchema = z.object({
  allowlist: z.array(z.string().min(1)).default([]),
});

export const PriorityWeightsSchema = z.object({
  durability: z.number().nonnegative(),
  centrality: z.number().nonnegative(),
  supersession: z.number().nonnegative(),
  fanout: z.number().nonnegative(),
  secretRisk: z.number().nonnegative(),
});

export const JudgeConfigSchema = z.object({
  priorityWeights: PriorityWeightsSchema.optional(),
});

export const EXTRACTION_AGGRESSIVENESS = [
  "conservative",
  "standard",
  "greedy",
] as const;

export const BankTemplateConfigSchema = z.object({
  extraction: z.enum(EXTRACTION_AGGRESSIVENESS).optional(),
});

export const ScannerConfigSchema = z.object({
  include: z.array(z.string().min(1)).optional(),
  exclude: z.array(z.string().min(1)).optional(),
  extensions: z
    .array(z.string().regex(/^\.[A-Za-z0-9]+$/, "extension must look like .md"))
    .optional(),
});

export const OrtoConfigSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  provider: z.literal("hindsight"),
  bankId: z.string().min(1),
  root: z.string().min(1),
  createdAt: z.string().datetime(),
  hindsightBaseUrl: z.string().url().optional(),
  deploymentProfile: z.enum(DEPLOYMENT_PROFILES).optional(),
  docker: DockerConfigSchema.optional(),
  store: StoreConfigSchema.optional(),
  scanner: ScannerConfigSchema.optional(),
  judge: JudgeConfigSchema.optional(),
  bankTemplate: BankTemplateConfigSchema.optional(),
});

export type DockerConfig = z.infer<typeof DockerConfigSchema>;
export type StoreConfig = z.infer<typeof StoreConfigSchema>;
export type PriorityWeightsConfig = z.infer<typeof PriorityWeightsSchema>;
export type JudgeConfig = z.infer<typeof JudgeConfigSchema>;
export type BankTemplateConfig = z.infer<typeof BankTemplateConfigSchema>;
export type ScannerConfig = z.infer<typeof ScannerConfigSchema>;
export type OrtoConfig = z.infer<typeof OrtoConfigSchema>;
export type ExtractionAggressivenessConfig =
  (typeof EXTRACTION_AGGRESSIVENESS)[number];

export function createDefaultConfig(input: {
  name: string;
  root?: string;
  bankId?: string;
  hindsightBaseUrl?: string;
  deploymentProfile?: DeploymentProfile;
  docker?: DockerConfig;
}): OrtoConfig {
  const bankId = input.bankId ?? slugify(input.name);
  const config: OrtoConfig = {
    version: 1,
    name: input.name,
    provider: "hindsight",
    bankId,
    root: input.root ?? ".",
    createdAt: new Date().toISOString(),
    deploymentProfile: input.deploymentProfile ?? "local",
  };
  if (input.hindsightBaseUrl !== undefined) {
    config.hindsightBaseUrl = input.hindsightBaseUrl;
  }
  if (input.docker !== undefined) {
    config.docker = input.docker;
  }
  return config;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project"
  );
}

export function normalizeResourceName(value: string): string {
  const slug = slugify(value);
  if (!slug || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return "project";
  }
  return slug;
}

export function defaultVolumeName(containerName: string): string {
  return `${containerName}-data`;
}
