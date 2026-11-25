import { describe, expect, test } from "vitest";
import type { Octokit } from "@octokit/rest";
import { createGitHubSource, parseRepoUrl } from "@/lib/repo/sources/github";
import { RepoSourceError } from "@/lib/repo/source";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

function httpError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { status, response: { headers } });
}

type Overrides = Partial<{
  get: () => Promise<unknown>;
  getTree: (args: unknown) => Promise<unknown>;
  getContent: (args: { path: string }) => Promise<unknown>;
  getReadme: () => Promise<unknown>;
}>;

function fakeOctokit(o: Overrides = {}) {
  const calls: Record<string, unknown[]> = { getTree: [], getContent: [], listCommits: [], pulls: [] };
  const octokit = {
    rest: {
      repos: {
        get: o.get ?? (async () => ({ data: { default_branch: "main" } })),
        getContent:
          o.getContent ??
          (async (args: { path: string }) => {
            calls.getContent.push(args.path);
            if (args.path === "package.json") return { data: { type: "file", content: b64('{"name":"x"}') } };
            throw httpError(404);
          }),
        getReadme: o.getReadme ?? (async () => ({ data: { content: b64("# hello") } })),
        listCommits: async (args: unknown) => {
          calls.listCommits.push(args);
          return {
            data: [{ sha: "abc", html_url: "https://x/c/abc", commit: { message: "fix: a", author: { date: "2026-01-01T00:00:00Z" } } }],
          };
        },
      },
      git: {
        getTree:
          o.getTree ??
          (async (args: unknown) => {
            calls.getTree.push(args);
            return {
              data: {
                truncated: false,
                tree: [
                  { path: "package.json", type: "blob" },
                  { path: "src", type: "tree" },
                  { path: "src/app/page.tsx", type: "blob" },
                  { path: "src/app/deep/nested/file.ts", type: "blob" },
                ],
              },
            };
          }),
      },
      pulls: {
        list: async (args: unknown) => {
          calls.pulls.push(args);
          return { data: [{ number: 7, title: "PR", state: "closed", merged_at: "2026-01-02T00:00:00Z", html_url: "https://x/p/7" }] };
        },
      },
    },
  };
  return { octokit: octokit as unknown as Octokit, calls };
}

const source = (o?: Overrides, repoUrl = "https://github.com/acme/app.git") => {
  const f = fakeOctokit(o);
  return { src: createGitHubSource({ repoUrl, octokit: f.octokit }), ...f };
};

describe("parseRepoUrl", () => {
  test.each([
    ["https://github.com/acme/app", "acme", "app"],
    ["https://github.com/acme/app.git", "acme", "app"],
    ["acme/app", "acme", "app"],
  ])("%s", (url, owner, repo) => {
    expect(parseRepoUrl(url)).toEqual({ owner, repo });
  });
  test("그 밖의 형식은 not_found", () => {
    expect(() => parseRepoUrl("https://gitlab.com/acme/app")).toThrowError(RepoSourceError);
    expect(() => parseRepoUrl("not a url")).toThrowError(expect.objectContaining({ code: "not_found" }));
  });
});

describe("GitHub 출처", () => {
  test("사실을 모은다: 깊이 3 제한, 매니페스트, README, 커밋, PR", async () => {
    const { src, calls } = source();
    const facts = await src.fetchFacts();
    expect(facts).toMatchObject({
      sourceKind: "github",
      repoLabel: "acme/app",
      defaultBranch: "main",
      readme: "# hello",
      truncated: false,
      manifests: { "package.json": '{"name":"x"}' },
      commits: [{ sha: "abc", message: "fix: a", date: "2026-01-01T00:00:00Z", url: "https://x/c/abc" }],
      pulls: [{ number: 7, title: "PR", state: "closed", mergedAt: "2026-01-02T00:00:00Z", url: "https://x/p/7" }],
    });
    expect(facts.paths).toEqual(["package.json", "src", "src/app/page.tsx"]);
    expect(calls.getTree[0]).toMatchObject({ recursive: "true" });
    expect(calls.listCommits[0]).toMatchObject({ per_page: 50 });
    expect(calls.pulls[0]).toMatchObject({ per_page: 30 });
  });

  test("매니페스트·README가 없으면 건너뛴다", async () => {
    const { src } = source({
      getContent: async () => {
        throw httpError(404);
      },
      getReadme: async () => {
        throw httpError(404);
      },
    });
    const facts = await src.fetchFacts();
    expect(facts.manifests).toEqual({});
    expect(facts.readme).toBeNull();
  });

  test("매니페스트는 20KB로 자르고 truncated", async () => {
    const { src } = source({
      getContent: async () => ({ data: { type: "file", content: b64("a".repeat(30_000)) } }),
    });
    const facts = await src.fetchFacts();
    expect(Buffer.byteLength(facts.manifests["package.json"])).toBe(20 * 1024);
    expect(facts.truncated).toBe(true);
  });

  test("GitHub 트리가 잘렸으면 truncated", async () => {
    const { src } = source({
      getTree: async () => ({ data: { truncated: true, tree: [{ path: "a.ts", type: "blob" }] } }),
    });
    expect((await src.fetchFacts()).truncated).toBe(true);
  });

  test("경로가 2000개를 넘으면 자르고 truncated", async () => {
    const tree = Array.from({ length: 2500 }, (_, i) => ({ path: `f${i}.ts`, type: "blob" }));
    const { src } = source({ getTree: async () => ({ data: { truncated: false, tree } }) });
    const facts = await src.fetchFacts();
    expect(facts.paths).toHaveLength(2000);
    expect(facts.truncated).toBe(true);
  });

  test.each([
    ["404 → not_found", httpError(404), "not_found"],
    ["401 → unauthorized", httpError(401), "unauthorized"],
    ["403 → unauthorized", httpError(403, { "x-ratelimit-remaining": "42" }), "unauthorized"],
    ["403 + 한도 소진 → rate_limited", httpError(403, { "x-ratelimit-remaining": "0" }), "rate_limited"],
    ["429 + 한도 소진 → rate_limited", httpError(429, { "x-ratelimit-remaining": "0" }), "rate_limited"],
    ["500 → unknown", httpError(500), "unknown"],
    ["상태 없는 오류 → unknown", new Error("network"), "unknown"],
  ])("%s", async (_name, err, code) => {
    const { src } = source({
      get: async () => {
        throw err;
      },
    });
    await expect(src.fetchFacts()).rejects.toMatchObject({ name: "RepoSourceError", code });
  });

  test("주소를 해석할 수 없으면 fetchFacts 전에 not_found", () => {
    expect(() => createGitHubSource({ repoUrl: "ftp://nope", octokit: fakeOctokit().octokit })).toThrowError(
      expect.objectContaining({ code: "not_found" }),
    );
  });
});
