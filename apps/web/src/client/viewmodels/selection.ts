/**
 * Which panel a selection came from. The screen uses it to decide what to
 * bring into view: the panel the user is working in already shows what they
 * picked, so only the others scroll or refit.
 */
export type SelectionSource = 'source' | 'map' | 'findings' | 'inspector';
