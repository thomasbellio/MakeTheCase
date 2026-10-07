CREATE TYPE "public"."attribution" AS ENUM('author', 'opposing', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."claim_kind" AS ENUM('factual', 'legal_rule', 'normative', 'definitional', 'causal', 'predictive');--> statement-breakpoint
CREATE TYPE "public"."document_role" AS ENUM('own_brief', 'opposing_brief', 'article', 'other');--> statement-breakpoint
CREATE TYPE "public"."finding_kind" AS ENUM('invalid_step', 'unchecked_step', 'circularity', 'unsupported_claim', 'load_bearing', 'implicit_premise', 'unconnected_claim');--> statement-breakpoint
CREATE TYPE "public"."inference_scheme" AS ENUM('deductive', 'causal', 'analogical', 'abductive', 'statistical');--> statement-breakpoint
CREATE TYPE "public"."modality" AS ENUM('asserted', 'probable', 'possible', 'hedged');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('stated', 'inferred', 'user_added');--> statement-breakpoint
CREATE TYPE "public"."pipeline_stage" AS ENUM('segment', 'classify', 'extract', 'reconstruct', 'validate', 'analyze', 'persist');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('rebut', 'undermine', 'undercut', 'qualify');--> statement-breakpoint
CREATE TYPE "public"."run_event_type" AS ENUM('stage_started', 'stage_progress', 'stage_completed', 'validation_retry', 'run_failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'completed', 'not_an_argument', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."span_function" AS ENUM('argumentative', 'narrative', 'descriptive', 'instructional', 'rhetorical', 'unclassified');--> statement-breakpoint
CREATE TABLE "analysis_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"revision_id" uuid,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"current_stage" "pipeline_stage",
	"summary" text,
	"model_config" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_summary_when_not_an_argument" CHECK ("analysis_run"."status" <> 'not_an_argument' or "analysis_run"."summary" is not null)
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"canonical_text" text NOT NULL,
	"kind" "claim_kind" NOT NULL,
	"modality" "modality" DEFAULT 'asserted' NOT NULL,
	"origin" "origin" NOT NULL,
	"attribution" "attribution" DEFAULT 'author' NOT NULL,
	"citation" text,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"is_thesis" boolean DEFAULT false NOT NULL,
	CONSTRAINT "claim_confidence_range" CHECK ("claim"."confidence" >= 0 and "claim"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_text" text NOT NULL,
	"title" text,
	"role" "document_role" DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding_target" (
	"finding_id" uuid NOT NULL,
	"claim_id" uuid,
	"inference_id" uuid,
	"ordinal" integer NOT NULL,
	CONSTRAINT "finding_target_finding_id_ordinal_pk" PRIMARY KEY("finding_id","ordinal"),
	CONSTRAINT "finding_target_exactly_one" CHECK (("finding_target"."claim_id" is null) <> ("finding_target"."inference_id" is null))
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"kind" "finding_kind" NOT NULL,
	"severity" "severity" NOT NULL,
	"explanation" text NOT NULL,
	"produced_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_premise" (
	"inference_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"origin" "origin" NOT NULL,
	CONSTRAINT "inference_premise_inference_id_claim_id_pk" PRIMARY KEY("inference_id","claim_id")
);
--> statement-breakpoint
CREATE TABLE "inference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"conclusion_claim_id" uuid NOT NULL,
	"scheme" "inference_scheme" NOT NULL,
	"origin" "origin" NOT NULL,
	"attribution" "attribution" DEFAULT 'author' NOT NULL,
	"formalization" jsonb,
	"confidence" double precision DEFAULT 1 NOT NULL,
	CONSTRAINT "inference_confidence_range" CHECK ("inference"."confidence" >= 0 and "inference"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "occurrence" (
	"claim_id" uuid NOT NULL,
	"span_id" uuid NOT NULL,
	"surface_text" text NOT NULL,
	CONSTRAINT "occurrence_claim_id_span_id_pk" PRIMARY KEY("claim_id","span_id")
);
--> statement-breakpoint
CREATE TABLE "relation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revision_id" uuid NOT NULL,
	"source_claim_id" uuid NOT NULL,
	"target_claim_id" uuid,
	"target_inference_id" uuid,
	"type" "relation_type" NOT NULL,
	CONSTRAINT "relation_exactly_one_target" CHECK (("relation"."target_claim_id" is null) <> ("relation"."target_inference_id" is null))
);
--> statement-breakpoint
CREATE TABLE "revision" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"parent_revision_id" uuid,
	"author" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"stage" "pipeline_stage",
	"type" "run_event_type" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "span" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"is_heading" boolean DEFAULT false NOT NULL,
	"function" "span_function" DEFAULT 'unclassified' NOT NULL,
	"function_confidence" double precision,
	CONSTRAINT "span_offsets_ordered" CHECK ("span"."char_end" >= "span"."char_start"),
	CONSTRAINT "span_confidence_range" CHECK ("span"."function_confidence" is null or ("span"."function_confidence" >= 0 and "span"."function_confidence" <= 1))
);
--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "analysis_run_revision_id_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_revision_id_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_target" ADD CONSTRAINT "finding_target_finding_id_finding_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."finding"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_target" ADD CONSTRAINT "finding_target_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_target" ADD CONSTRAINT "finding_target_inference_id_inference_id_fk" FOREIGN KEY ("inference_id") REFERENCES "public"."inference"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_revision_id_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_premise" ADD CONSTRAINT "inference_premise_inference_id_inference_id_fk" FOREIGN KEY ("inference_id") REFERENCES "public"."inference"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_premise" ADD CONSTRAINT "inference_premise_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference" ADD CONSTRAINT "inference_revision_id_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference" ADD CONSTRAINT "inference_conclusion_claim_id_claim_id_fk" FOREIGN KEY ("conclusion_claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence" ADD CONSTRAINT "occurrence_claim_id_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrence" ADD CONSTRAINT "occurrence_span_id_span_id_fk" FOREIGN KEY ("span_id") REFERENCES "public"."span"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_revision_id_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revision"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_source_claim_id_claim_id_fk" FOREIGN KEY ("source_claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_target_claim_id_claim_id_fk" FOREIGN KEY ("target_claim_id") REFERENCES "public"."claim"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation" ADD CONSTRAINT "relation_target_inference_id_inference_id_fk" FOREIGN KEY ("target_inference_id") REFERENCES "public"."inference"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision" ADD CONSTRAINT "revision_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision" ADD CONSTRAINT "revision_parent_revision_id_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_event" ADD CONSTRAINT "run_event_run_id_analysis_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "span" ADD CONSTRAINT "span_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_run_document_idx" ON "analysis_run" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "analysis_run_revision_idx" ON "analysis_run" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "claim_revision_idx" ON "claim" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_one_thesis_per_revision_idx" ON "claim" USING btree ("revision_id") WHERE "claim"."is_thesis";--> statement-breakpoint
CREATE INDEX "finding_target_claim_idx" ON "finding_target" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "finding_target_inference_idx" ON "finding_target" USING btree ("inference_id");--> statement-breakpoint
CREATE INDEX "finding_revision_idx" ON "finding" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "inference_premise_claim_idx" ON "inference_premise" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "inference_revision_idx" ON "inference" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "inference_conclusion_idx" ON "inference" USING btree ("conclusion_claim_id");--> statement-breakpoint
CREATE INDEX "occurrence_span_idx" ON "occurrence" USING btree ("span_id");--> statement-breakpoint
CREATE INDEX "relation_revision_idx" ON "relation" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "relation_source_idx" ON "relation" USING btree ("source_claim_id");--> statement-breakpoint
CREATE INDEX "relation_target_claim_idx" ON "relation" USING btree ("target_claim_id");--> statement-breakpoint
CREATE INDEX "relation_target_inference_idx" ON "relation" USING btree ("target_inference_id");--> statement-breakpoint
CREATE INDEX "revision_document_idx" ON "revision" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "revision_parent_idx" ON "revision" USING btree ("parent_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_event_run_sequence_idx" ON "run_event" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "span_document_idx" ON "span" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "span_document_ordinal_idx" ON "span" USING btree ("document_id","ordinal");