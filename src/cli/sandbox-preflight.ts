import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { PREFLIGHT_LIMITS, SANDBOX_DOCKER_CONTEXT, SANDBOX_GID, SANDBOX_IMAGE, SANDBOX_UID, hardenedDockerRunArgs, preflightPassed, type SecurityPreflight } from "@/lib/sandbox/policy";

const exec = promisify(execFile);
const name = `ai-product-preflight-${Date.now()}`;
const docker = async (args: string[]) => (await exec("docker", args, { maxBuffer: 1024 * 1024 })).stdout.trim();

let created = false;
try {
  const context = await docker(["context", "show"]);
  const version = JSON.parse(await docker(["--context", SANDBOX_DOCKER_CONTEXT, "version", "--format", "{{json .Server}}"])) as { Os?: string };
  await docker(hardenedDockerRunArgs(name, PREFLIGHT_LIMITS, "none", ["--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m", SANDBOX_IMAGE, "sh", "-ceu", `test \"$(id -u)\" = \"${SANDBOX_UID}\"; test \"$(id -g)\" = \"${SANDBOX_GID}\"; test ! -e /Users/marina; test -z \"\${GITHUB_TOKEN+x}\"; test ! -e /root/.ssh; test ! -S /var/run/docker.sock; test ! -e /workspace/.env; test ! -e /.env; touch /tmp/disposable-proof; test -f /tmp/disposable-proof`]));
  created = true;
  const inspect = JSON.parse(await docker(["--context", SANDBOX_DOCKER_CONTEXT, "inspect", name, "--format", "{{json .HostConfig}}"])) as { Privileged?: boolean; NanoCpus?: number; Memory?: number; MemorySwap?: number; PidsLimit?: number; CapDrop?: string[]; SecurityOpt?: string[]; Binds?: string[] | null; };
  const configuredUser = await docker(["--context", SANDBOX_DOCKER_CONTEXT, "inspect", name, "--format", "{{.Config.User}}"]) ;
  const result: SecurityPreflight = {
    dockerContext: context === SANDBOX_DOCKER_CONTEXT,
    serverLinux: version.Os === "linux",
    noHostHome: true, noGitHubToken: true, noSshKeys: true, noDockerSocket: true, noProjectEnv: true,
    unprivileged: inspect.Privileged === false,
    nonRootUser: configuredUser === `${SANDBOX_UID}:${SANDBOX_GID}`,
    noNewPrivileges: inspect.SecurityOpt?.includes("no-new-privileges:true") === true,
    allCapabilitiesDropped: inspect.CapDrop?.includes("ALL") === true,
    limitsApplied: inspect.NanoCpus === PREFLIGHT_LIMITS.cpus * 1_000_000_000 && inspect.Memory === PREFLIGHT_LIMITS.memoryBytes && inspect.MemorySwap === PREFLIGHT_LIMITS.memoryBytes && inspect.PidsLimit === PREFLIGHT_LIMITS.pids,
    disposable: !inspect.Binds?.length,
  };
  console.log(JSON.stringify({ result, passed: preflightPassed(result) }, null, 2));
  if (!preflightPassed(result)) process.exitCode = 1;
} finally {
  if (created) await docker(["--context", SANDBOX_DOCKER_CONTEXT, "rm", "--force", name]);
}
