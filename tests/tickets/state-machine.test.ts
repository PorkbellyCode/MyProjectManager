import { describe, expect, test } from "vitest";
import {
  applyAction,
  availableActions,
  TransitionError,
  type ActorCtx,
  type TicketShape,
} from "@/lib/tickets/state-machine";
import type { Target } from "@/lib/tickets/targets";

const base: TicketShape = {
  status: "draft",
  authorId: "a1",
  targetUserId: null,
  targetGroupId: null,
  assigneeId: null,
};
const t = (o: Partial<TicketShape>): TicketShape => ({ ...base, ...o });

const inProgress = (assigneeId: string, o: Partial<TicketShape> = {}) =>
  t({ status: "in_progress", assigneeId, ...o });
const onHold = (assigneeId: string) => t({ status: "on_hold", assigneeId });
const queuedGroup = (groupId: string) => t({ status: "queued", targetGroupId: groupId });
const queuedLead = () => t({ status: "queued" });
const assignedTo = (userId: string) => t({ status: "assigned", targetUserId: userId });
const resolved = (assigneeId = "d1") => t({ status: "resolved", assigneeId });
const aiReviewing = () => t({ status: "ai_reviewing" });
const awaiting = () => t({ status: "awaiting_requester" });

const dev = (userId: string, groupIds: string[] = []): ActorCtx => ({
  userId,
  role: "developer",
  groupIds,
});
const lead = (userId = "l1"): ActorCtx => ({ userId, role: "lead", groupIds: [] });
const author = (): ActorCtx => ({ userId: "a1", role: "requester", groupIds: [] });
const system = (): ActorCtx => ({ userId: null, role: "system", groupIds: [] });

const grp = (groupId: string): Target => ({ kind: "group", groupId });
const usr = (userId: string): Target => ({ kind: "user", userId });

