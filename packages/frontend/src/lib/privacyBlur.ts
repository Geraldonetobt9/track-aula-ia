const BLURRED = 'blur-md select-none transition-[filter] duration-200 ease-out';
const SHARP = 'transition-[filter] duration-200 ease-out';

/**
 * Class list that hides a value behind a blur when privacy mode is on.
 *
 * The transition is applied in both states so toggling animates instead of
 * snapping. Blurring is a display concern only — the value stays in the DOM,
 * which is fine for the "someone is looking over my shoulder" case this
 * serves. It is not a way to withhold data from the user.
 */
export function privacyBlurClass(isHidden: boolean | undefined): string {
  return isHidden ? BLURRED : SHARP;
}
