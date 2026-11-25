import { Octokit } from "@octokit/rest";
import { RepoSourceError, type RepoFacts, type RepoSource } from "../source";

const MAX_PATH_DEPTH = 3;
const MAX_PATHS = 2000;
const MAX_MANIFEST_BYTES = 20 * 1024;
const MAX_MANIFESTS = 10;
const MAX_COMMITS = 50;
const MAX_PULLS = 30;
const MANIFEST_NAMES = new Set(["package.json", "pom.xml", "build.gradle", "requirements.txt"]);

export type GitHubSourceOptions = {
  repoUrl: string;
  token?: string;
  /** 테스트용 주입. 없으면 token으로 만든다. */
  octokit?: Octokit;
};

/** `https://github.com/owner/repo(.git)` 또는 `owner/repo`. 그 밖의 형식은 not_found. */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  const raw = repoUrl.trim();
  const m =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(raw) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(raw);
  if (!m) throw new RepoSourceError("not_found", `지원하지 않는 레포 주소예요: ${repoUrl}`);
  return { owner: m[1], repo: m[2] };
}

function header(headers: unknown, name: string): string | undefined {
  const h = headers as Record<string, string | number | undefined> | undefined;
  const v = h?.[name];
  return v === undefined ? undefined : String(v);
}

/** GitHub(Octokit) 오류를 RepoSourceError로 바꾼다. */
export function mapGitHubError(err: unknown): RepoSourceError {
  if (err instanceof RepoSourceError) return err;
  const e = err as { status?: number; message?: string; response?: { headers?: unknown } };
  const status = e?.status;
  const exhausted = header(e?.response?.headers, "x-ratelimit-remaining") === "0";
  const message = e?.message ?? String(err);
  if (status === 404) return new RepoSourceError("not_found", message);
  if (status === 401) return new RepoSourceError("unauthorized", message);
  if (status === 403 || status === 429) {
    return new RepoSourceError(exhausted ? "rate_limited" : status === 403 ? "unauthorized" : "unknown", message);
  }
  return new RepoSourceError("unknown", message);
}

function decodeBase64(content: string): string {
  return Buffer.from(content, "base64").toString("utf8");
}

function capBytes(text: string, max: number): string {
  const buf = Buffer.from(text, "utf8");
  return buf.length <= max ? text : buf.subarray(0, max).toString("utf8");
}

export function createGitHubSource(opts: GitHubSourceOptions): RepoSource {
  const { owner, repo } = parseRepoUrl(opts.repoUrl);
  const octokit = opts.octokit ?? new Octokit({ auth: opts.token });

  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      throw mapGitHubError(err);
    }
  }

  /** 404면 null. 그 밖의 오류는 그대로 던진다. */
  async function optional<T>(run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      const mapped = mapGitHubError(err);
      if (mapped.code === "not_found") return null;
      throw mapped;
    }
  }

  return {
    async fetchFacts(): Promise<RepoFacts> {
      const { data: info } = await call(() => octokit.rest.repos.get({ owner, repo }));
      const defaultBranch = info.default_branch;

      const { data: tree } = await call(() =>
        octokit.rest.git.getTree({ owner, repo, tree_sha: defaultBranch, recursive: "true" }),
      );
      let truncated = Boolean(tree.truncated);
      const paths: string[] = [];
      for (const entry of tree.tree) {
        if (!entry.path) continue;
        // 깊이 제한은 설계된 필터이므로 truncated로 보지 않는다. 개수 상한만 truncated.
        if (entry.path.split("/").length > MAX_PATH_DEPTH) continue;
        if (paths.length >= MAX_PATHS) {
          truncated = true;
          break;
        }
        paths.push(entry.path);
      }

      const manifestPaths = paths.filter((p) => MANIFEST_NAMES.has(p.split("/").pop() ?? ""));
      if (manifestPaths.length > MAX_MANIFESTS) truncated = true;
      const manifests: Record<string, string> = {};
      for (const path of manifestPaths.slice(0, MAX_MANIFESTS)) {
        const res = await optional(() => octokit.rest.repos.getContent({ owner, repo, path, ref: defaultBranch }));
        const data = res?.data as { type?: string; content?: string } | undefined;
        if (data && !Array.isArray(data) && data.type === "file" && typeof data.content === "string") {
          const text = decodeBase64(data.content);
          if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) truncated = true;
          manifests[path] = capBytes(text, MAX_MANIFEST_BYTES);
        }
      }

      const readmeRes = await optional(() => octokit.rest.repos.getReadme({ owner, repo }));
      let readme: string | null = null;
      if (readmeRes && typeof readmeRes.data.content === "string") {
        const text = decodeBase64(readmeRes.data.content);
        if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) truncated = true;
        readme = capBytes(text, MAX_MANIFEST_BYTES);
      }

      const { data: commitRows } = await call(() =>
        octokit.rest.repos.listCommits({ owner, repo, per_page: MAX_COMMITS }),
      );
      const commits = commitRows.slice(0, MAX_COMMITS).map((c) => ({
        sha: c.sha,
        message: c.commit.message,
        date: c.commit.author?.date ?? c.commit.committer?.date ?? "",
        url: c.html_url ?? null,
      }));

      const { data: pullRows } = await call(() =>
        octokit.rest.pulls.list({ owner, repo, state: "all", sort: "updated", direction: "desc", per_page: MAX_PULLS }),
      );
      const pulls = pullRows.slice(0, MAX_PULLS).map((p) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        mergedAt: p.merged_at ?? null,
        url: p.html_url ?? null,
      }));

      return {
        sourceKind: "github",
        repoLabel: `${owner}/${repo}`,
        defaultBranch,
        paths,
        manifests,
        readme,
        commits,
        pulls,
        truncated,
      };
    },
  };
}
