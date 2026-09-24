/** John Lau — assistant contracts, schema `asst`.
 *
 *  Named after the system this one replaces, which is the joke and also the
 *  point: the old spreadsheet-and-chat arrangement knew where everything was
 *  and could not compute anything. This one computes, and is not allowed to
 *  know everything.
 *
 *  ## What it is, and what it is not
 *
 *  It is **not** a narrator. Explaining the system is what documentation does,
 *  and a chatbot that paraphrases a screen is a second source of truth that
 *  drifts from the first by Friday. What it does is turn a sentence into
 *  **named actions against the same API every screen uses** — read something,
 *  compute something, show the steps for doing something, or draft a write for
 *  a person to confirm.
 *
 *  ## The rule that shapes everything here
 *
 *  **John Lau never composes a figure.** It runs a named tool and shows what
 *  the tool returned, with the tool's name attached, so any number it says can
 *  be found on a screen and checked (D217). It does not summarise, round,
 *  average or infer. If no tool answers the question, the answer is *I do not
 *  know*, which is a real answer and the only honest one.
 *
 *  ## Three gates, not one
 *
 *  1. **The tool must be reachable from a prompt at all.** Berkas 201 and the
 *     whole of IT are not, ever, at any permission level (owner, D218).
 *  2. **The person's own grants still apply.** Every tool call runs as the
 *     user through the same `requireModule` the screens use. An assistant that
 *     acts with more rights than the person typing is a privilege escalation
 *     with a friendly face (D219).
 *  3. **Nothing is written without a second yes**, on the exact payload, not a
 *     summary of it (D220).
 */

/** What a tool does to the world. */
export type ToolEffect =
  /** Reads data and returns figures. */
  | "read"
  /** Returns steps and a place to do them. Touches nothing. */
  | "guide"
  /** Drafts a write. Never executes on its own. */
  | "write";

/** Why a tool is or is not reachable from the prompt.
 *
 *  `blocked` is **not** a permission level — it is a property of the tool, and
 *  no grant lifts it. That distinction is the whole of D218: a rule that can be
 *  granted away is a default, and the owner's answer was not a default.
 */
export type ToolReach = "open" | "blocked";

export interface AssistantTool {
  /** `procurement.pending_approvals`, `guide.create_po`. */
  name: string;
  /** Which module's grant the caller must hold. Null for guidance, which
   *  explains a screen the person may not be able to open — and says so. */
  module: string | null;
  /** The level that grant must reach. */
  level: "read" | "write";
  effect: ToolEffect;
  reach: ToolReach;
  /** One line, in the words a person would use to ask for it. */
  label: string;
  /** Why it is blocked, when it is. Shown verbatim when somebody asks for it,
   *  because a refusal that explains itself is worth more than a silent gap. */
  blocked_reason: string | null;
  /** Where a person may do this instead, when the prompt may not. */
  instead_at: string | null;
}

/** One figure John Lau said, and where it came from.
 *
 *  Every number in an answer carries this. It is what makes the answer
 *  checkable rather than merely confident (D217).
 */
export interface AnswerFact {
  label: string;
  /** Anything that is not a number: a status, a count with its unit, a date.
   *
   *  **A figure does not go here.** `amount` carries figures, because the
   *  separators in `Rp 6.000.000` follow a locale the person chooses
   *  (`formatIDR`), and a number formatted anywhere but there is a number that
   *  disagrees with the screen it is supposed to be checkable against (D217). */
  value: string | null;
  /** The figure itself, unformatted, when there is one. Rendered with the same
   *  helper the screens use, so John Lau's number and the screen's number are
   *  the same string of characters and can be compared by eye. */
  amount?: number | null;
  /** What `amount` is counted in. `IDR` today; a unit here rather than a
   *  formatted string means the next one does not need a second rule. */
  unit?: "IDR" | null;
  /** The tool that produced it. */
  source: string;
  /** The screen showing the same number. */
  href: string | null;
}

/** A step in a piece of guidance. */
export interface GuideStep {
  text: string;
  /** The screen this step happens on, when it happens on one. */
  href: string | null;
  /** The rule behind the step, where there is one worth stating. */
  rule: string | null;
}

/** A write John Lau has prepared and will not perform.
 *
 *  The payload is carried whole and rendered whole. A confirmation that shows
 *  a summary is a confirmation of the summary (D220).
 */
