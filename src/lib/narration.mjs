/*
 * The elements a case study's narration reads, in reading order.
 *
 * One selector serves two readers that must never disagree. The narration
 * generator (scripts/audio/make-audio.mjs) scrapes these blocks from the built
 * HTML to write the script it synthesizes, and the read-along marker in
 * AudioNarration.astro finds the same blocks in the live page to mark the one
 * being spoken. The manifest's cue list holds one start time per block, so if
 * this selector changes without the audio being regenerated,
 * tests/a11y/read-along.spec.ts fails the build rather than letting the marker
 * drift a paragraph away from the voice.
 *
 * The heading, the standfirst, and the body paragraphs are read. The "back to
 * work" link and the at-a-glance facts list are not, because they read poorly
 * aloud.
 */
export const NARRATED_BLOCKS =
  '.page-intro h1, .standfirst, .case-body .container > p:not(.back-link)';
