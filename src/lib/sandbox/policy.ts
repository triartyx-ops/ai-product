export const SANDBOX_DOCKER_CONTEXT = "colima-repo-sandbox";
export const SANDBOX_IMAGE = "alpine:3.21";
export const SANDBOX_RUNTIME_IMAGE = "ai-product/alpine-edge-node:20260826-nonroot";
export const SANDBOX_UID = 1000;
export const SANDBOX_GID = 1000;

export type SandboxLimits = {
  cpus: number;
  memoryBytes: number;
  pids: number;
};

export const PREFLIGHT_LIMITS: SandboxLimits = { cpus: 1, memoryBytes: 512 * 1024 * 1024, pids: 128 };
export const VALIDATION_LIMITS: SandboxLimits = { cpus: 2, memoryBytes: 3 * 1024 * 1024 * 1024, pids: 256 };

export function hardenedDockerRunArgs(name: string, limits: SandboxLimits, network: string, extraArgs: string[] = []): string[] {
  return [
    "--context", SANDBOX_DOCKER_CONTEXT, "run", "--name", name,
    "--network", network, "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
    "--user", `${SANDBOX_UID}:${SANDBOX_GID}`,
    "--pids-limit", String(limits.pids), "--cpus", String(limits.cpus),
    "--memory", String(limits.memoryBytes), "--memory-swap", String(limits.memoryBytes),
    ...extraArgs,
  ];
}

/**
 * PID 1 must outlive individual validation stages. Stage timeouts belong on
 * `docker exec` commands, never on the container keepalive itself.
 */
export function persistentSandboxEntrypoint(): string[] {
  return ["sh", "-c", "while true; do sleep 3600; done"];
}

export type SecurityPreflight = {
  dockerContext: boolean;
  serverLinux: boolean;
  noHostHome: boolean;
  noGitHubToken: boolean;
  noSshKeys: boolean;
  noDockerSocket: boolean;
  noProjectEnv: boolean;
  unprivileged: boolean;
  nonRootUser: boolean;
  noNewPrivileges: boolean;
  allCapabilitiesDropped: boolean;
  limitsApplied: boolean;
  disposable: boolean;
};

export function preflightPassed(result: SecurityPreflight): boolean {
  return Object.values(result).every(Boolean);
}
