export type RetainExtractionMode =
  | "concise"
  | "verbose"
  | "custom"
  | "chunks"
  | "verbatim";

export interface HindsightEntityLabelValue {
  value: string;
}

export interface HindsightEntityLabel {
  key: string;
  type: "value";
  values: HindsightEntityLabelValue[];
}

export interface HindsightBankConfig {
  reflect_mission: string;
  retain_mission: string;
  retain_extraction_mode: RetainExtractionMode;
  enable_observations: boolean;
  observations_mission: string;
  disposition_skepticism: number;
  disposition_literalism: number;
  disposition_empathy: number;
  entities_allow_free_form: boolean;
  entity_labels: HindsightEntityLabel[];
}

export type MentalModelTagsMatch =
  | "any"
  | "all"
  | "any_strict"
  | "all_strict"
  | "exact";

export type MentalModelRefreshMode = "full" | "delta";

export interface HindsightMentalModelTrigger {
  refresh_after_consolidation: boolean;
  tags_match?: MentalModelTagsMatch;
  mode?: MentalModelRefreshMode;
  min_refresh_interval_seconds?: number;
}

export interface HindsightMentalModel {
  id: string;
  name: string;
  source_query: string;
  max_tokens: number;
  tags: string[];
  trigger: HindsightMentalModelTrigger;
}

export interface HindsightDirective {
  name: string;
  content: string;
  priority: number;
  is_active: boolean;
  tags: string[];
}

export interface HindsightBankTemplate {
  version: "1";
  bank: HindsightBankConfig;
  mental_models: HindsightMentalModel[];
  directives: HindsightDirective[];
}

export type MentalModelTaggingMode =
  | "project-wide"
  | "topic-scoped"
  | "custom";

export type MentalModelRefreshPolicy =
  | "auto"
  | "manual"
  | "differentiated";

export interface BankTemplateInput {
  projectName: string;
  bankId: string;
  mentalModelIds?: string[];
  taggingMode?: MentalModelTaggingMode;
  customTagsByModelId?: Record<string, string[]>;
  refreshPolicy?: MentalModelRefreshPolicy;
  retainExtractionMode?: RetainExtractionMode;
}
