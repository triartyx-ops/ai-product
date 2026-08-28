import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { PREFLIGHT_LIMITS, SANDBOX_DOCKER_CONTEXT, SANDBOX_IMAGE, hardenedDockerRunArgs, persistentSandboxEntrypoint } from "@/lib/sandbox/policy";

const exec = promisify(execFile);
const name = `ai-product-lifecycle-${Date.now()}`;
const docker = async (args: string[]) => (await exec("docker", args, { maxBuffer: 1024 * 1024 })).stdout.trim();
let created = false;

try {
  await docker([...hardenedDockerRunArgs(name, PREFLIGHT_LIMITS, "none", ["--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", "-d", SANDBOX_IMAGE, ...persistentSandboxEntrypoint()])]);
  created = true;
  await docker(["--context", SANDBOX_DOCKER_CONTEXT, "exec", name, "sh", "-ceu", "touch /tmp/stage-one"]);
  const afterFirst = await docker(["--context", SANDBOX_DOCKER_CONTEXT, "inspect", name, "--format", "{{.State.Running}}"]) === "true";
  const second = await docker(["--context", SANDBOX_DOCKER_CONTEXT, "exec", name, "sh", "-ceu", "test -f /tmp/stage-one; printf second-stage"]);
  if (!afterFirst || second !== "second-stage") throw new Error("Sandbox did not survive independent stages.");
  console.log(JSON.stringify({ containerSurvivedFirstStage: afterFirst, secondStageExecuted: true }, null, 2));
} finally {
  if (created) await docker(["--context", SANDBOX_DOCKER_CONTEXT, "rm", "--force", name]);
}

try {
  await docker(["--context", SANDBOX_DOCKER_CONTEXT, "inspect", name]);
  throw new Error("Lifecycle cleanup did not remove the sandbox container.");
} catch (error) {
  if (error instanceof Error && error.message.includes("Lifecycle cleanup")) throw error;
  console.log(JSON.stringify({ cleanupRemovedContainer: true }, null, 2));
}
