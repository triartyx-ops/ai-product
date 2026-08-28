import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

import { aiProductAnalysisJsonSchema, aiProductAnalysisSchema, type AiProductAnalysis } from "./product-analysis";
import { businessGapAnalysisJsonSchema, businessGapAnalysisSchema, type BusinessGapAnalysis } from "./business-gap-analysis";
import { businessSelectionJsonSchema, businessSelectionSchema, type BusinessSelectionAnalysis } from "./business-selection";
import type { AiUsage } from "./openai-client";

export class CodexCliProductClient {
  constructor(private readonly model?: string) {}

  private async execute(schema: object, prompt: string): Promise<unknown> {
    const directory = await mkdtemp(join(tmpdir(), "github-radar-ai-"));
    const schemaPath = join(directory, "schema.json");
    const outputPath = join(directory, "output.json");
    await writeFile(schemaPath, JSON.stringify(schema), { encoding: "utf8", mode: 0o600 });
    const args = ["exec", "--ephemeral", "--ignore-rules", "--ignore-user-config", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "--output-schema", schemaPath, "--output-last-message", outputPath];
    if (this.model) args.push("--model", this.model);
    args.push("-");
    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn("codex", args, { cwd: directory, stdio: ["pipe", "ignore", "pipe"] });
        let errors = "";
        child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { errors += chunk; });
        child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(0) : reject(new Error(errors.slice(-2000) || `Codex exited ${code}`)));
        child.stdin.end(prompt);
      });
      if (exitCode !== 0) throw new Error(`Codex exited ${exitCode}`);
      return JSON.parse(await readFile(outputPath, "utf8")) as unknown;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async analyze(system: string, input: string): Promise<{ analysis: AiProductAnalysis; raw: unknown; usage: AiUsage }> {
    const output = await this.execute(aiProductAnalysisJsonSchema, `${system}\n\nAnalyze only the supplied JSON. Do not use tools, browse, or inspect files.\n\n${input}`);
    return { analysis: aiProductAnalysisSchema.parse(output), raw: output, usage: { requests: 1, inputTokens: 0, outputTokens: 0 } };
  }

  async analyzeBatch(system: string, inputs: Array<{ repositoryFullName: string; input: string }>): Promise<{ analyses: Array<AiProductAnalysis & { repositoryFullName: string }>; raw: unknown; usage: AiUsage }> {
    const itemProperties = { repositoryFullName: { type: "string" }, ...aiProductAnalysisJsonSchema.properties };
    const schema = { type: "object", properties: { analyses: { type: "array", minItems: inputs.length, maxItems: inputs.length,
      items: { type: "object", properties: itemProperties, required: Object.keys(itemProperties), additionalProperties: false } } },
      required: ["analyses"], additionalProperties: false };
    const prompt = `${system}\n\nAnalyze every supplied repository independently. Return exactly one analysis per repository and preserve repositoryFullName exactly. Do not use tools, browse, or inspect files.\n\n${JSON.stringify(inputs)}`;
    const output = await this.execute(schema, prompt);
    const parsed = z.object({ analyses: z.array(aiProductAnalysisSchema.extend({ repositoryFullName: z.string() })).length(inputs.length) }).parse(output);
    return { analyses: parsed.analyses, raw: output, usage: { requests: 1, inputTokens: 0, outputTokens: 0 } };
  }

  async analyzeBusinessBatch(system: string, inputs: Array<{ repositoryFullName: string; input: string }>): Promise<{ analyses: Array<BusinessGapAnalysis & { repositoryFullName: string }>; raw: unknown; usage: AiUsage }> {
    const itemProperties = { repositoryFullName: { type: "string" }, ...businessGapAnalysisJsonSchema.properties };
    const schema = { type: "object", properties: { analyses: { type: "array", minItems: inputs.length, maxItems: inputs.length,
      items: { type: "object", properties: itemProperties, required: Object.keys(itemProperties), additionalProperties: false } } },
      required: ["analyses"], additionalProperties: false };
    const prompt = `${system}\n\nAnalyze every supplied repository independently. Return exactly one analysis per repository and preserve repositoryFullName exactly. Do not use tools, browse, or inspect files.\n\n${JSON.stringify(inputs)}`;
    const output = await this.execute(schema, prompt);
    const parsed = z.object({ analyses: z.array(businessGapAnalysisSchema.extend({ repositoryFullName: z.string() })).length(inputs.length) }).parse(output);
    return { analyses: parsed.analyses, raw: output, usage: { requests: 1, inputTokens: 0, outputTokens: 0 } };
  }

  async analyzeBusinessSelectionBatch(system: string, inputs: Array<{ repositoryFullName: string; input: string }>): Promise<{ analyses: Array<BusinessSelectionAnalysis & { repositoryFullName: string }>; raw: unknown; usage: AiUsage }> {
    const itemProperties = { repositoryFullName: { type: "string" }, ...businessSelectionJsonSchema.properties };
    const schema = { type: "object", properties: { analyses: { type: "array", minItems: inputs.length, maxItems: inputs.length,
      items: { type: "object", properties: itemProperties, required: Object.keys(itemProperties), additionalProperties: false } } },
      required: ["analyses"], additionalProperties: false };
    const prompt = `${system}\n\nAnalyze every supplied repository independently. Return exactly one analysis per repository and preserve repositoryFullName exactly. Do not use tools, browse, or inspect files.\n\n${JSON.stringify(inputs)}`;
    const output = await this.execute(schema, prompt);
    const parsed = z.object({ analyses: z.array(businessSelectionSchema.extend({ repositoryFullName: z.string() })).length(inputs.length) }).parse(output);
    return { analyses: parsed.analyses, raw: output, usage: { requests: 1, inputTokens: 0, outputTokens: 0 } };
  }
}
