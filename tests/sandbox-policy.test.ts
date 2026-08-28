import { describe, expect, it } from "vitest";

import { PREFLIGHT_LIMITS, SANDBOX_DOCKER_CONTEXT, SANDBOX_GID, SANDBOX_UID, hardenedDockerRunArgs, persistentSandboxEntrypoint, preflightPassed } from "@/lib/sandbox/policy";

describe("sandbox policy", () => {
  it("pins the isolated Docker context and hardening controls", () => {
    const args = hardenedDockerRunArgs("proof", PREFLIGHT_LIMITS, "none", ["--read-only"]);
    expect(args).toContain(SANDBOX_DOCKER_CONTEXT);
    expect(args).toEqual(expect.arrayContaining(["--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", `${SANDBOX_UID}:${SANDBOX_GID}`, "--pids-limit", "128", "--read-only"]));
  });

  it("requires every security control to pass", () => {
    const passing = { dockerContext: true, serverLinux: true, noHostHome: true, noGitHubToken: true, noSshKeys: true, noDockerSocket: true, noProjectEnv: true, unprivileged: true, nonRootUser: true, noNewPrivileges: true, allCapabilitiesDropped: true, limitsApplied: true, disposable: true };
    expect(preflightPassed(passing)).toBe(true);
    expect(preflightPassed({ ...passing, noDockerSocket: false })).toBe(false);
  });

  it("uses a non-expiring PID 1 rather than a fixed-duration keepalive", () => {
    expect(persistentSandboxEntrypoint()).toEqual(["sh", "-c", "while true; do sleep 3600; done"]);
  });
});
