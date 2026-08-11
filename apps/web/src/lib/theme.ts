export type Theme = "light" | "dark";

export function initialTheme(
  storage: Pick<Storage, "getItem">,
  prefersDark: boolean,
): Theme {
  const saved = storage.getItem("cadence-theme");
  if (saved === "light" || saved === "dark") return saved;
  return prefersDark ? "dark" : "light";
}

export function applyTheme(
  theme: Theme,
  root: HTMLElement,
  storage: Pick<Storage, "setItem">,
): void {
  root.dataset.theme = theme;
  storage.setItem("cadence-theme", theme);
}