describe("전이 표: 각 행 성공", () => {
  test("draft → ai_reviewing (작성자)", () =>
    expect(applyAction(t({}), { type: "requestReview" }, author())).toEqual({ status: "ai_reviewing" }));
  test("ai_reviewing → awaiting_requester (system, stageReady/stageFailed)", () => {
    expect(applyAction(aiReviewing(), { type: "stageReady" }, system())).toEqual({
      status: "awaiting_requester",
    });
    expect(applyAction(aiReviewing(), { type: "stageFailed" }, system())).toEqual({
      status: "awaiting_requester",
    });
  });
  test("awaiting_requester → ai_reviewing (continueReview)", () =>
    expect(applyAction(awaiting(), { type: "continueReview" }, author())).toEqual({
      status: "ai_reviewing",
    }));
  test("awaiting_requester → withdrawn_ai_resolved (withdraw)", () =>
    expect(
      applyAction(awaiting(), { type: "withdraw", kind: "already_resolved" }, author()),
    ).toEqual({ status: "withdrawn_ai_resolved", withdrawKind: "already_resolved" }));
  test("submit: draft/ai_reviewing/awaiting → placeByTarget", () => {
    for (const s of ["draft", "ai_reviewing", "awaiting_requester"] as const) {
      expect(applyAction(t({ status: s }), { type: "submit", target: usr("d1") }, author())).toMatchObject({
        status: "assigned",
        targetUserId: "d1",
        targetGroupId: null,
        assigneeId: null,
      });
      expect(applyAction(t({ status: s }), { type: "submit", target: grp("g1") }, author())).toMatchObject({
        status: "queued",
        targetGroupId: "g1",
        targetUserId: null,
      });
      expect(applyAction(t({ status: s }), { type: "submit", target: null }, author())).toMatchObject({
        status: "queued",
        targetGroupId: null,
        targetUserId: null,
      });
    }
  });
  test("assigned → in_progress (accept, assignee = 행위자)", () =>
    expect(applyAction(assignedTo("d1"), { type: "accept" }, dev("d1"))).toEqual({
      status: "in_progress",
      assigneeId: "d1",
    }));
  test("queued(그룹) claim: 그룹원, lead", () => {
    expect(applyAction(queuedGroup("g1"), { type: "claim" }, dev("d1", ["g1"]))).toEqual({
      status: "in_progress",
      assigneeId: "d1",
    });
    expect(applyAction(queuedGroup("g1"), { type: "claim" }, lead())).toEqual({
      status: "in_progress",
      assigneeId: "l1",
    });
  });
  test("queued(리드 큐) claim: lead / assignTarget: lead", () => {
    expect(applyAction(queuedLead(), { type: "claim" }, lead())).toEqual({
      status: "in_progress",
      assigneeId: "l1",
    });
    expect(applyAction(queuedLead(), { type: "assignTarget", target: usr("d2") }, lead())).toMatchObject({
      status: "assigned",
      targetUserId: "d2",
    });
  });
  test("transfer: assigned/queued/in_progress, 담당자를 비운다", () => {
    expect(
      applyAction(assignedTo("d1"), { type: "transfer", target: usr("d2"), reason: "내 일 아님" }, dev("d1")),
    ).toMatchObject({ status: "assigned", targetUserId: "d2", assigneeId: null });
    expect(
      applyAction(queuedGroup("g1"), { type: "transfer", target: null, reason: "범위 밖" }, dev("d1", ["g1"])),
    ).toMatchObject({ status: "queued", targetGroupId: null, targetUserId: null, assigneeId: null });
    expect(
      applyAction(inProgress("d1"), { type: "transfer", target: usr("d2"), reason: "인수인계" }, lead()),
    ).toMatchObject({ status: "assigned", targetUserId: "d2", assigneeId: null });
  });
  test("hold / resume / resolve", () => {
    expect(applyAction(inProgress("d1"), { type: "hold", reason: "대기" }, dev("d1"))).toEqual({
      status: "on_hold",
    });
    expect(applyAction(onHold("d1"), { type: "resume" }, dev("d1"))).toEqual({ status: "in_progress" });
    expect(applyAction(inProgress("d1"), { type: "resolve", linkedRefs: ["abc123"] }, dev("d1"))).toEqual({
      status: "resolved",
    });
  });
  test("resolved: confirmFixed → closed(resolved_confirmed) / reopen → in_progress", () => {
    expect(applyAction(resolved(), { type: "confirmFixed" }, author())).toMatchObject({
      status: "closed",
      closeReason: "resolved_confirmed",
    });
    expect(applyAction(resolved(), { type: "reopen", reason: "여전히 재현" }, author())).toEqual({
      status: "in_progress",
    });
  });
  test("close: 사유별 허용 주체", () => {
    expect(
      applyAction(inProgress("d1"), { type: "close", reason: "resolved_confirmed" }, author()),
    ).toMatchObject({ status: "closed", closeReason: "resolved_confirmed" });
    expect(applyAction(queuedLead(), { type: "close", reason: "wont_do" }, lead())).toMatchObject({
      status: "closed",
      closeReason: "wont_do",
    });
    expect(
      applyAction(inProgress("d1"), { type: "close", reason: "duplicate", duplicateOfId: "t9" }, dev("d1")),
    ).toMatchObject({ status: "closed", closeReason: "duplicate", duplicateOfId: "t9" });
    expect(
      applyAction(onHold("d1"), { type: "close", reason: "requester_withdrawn" }, author()),
    ).toMatchObject({ status: "closed", closeReason: "requester_withdrawn" });
    expect(
      applyAction(resolved(), { type: "close", reason: "other", note: " 사정 " }, lead()),
    ).toMatchObject({ status: "closed", closeReason: "other", closeNote: "사정" });
  });
  test("closed → reopenClosed: 이전 담당자 있으면 assigned, 없으면 리드 큐", () => {
    const closed = t({ status: "closed", closeReason: undefined } as Partial<TicketShape>);
    expect(
      applyAction({ ...closed, lastAssigneeId: "d1" }, { type: "reopenClosed" }, lead()),
    ).toMatchObject({ status: "assigned", targetUserId: "d1", assigneeId: null });
    expect(applyAction(closed, { type: "reopenClosed" }, lead())).toMatchObject({
      status: "queued",
      targetUserId: null,
      targetGroupId: null,
    });
  });
});

