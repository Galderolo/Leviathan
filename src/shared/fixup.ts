/** Why the staged changes cannot be added to a commit now. */
export type FixupRefusal = 'operation' | 'nothingStaged' | 'notAncestor' | 'merges' | 'pendingFixups'

/** Whether the staged changes can go into a commit: its subject, and how many of the commits rewritten are on a remote. */
export type FixupInfo = { ok: true; subject: string; published: number } | { ok: false; reason: FixupRefusal }

/** Subjects that git's autosquash melds into an earlier commit. */
const MELDED = /^(fixup|squash|amend)! /

/** Whether one of `subjects` is a commit autosquash would meld too (and a `squash!` would change a message). */
export function pendingFixup(subjects: string[]): boolean {
  return subjects.some((s) => MELDED.test(s))
}
