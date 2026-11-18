// The shape of one setting group of an analysis, shared by the Configure settings window and the
// setup summaries: a title, its current values in one line, and what needs attention.

export interface GuidedSection {
  id: string;
  title: string;
  /** Current values, shown under the title. */
  summary?: string;
  optional?: boolean;
  /** Why the section needs attention (shown with a warning mark). */
  attention?: string;
}
