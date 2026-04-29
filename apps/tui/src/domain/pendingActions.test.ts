import { describe, expect, it } from "vitest";
import {
  buildUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "./pendingActions.js";

describe("TUI pending action derivation", () => {
  it("removes approvals after stale pending request failures", () => {
    const pending = derivePendingApprovals([
      approvalActivity("approval.requested", 1, "request-a", {
        requestKind: "command",
        detail: "run command",
      }),
      approvalActivity("provider.approval.respond.failed", 2, "request-a", {
        detail: "Unknown pending approval request: request-a",
      }),
    ] as never);

    expect(pending).toEqual([]);
  });

  it("removes user inputs after stale pending request failures", () => {
    const pending = derivePendingUserInputs([
      userInputActivity("user-input.requested", 1, "request-a", {
        questions: [
          {
            id: "choice",
            header: "Pick",
            question: "Which option?",
            options: [{ label: "Yes", description: "Proceed" }],
          },
        ],
      }),
      userInputActivity("provider.user-input.respond.failed", 2, "request-a", {
        detail: "Stale pending user-input request: request-a",
      }),
    ] as never);

    expect(pending).toEqual([]);
  });

  it("builds answers only for explicitly displayed questions", () => {
    const pending = derivePendingUserInputs([
      userInputActivity("user-input.requested", 1, "request-a", {
        questions: [
          {
            id: "visible",
            header: "Visible",
            question: "Shown?",
            options: [{ label: "Yes", description: "Proceed" }],
          },
          {
            id: "hidden",
            header: "Hidden",
            question: "Not shown?",
            options: [{ label: "No", description: "Skip" }],
          },
        ],
      }),
    ] as never);

    expect(
      buildUserInputAnswers({
        pending: pending[0]!,
        selectedOptions: { visible: [0], hidden: [0] },
        customAnswer: "custom fallback",
        questionIds: new Set(["visible"]),
      }),
    ).toEqual({ visible: "Yes" });
  });

  it("builds multi-question answers together when the panel submits", () => {
    const pending = derivePendingUserInputs([
      userInputActivity("user-input.requested", 1, "request-a", {
        questions: [
          {
            id: "first",
            header: "First",
            question: "One?",
            options: [{ label: "Yes", description: "Proceed" }],
          },
          {
            id: "second",
            header: "Second",
            question: "Two?",
            options: [{ label: "No", description: "Skip" }],
          },
        ],
      }),
    ] as never);

    expect(
      buildUserInputAnswers({
        pending: pending[0]!,
        selectedOptions: { first: [0], second: [0] },
      }),
    ).toEqual({ first: "Yes", second: "No" });
  });

  it("keeps custom answers scoped to their question ids", () => {
    const pending = derivePendingUserInputs([
      userInputActivity("user-input.requested", 1, "request-a", {
        questions: [
          {
            id: "first",
            header: "First",
            question: "One?",
            options: [{ label: "Yes", description: "Proceed" }],
          },
          {
            id: "second",
            header: "Second",
            question: "Two?",
            options: [{ label: "No", description: "Skip" }],
          },
          {
            id: "third",
            header: "Third",
            question: "Three?",
            options: [{ label: "Maybe", description: "Defer" }],
          },
        ],
      }),
    ] as never);

    expect(
      buildUserInputAnswers({
        pending: pending[0]!,
        selectedOptions: { second: [0] },
        customAnswers: { first: "custom one", third: "custom three" },
      }),
    ).toEqual({ first: "custom one", second: "No", third: "custom three" });
  });
});

function approvalActivity(
  kind: string,
  sequence: number,
  requestId: string,
  payload: Record<string, unknown>,
) {
  return activity(kind, sequence, requestId, payload);
}

function userInputActivity(
  kind: string,
  sequence: number,
  requestId: string,
  payload: Record<string, unknown>,
) {
  return activity(kind, sequence, requestId, payload);
}

function activity(
  kind: string,
  sequence: number,
  requestId: string,
  payload: Record<string, unknown>,
) {
  return {
    id: `event-${sequence}`,
    tone: "info",
    kind,
    summary: kind,
    payload: { requestId, ...payload },
    turnId: null,
    sequence,
    createdAt: `2026-04-28T00:00:0${sequence}.000Z`,
  };
}
