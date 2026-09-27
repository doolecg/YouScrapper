// Sets data-theme on <html>. "system" follows the OS setting and updates when it changes.
const media = window.matchMedia('(prefers-color-scheme: light)');
let stopListening = () => {};

export function applyTheme(theme) {
  stopListening();
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
    stopListening = () => {};
    return;
  }
  const update = () => (root.dataset.theme = media.matches ? 'light' : 'dark');
  update();
  media.addEventListener('change', update);
  stopListening = () => media.removeEventListener('change', update);
}
