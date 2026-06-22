import { Octokit } from "@octokit/rest";

export function createGithubClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

/**
 * Phase 1 auth: a personal token from the environment, or the local `gh` CLI
 * session. Phase 2 replaces this with a GitHub App installation token.
 */
export async function resolveGithubToken(): Promise<string> {
  const { GITHUB_TOKEN, GH_TOKEN } = process.env;
  const fromEnv = GITHUB_TOKEN ?? GH_TOKEN;
  if (fromEnv) {
    return fromEnv;
  }
  const proc = Bun.spawn(["gh", "auth", "token"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  // Drain stdout before awaiting exit: reading first frees the pipe buffer so
  // the subprocess can never block on a full pipe and deadlock.
  const token = (await new Response(proc.stdout).text()).trim();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(
      "No GitHub token found. Set GITHUB_TOKEN/GH_TOKEN or run `gh auth login`.",
    );
  }
  if (!token) {
    throw new Error("`gh auth token` returned an empty token.");
  }
  return token;
}