describe("거부와 검증", () => {
  test("개발자가 wont_do 종결 → forbidden", () =>
    expect(() =>
      applyAction(inProgress("d1"), { type: "close", reason: "wont_do" }, dev("d1")),
    ).toThrow(/forbidden/));
  test("transfer는 사유 필수, 담당자를 비운다", () => {
    expect(() =>
      applyAction(inProgress("d1"), { type: "transfer", target: grp("g2"), reason: "" }, dev("d1")),
    ).toThrow(/reason_required/);
    expect(
      applyAction(inProgress("d1"), { type: "transfer", target: grp("g2"), reason: "서버 건" }, dev("d1")),
    ).toMatchObject({ status: "queued", targetGroupId: "g2", assigneeId: null });
  });
  test("그룹원이 아니면 그룹 큐 claim 불가", () =>
    expect(() => applyAction(queuedGroup("g1"), { type: "claim" }, dev("d9", []))).toThrow(/forbidden/));
  test("resolved에서 시스템은 아무것도 못 한다(자동 종결 없음)", () =>
    expect(availableActions(resolved(), system())).toEqual([]));
  test("AI 검토 중에도 작성자는 제출할 수 있다", () =>
    expect(applyAction(aiReviewing(), { type: "submit", target: null }, author())).toMatchObject({
      status: "queued",
    }));
  test("availableActions: 대상 개발자 + assigned", () =>
    expect(availableActions(assignedTo("d1"), dev("d1")).sort()).toEqual(["accept", "close", "transfer"]));

  test("상태가 맞지 않으면 invalid_transition", () => {
    expect(() => applyAction(resolved(), { type: "accept" }, dev("d1"))).toThrow(/invalid_transition/);
    expect(() => applyAction(t({ status: "closed" }), { type: "close", reason: "other", note: "x" }, lead())).toThrow(
      /invalid_transition/,
    );
    expect(() => applyAction(queuedGroup("g1"), { type: "assignTarget", target: null }, lead())).toThrow(
      /invalid_transition/,
    );
  });
  test("TransitionError는 code를 가진다", () => {
    try {
      applyAction(inProgress("d1"), { type: "close", reason: "wont_do" }, dev("d1"));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      expect((e as TransitionError).code).toBe("forbidden");
    }
  });
  test("close: duplicate는 duplicateOfId, other는 note 필수(공백은 없는 것)", () => {
    expect(() => applyAction(inProgress("d1"), { type: "close", reason: "duplicate" }, dev("d1"))).toThrow(
      /reason_required/,
    );
    expect(() =>
      applyAction(inProgress("d1"), { type: "close", reason: "duplicate", duplicateOfId: "  " }, dev("d1")),
    ).toThrow(/reason_required/);
    expect(() => applyAction(queuedLead(), { type: "close", reason: "other", note: "   " }, lead())).toThrow(
      /reason_required/,
    );
  });
  test("hold/reopen도 사유 필수", () => {
    expect(() => applyAction(inProgress("d1"), { type: "hold", reason: " " }, dev("d1"))).toThrow(/reason_required/);
    expect(() => applyAction(resolved(), { type: "reopen", reason: "" }, author())).toThrow(/reason_required/);
  });
  test("AI(system)는 stageReady/stageFailed 외에는 할 수 없다", () => {
    expect(() => applyAction(aiReviewing(), { type: "submit", target: null }, system())).toThrow(/forbidden/);
    expect(() => applyAction(queuedLead(), { type: "claim" }, system())).toThrow(/forbidden/);
    expect(availableActions(aiReviewing(), system()).sort()).toEqual(["stageFailed", "stageReady"]);
  });
  test("stageReady는 system만", () =>
    expect(() => applyAction(aiReviewing(), { type: "stageReady" }, author())).toThrow(/forbidden/));
  test("다른 개발자는 남의 in_progress를 hold/resolve/transfer 못 한다", () => {
    expect(() => applyAction(inProgress("d1"), { type: "hold", reason: "x" }, dev("d2"))).toThrow(/forbidden/);
    expect(() => applyAction(inProgress("d1"), { type: "resolve" }, dev("d2"))).toThrow(/forbidden/);
    expect(() =>
      applyAction(inProgress("d1"), { type: "transfer", target: null, reason: "x" }, dev("d2")),
    ).toThrow(/forbidden/);
  });
  test("assigned 대상자는 duplicate·resolved_confirmed로만 종결(R1), wont_do는 불가", () => {
    expect(
      applyAction(assignedTo("d1"), { type: "close", reason: "resolved_confirmed" }, dev("d1")),
    ).toMatchObject({ closeReason: "resolved_confirmed" });
    expect(() => applyAction(assignedTo("d1"), { type: "close", reason: "wont_do" }, dev("d1"))).toThrow(
      /forbidden/,
    );
    // in_progress가 아닌 assigned에서 hold/resolve는 불가
    expect(() => applyAction(assignedTo("d1"), { type: "resolve" }, dev("d1"))).toThrow(/invalid_transition/);
  });
  test("availableActions: lead 큐/그룹 큐/작성자", () => {
    expect(availableActions(queuedLead(), lead()).sort()).toEqual(["assignTarget", "claim", "close", "transfer"]);
    expect(availableActions(queuedGroup("g1"), dev("d1", ["g1"])).sort()).toEqual(["claim", "transfer"]);
    expect(availableActions(queuedGroup("g1"), dev("d1", [])).sort()).toEqual([]);
    expect(availableActions(resolved(), author()).sort()).toEqual(["close", "confirmFixed", "reopen"]);
    expect(availableActions(t({ status: "draft" }), author()).sort()).toEqual(["requestReview", "submit"]);
  });
});
