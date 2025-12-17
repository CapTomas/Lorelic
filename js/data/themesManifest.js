/**
 * @file Defines the THEMES_MANIFEST, a canonical list of all available themes.
 * This manifest is used by the theme service to locate and load theme-specific assets
 * like configurations, prompts, and UI text data.
 *
 * @property {string} id - The unique identifier for the theme.
 * @property {string} path - The relative path from the project root to the theme's directory.
 * @property {boolean} playable - Indicates if the theme is a selectable scenario for gameplay.
 *                                `false` is used for internal/resource themes like 'master'.
 * @property {boolean} [lockedForAnonymous=false] - If true, the theme is locked for non-logged-in users.
 */
export const THEMES_MANIFEST = [
  {
    id: 'grim_warden',
    path: 'themes/grim_warden/',
    playable: true,
  },
  {
    id: 'salt_reavers',
    path: 'themes/salt_reavers/',
    playable: true,
  },
  {
    id: 'celestial_custodians',
    path: 'themes/celestial_custodians/',
    playable: true,
    lockedForAnonymous: true,
  },
  {
    id: 'master',
    path: 'themes/master/',
    playable: false,
  },
  {
    id: 'echo_sleuths',
    path: 'themes/echo_sleuths/',
    playable: true,
    lockedForAnonymous: true,
  },
];
