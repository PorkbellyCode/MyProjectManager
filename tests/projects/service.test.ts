import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import {
  agentProfileVersions,
  groupMembers,
  invitation,
  jobs,
  member,
  organization,
  projects,
  requiredFields,
  ticketEvents,
  ticketSubscriptions,
  tickets,
} from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { upsertGroup, setGroupMembers } from "@/lib/groups/service";
import {
  cancelInvitation,
  changeMemberRole,
  createProject,
  inviteMember,
  ProjectRuleError,
  removeMember,
  requestReanalysis,
  setAccentDefault,
  setDefaultProvider,
  setGithubToken,
  upsertDomainDoc,
} from "@/lib/projects/service";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";

let db: Db;
let close: () => Promise<void>;
let auth: ReturnType<typeof createAuth>;
let lead: { id: string }, dev: { id: string }, dev2: { id: string };
let projectId: string;
let orgId: string;

const roleOf = async (userId: string) =>
  (await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId))))[0]?.role;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth(db);
  lead = await signUp(auth, "lead@example.com", "리드");
  dev = await signUp(auth, "dev@example.com", "개발자");
  dev2 = await signUp(auth, "dev2@example.com", "개발자2");
  const p = await createProject(db, {
    name: "  새 프로젝트  ",
    repoUrl: "https://github.com/acme/app.git",
    githubToken: "ghp_secret",
    creatorId: lead.id,
    defaultProvider: "openai",
  });
  projectId = p.id;
  orgId = p.organizationId;
});
afterAll(async () => close());

async function addMember(userId: string, role: "lead" | "developer" | "requester") {
  await auth.api.addMember({ body: { organizationId: orgId, userId, role } });
}

describe("createProject", () => {
  test("조직 + lead 1명 + 프로필 5역할 v1 + required_fields 4카테고리 + repo.analyze 1건, isDemo=false", async () => {
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(p.name).toBe("새 프로젝트");
    expect(p.repoUrl).toBe("https://github.com/acme/app");
    expect(p.isDemo).toBe(false);
    expect(p.defaultProvider).toBe("openai");
    expect(p.githubTokenEnc).not.toContain("ghp_secret");
    expect(decrypt(p.githubTokenEnc!)).toBe("ghp_secret");

    const members = await db.select().from(member).where(eq(member.organizationId, orgId));
    expect(members.map((m) => [m.userId, m.role])).toEqual([[lead.id, "lead"]]);

    const profiles = await db.select().from(agentProfileVersions).where(eq(agentProfileVersions.projectId, projectId));
    expect(profiles.map((r) => r.role).sort()).toEqual(["lead", "recommender", "repo", "resolver", "summarizer"]);
    expect(profiles.every((r) => r.version === 1)).toBe(true);

    const fields = await db.select().from(requiredFields).where(eq(requiredFields.projectId, projectId));
    expect(fields.map((f) => f.category).sort()).toEqual(["defect", "feature", "improvement", "inquiry"]);
    expect(fields.every((f) => f.items.length > 0)).toBe(true);

    const queued = (await db.select().from(jobs)).filter((j) => j.kind === "repo.analyze" && (j.payload as { projectId: string }).projectId === projectId);
    expect(queued).toHaveLength(1);
  });

  test("잘못된 이름·주소는 거부하고 아무것도 남기지 않는다", async () => {
    const before = (await db.select().from(organization)).length;
    await expect(createProject(db, { name: " ", repoUrl: "https://github.com/a/b", creatorId: lead.id })).rejects.toThrow(ProjectRuleError);
    await expect(createProject(db, { name: "x", repoUrl: "https://example.com/a/b", creatorId: lead.id })).rejects.toThrow("GitHub 주소");
    expect((await db.select().from(organization)).length).toBe(before);
  });
});

describe("requestReanalysis", () => {
  test("이미 대기 중이면 새로 만들지 않는다", async () => {
    expect(await requestReanalysis(db, projectId)).toBe(false);
    await db.update(jobs).set({ status: "done" });
    expect(await requestReanalysis(db, projectId)).toBe(true);
    expect(await requestReanalysis(db, projectId)).toBe(false);
  });
});