export interface AssistantDraft {
  id: string;
  tool: string;
  /** What it will do, in one line. */
  headline: string;
  /** Field by field, exactly what will be written.
   *
   *  `key` is what the confirmation is keyed by, and `label` is what the person
   *  reads. They were one thing — the label — and that made the payload depend
   *  on the language in force: somebody who drafted in Indonesian and switched
   *  to English before pressing yes confirmed a form whose every field had
   *  become empty, silently, because `fields["Barang"]` no longer existed.
   *
   *  A display string is never a key. */
  fields: { key: string; label: string; value: string }[];
  /** Things a person should notice before saying yes — a price above the last
   *  one paid, a vendor with no history. Never blocking. */
  warnings: string[];
  /** The arguments, kept for the confirm call. */
  args: Record<string, unknown>;
  /** So a double tap is one purchase order (A4). */
  idempotency_key: string;
  created_at: string;
}

export type TurnKind =
  | "answer"
  | "guide"
  | "draft"
  | "refused"
  | "unknown";

/** One exchange. Stored, because *what did John Lau tell me on Tuesday* is a
 *  question somebody asks after acting on the answer. */
export interface AssistantTurn {
  id: string;
  at: string;
  actor_id: string;
  actor_email: string;
  /** What the person typed, verbatim. */
  prompt: string;
  kind: TurnKind;
  /** The prose part of the reply. Never contains a figure — figures live in
   *  `facts`, so they cannot be paraphrased into something slightly different
   *  (D217). */
  text: string;
  facts: AnswerFact[];
  steps: GuideStep[];
  /** The tools it actually ran, in order. Shown, always. */
  tools_used: string[];
  /** Present when the reply is a draft awaiting confirmation. */
  draft: AssistantDraft | null;
  /** Which kind of refusal, when it is one.
   *
   *  `closed` — the capability is not reachable from a prompt by anybody.
   *  `permission` — it is reachable, and **this person** may not.
   *
   *  Rendering both the same way was the first version's mistake (F64): the
   *  second is fixed by asking IT for a grant, the first never is, and a
   *  header reading *tidak lewat prompt* over a permission problem sends
   *  somebody to argue with the wrong person. */
  refused_because: "closed" | "permission" | null;
  /** Set once the draft was confirmed or abandoned. */
  draft_outcome: "confirmed" | "abandoned" | null;
  /** The document the confirmation produced. */
  produced_ref: string | null;
  /** Where the person can go on reading while they work. */
  route: string | null;
}

/** Where the person is when they ask. Sent so *what do I do next?* can be
 *  answered about the screen they are on, not the one they asked from last
 *  time. Optional — the keyword router does not need it. */
export interface AskContext {
  pathname?: string;
}

export interface AssistantReply {
  turn: AssistantTurn;
  /** What it understood, in its own words, so a wrong reading is visible
   *  before it matters. */
  understood_as: string;
}

/** One question the router did not understand, grouped the way the router
 *  itself compares questions.
 *
 *  **There is nothing here about who asked.** The question this answers is
 *  *what did we fail to understand*; a name turns it into a different question,
 *  and `it.audit` is blocked from the prompt precisely so that one stays hard
 *  to ask (D218, D190).
 */
export interface UnmatchedPrompt {
  /** Lowercased, depunctuated, `-nya` dropped — what the matcher actually
   *  compares against. Two sentences that share this are one question to the
   *  router, which is the whole reason the list is grouped by it. */
  normalised: string;
  /** The most recent one as somebody typed it. The normalised form is what the
   *  router sees; this is what a person reads when deciding whether a rule
   *  would have helped. */
  example: string;
  times: number;
  langs: ("en" | "id")[];
  first_at: string;
  last_at: string;
}

/** Whether the keyword router is doing its job, in counts and nothing else.
 *
 *  *Should a model go behind this* is not answerable from the unmatched list
 *  alone (D221). A hundred unmatched beside four hundred answered is a router
 *  doing its job on the questions people repeat; a hundred beside a hundred and
 *  ten is one that mostly fails.
 */
export interface RouterHealth {
  turns: number;
  answered: number;
  guided: number;
  drafted: number;
  unknown: number;
  /** The boundary holding: somebody asked for something no grant reaches. */
  refused_closed: number;
  /** Somebody who needs a grant they have not got — an IT job, not a router
   *  one. Kept apart from the above for the reason they always are (F64). */
  refused_permission: number;
  since: string | null;
}

/** One rule in the keyword router, read-only.
 *
 *  Shown beside the unmatched list because you cannot decide what to add
 *  without seeing what is there. Not editable from a screen: the rules are
 *  rows in a migration, reviewed, with the reason next to them.
 */
export interface RouterRule {
  seq: number;
  tool: string;
  stage: "how" | "main";
  all_words: string[];
  any_words: string[];
  not_words: string[];
  understood: string;
  note: string | null;
}
