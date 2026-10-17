import type { SshExecRequest } from "../qemu/ssh.js";
export type GitSshExecInfo = {
    /** git service name (for example "git-upload-pack") */
    service: string;
    /** git repo path (for example "org/name.git") */
    repo: string;
};
/**
 * Best-effort parser for git-over-SSH exec commands.
 *
 * This intentionally only understands common git smart-protocol invocations such as:
 * - git-upload-pack 'org/repo.git'
 * - git-receive-pack 'org/repo.git'
 *
 * Security note: many SSH servers execute the requested command via a shell (for example `sh -c <command>`).
 * This file is NOT a full shell parser; instead we stay safe by (1) requiring exactly two argv tokens and
 * (2) only accepting conservative service/repo strings that contain no shell metacharacters/expansions.
 * If the command deviates from the canonical git form, we fail closed and return null.
 */
export declare function getInfoFromSshExecRequest(req: SshExecRequest): GitSshExecInfo | null;
//# sourceMappingURL=exec.d.ts.map