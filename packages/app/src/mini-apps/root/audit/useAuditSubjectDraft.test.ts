import { expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useAuditSubjectDraft } from "./useAuditSubjectDraft";

const SUBJECT = "22222222-2222-4222-8222-222222222222";

test("a full or empty draft applies; a partial one only hints", () => {
  const onSubjectChange = mock((_subjectId: string | null) => undefined);
  const { result } = renderHook(() =>
    useAuditSubjectDraft(null, onSubjectChange),
  );

  act(() => result.current.updateDraft("2222"));
  expect(result.current.draftIsIncomplete).toBe(true);
  expect(onSubjectChange).not.toHaveBeenCalled();

  act(() => result.current.updateDraft(` ${SUBJECT.toUpperCase()} `));
  expect(result.current.draftIsIncomplete).toBe(false);
  expect(onSubjectChange).toHaveBeenLastCalledWith(SUBJECT);
});

test("a subject chosen elsewhere replaces the draft", () => {
  const { result, rerender } = renderHook(
    ({ subjectId }: { subjectId: string | null }) =>
      useAuditSubjectDraft(subjectId, () => undefined),
    { initialProps: { subjectId: SUBJECT as string | null } },
  );
  expect(result.current.draft).toBe(SUBJECT);

  rerender({ subjectId: null });
  expect(result.current.draft).toBe("");

  act(() => result.current.updateDraft("2222"));
  rerender({ subjectId: null });
  expect(result.current.draft).toBe("2222");
});
