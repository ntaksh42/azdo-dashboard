import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  deletePullRequestComment,
  editPullRequestComment,
  postPullRequestComment,
  prLocator,
  setPullRequestThreadStatus,
  type PrThread,
  type ReviewPullRequestSummary,
} from "@/lib/azdoCommands";
import type { CommentSide, DiffCommentDraft } from "./PrFilesTabTypes";

/**
 * Owns the comment/thread mutations for the PR Files tab: posting inline
 * comments, replying, resolving/reopening, editing, deleting. Extracted out of
 * PrFilesTab so that file stays focused on tree/scroll orchestration.
 */
export function usePrFileComments(pr: ReviewPullRequestSummary) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<DiffCommentDraft | null>(null);

  // Reset draft/error state when switching PRs.
  useEffect(() => {
    setActionError(null);
    setCommentDraft(null);
  }, [pr.organizationId, pr.repositoryId, pr.pullRequestId]);

  function invalidateReview() {
    void queryClient.invalidateQueries({
      queryKey: ["prReview", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    });
    // Commenting/resolving from the diff changes the same grid columns as the
    // Conversation tab, so refresh My Reviews here too (usePrReviewActions
    // already does this for the equivalent actions).
    void queryClient.invalidateQueries({ queryKey: ["myReviews", pr.organizationId] });
  }

  const commentMutation = useMutation({
    mutationFn: postPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      setCommentDraft(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const editMutation = useMutation({
    mutationFn: editPullRequestComment,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePullRequestComment,
    onSuccess: () => {
      setActionError(null);
      invalidateReview();
    },
    onError: (mutationError) => setActionError(commandErrorMessage(mutationError)),
  });

  const mutationsBusy =
    commentMutation.isPending ||
    statusMutation.isPending ||
    editMutation.isPending ||
    deleteMutation.isPending;

  // useCallback so it stays referentially stable across renders: it is passed
  // down through every PrFileDiffSection, which is memoized specifically so
  // opening a comment box on one file doesn't rebuild every other file's diff.
  const startComment = useCallback((path: string, side: CommentSide, line: number) => {
    setActionError(null);
    setCommentDraft({ path, side, line });
  }, []);

  const cancelComment = useCallback(() => {
    setCommentDraft(null);
  }, []);

  // TanStack Query keeps `mutate`/`mutateAsync` referentially stable across
  // renders even though the mutation object wrapping them is not, so depending
  // on those methods (rather than `commentMutation` etc.) keeps these callbacks
  // stable too. That matters here: they are passed down through every
  // PrFileDiffSection, which is memoized specifically so unrelated state
  // changes don't rebuild every file's diff.
  const { mutateAsync: mutateComment } = commentMutation;
  const { mutate: mutateStatus } = statusMutation;
  const { mutateAsync: mutateEdit } = editMutation;
  const { mutateAsync: mutateDelete } = deleteMutation;

  const postInlineComment = useCallback(
    (content: string): Promise<void> => {
      if (!commentDraft) return Promise.resolve();
      return mutateComment({
        ...prLocator(pr),
        content,
        filePath: commentDraft.path,
        ...(commentDraft.side === "left"
          ? { leftLine: commentDraft.line }
          : { rightLine: commentDraft.line }),
      }).then(() => undefined);
    },
    [commentDraft, mutateComment, pr],
  );

  const replyToThread = useCallback(
    (thread: PrThread, content: string): Promise<void> =>
      mutateComment({ ...prLocator(pr), threadId: thread.id, content }).then(() => undefined),
    [mutateComment, pr],
  );

  const toggleThreadStatus = useCallback(
    (thread: PrThread) => {
      mutateStatus({
        ...prLocator(pr),
        threadId: thread.id,
        status: thread.isResolved ? "active" : "closed",
      });
    },
    [mutateStatus, pr],
  );

  const editComment = useCallback(
    (thread: PrThread, commentId: number, content: string): Promise<void> =>
      mutateEdit({ ...prLocator(pr), threadId: thread.id, commentId, content }).then(
        () => undefined,
      ),
    [mutateEdit, pr],
  );

  const deleteComment = useCallback(
    (thread: PrThread, commentId: number): Promise<void> =>
      mutateDelete({ ...prLocator(pr), threadId: thread.id, commentId }),
    [mutateDelete, pr],
  );

  return {
    actionError,
    setActionError,
    commentDraft,
    mutationsBusy,
    commentMutation,
    startComment,
    cancelComment,
    postInlineComment,
    replyToThread,
    toggleThreadStatus,
    editComment,
    deleteComment,
  };
}