describe("멤버와 초대", () => {
  test("초대는 /invite/<id> 링크, 같은 이메일 재초대는 같은 링크, 이미 멤버면 거부", async () => {
    const a = await inviteMember(db, { projectId, email: "New@Example.com", role: "requester", inviterId: lead.id });
    expect(a.path).toBe(`/invite/${a.invitationId}`);
    const b = await inviteMember(db, { projectId, email: "new@example.com", role: "developer", inviterId: lead.id });
    expect(b.invitationId).toBe(a.invitationId);
    const [row] = await db.select().from(invitation).where(eq(invitation.id, a.invitationId));
    expect([row.email, row.role, row.status]).toEqual(["new@example.com", "developer", "pending"]);
    await expect(inviteMember(db, { projectId, email: "lead@example.com", role: "developer", inviterId: lead.id })).rejects.toThrow("이미");
    await expect(inviteMember(db, { projectId, email: "nope", role: "developer", inviterId: lead.id })).rejects.toThrow(ProjectRuleError);
    await cancelInvitation(db, projectId, a.invitationId);
    const [after] = await db.select().from(invitation).where(eq(invitation.id, a.invitationId));
    expect(after.status).toBe("canceled");
  });

  test("유일한 lead는 강등·내보내기를 거부한다", async () => {
    await expect(changeMemberRole(db, { projectId, userId: lead.id, role: "developer" })).rejects.toThrow("마지막 리드");
    await expect(removeMember(db, { projectId, userId: lead.id })).rejects.toThrow("마지막 리드");
    expect(await roleOf(lead.id)).toBe("lead");
  });

  test("lead가 둘이면 한 명은 강등할 수 있다", async () => {
    await addMember(dev2.id, "lead");
    await changeMemberRole(db, { projectId, userId: dev2.id, role: "developer" });
    expect(await roleOf(dev2.id)).toBe("developer");
  });

  test("그룹원을 요청자로 바꾸면 그룹에서 빠지고, 대상 티켓은 리드 큐로 간다", async () => {
    await addMember(dev.id, "developer");
    const g = await upsertGroup(db, { projectId, name: "프론트", scopeDescription: "", repoTags: [] });
    await setGroupMembers(db, g.id, [dev.id, dev2.id]);
    const t = await mkTicket("요청자로 바뀔 사람 대상", { kind: "user", userId: dev.id });
    await changeMemberRole(db, { projectId, userId: dev.id, role: "requester" });
    expect(await roleOf(dev.id)).toBe("requester");
    const gm = await db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id));
    expect(gm.map((r) => r.userId)).toEqual([dev2.id]);
    const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect([row.status, row.targetUserId, row.assigneeId]).toEqual(["queued", null, null]);
  });

  test("멤버를 내보내면 대상·담당 티켓이 리드 큐로, 구독과 그룹 소속은 사라진다", async () => {
    const who = (await signUp(auth, "gone@example.com", "떠날사람")).id;
    await addMember(who, "developer");
    const g = await upsertGroup(db, { projectId, name: "백엔드", scopeDescription: "", repoTags: [] });
    await setGroupMembers(db, g.id, [who]);
    const targeted = await mkTicket("떠날 사람에게 지정", { kind: "user", userId: who });
    const mine = await mkTicket("떠날 사람이 진행 중", { kind: "user", userId: who });
    const whoCtx = await getActorCtx(db, projectId, who);
    await performAction(db, { ticketId: mine.id, expectedVersion: await verOf(mine.id), actor: whoCtx, action: { type: "accept" } });
    const [inProgress] = await db.select().from(tickets).where(eq(tickets.id, mine.id));
    expect(inProgress.status).not.toBe("queued");
    await db.insert(ticketSubscriptions).values({ ticketId: targeted.id, userId: who });

    await removeMember(db, { projectId, userId: who });

    expect(await roleOf(who)).toBeUndefined();
    for (const id of [targeted.id, mine.id]) {
      const [row] = await db.select().from(tickets).where(eq(tickets.id, id));
      expect([row.status, row.targetUserId, row.assigneeId]).toEqual(["queued", null, null]);
      const events = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, id), eq(ticketEvents.type, "member_removed")));
      expect(events).toHaveLength(1);
    }
    expect(await db.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.userId, who))).toHaveLength(0);
    expect(await db.select().from(groupMembers).where(eq(groupMembers.userId, who))).toHaveLength(0);
  });
});

async function verOf(id: string) {
  const [t] = await db.select({ v: tickets.version }).from(tickets).where(eq(tickets.id, id));
  return t.v;
}

async function mkTicket(title: string, target: { kind: "user"; userId: string }) {
  const d = await createDraft(db, { projectId, authorId: lead.id, title, body: "본문", category: "defect", urgency: "normal" });
  await performAction(db, {
    ticketId: d.id,
    expectedVersion: d.version,
    actor: await getActorCtx(db, projectId, lead.id),
    action: { type: "submit", target },
  });
  return d;
}

describe("설정", () => {
  test("setAccentDefault는 #RRGGBB만 저장하고 그 밖의 값은 거부한다", async () => {
    await setAccentDefault(db, projectId, " #abcdef ");
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].accentDefault).toBe("#ABCDEF");
    for (const bad of ["</style><script>alert(1)</script>", "red", "#fff", "#GGGGGG", "#ABCDEF;}body{display:none", ""]) {
      await expect(setAccentDefault(db, projectId, bad)).rejects.toThrow(ProjectRuleError);
    }
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].accentDefault).toBe("#ABCDEF");
    await setAccentDefault(db, projectId, null);
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].accentDefault).toBeNull();
  });

  test("setDefaultProvider는 제공자만 바꾸고 프로필 모델은 그대로 둔다", async () => {
    const before = await db.select().from(agentProfileVersions).where(eq(agentProfileVersions.projectId, projectId));
    await setDefaultProvider(db, projectId, "google");
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].defaultProvider).toBe("google");
    const after = await db.select().from(agentProfileVersions).where(eq(agentProfileVersions.projectId, projectId));
    expect(after.map((r) => r.modelId).sort()).toEqual(before.map((r) => r.modelId).sort());
    await expect(setDefaultProvider(db, projectId, "nope" as never)).rejects.toThrow(ProjectRuleError);
  });

  test("setGithubToken: 암호화 저장, null이면 지움", async () => {
    await setGithubToken(db, projectId, "  new-token ");
    const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(decrypt(p.githubTokenEnc!)).toBe("new-token");
    await setGithubToken(db, projectId, null);
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].githubTokenEnc).toBeNull();
  });

  test("upsertDomainDoc: 같은 제목이면 갱신", async () => {
    const a = await upsertDomainDoc(db, { projectId, title: "용어", body: "v1", editorId: lead.id });
    const b = await upsertDomainDoc(db, { projectId, title: "용어", body: "v2", editorId: lead.id });
    expect(b.id).toBe(a.id);
    expect(b.body).toBe("v2");
    await expect(upsertDomainDoc(db, { projectId, title: " ", body: "", editorId: lead.id })).rejects.toThrow(ProjectRuleError);
  });
});
