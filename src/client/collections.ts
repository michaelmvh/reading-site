interface CollectionState { path: string; search: string; scrollY: number }

export function initializeCollections(navigation: HTMLElement): void {
  const links = [...navigation.querySelectorAll<HTMLAnchorElement>("a.collection-option")];
  const current = links.find((link) => link.getAttribute("aria-current") === "page");
  if (!current) throw new Error("Missing current collection");
  const currentPath = new URL(current.href).pathname;
  const paths = new Set(links.map((link) => new URL(link.href).pathname));
  const key = (path: string) => `reader:collection:${path}`;
  const pendingKey = `${key(currentPath)}:pending`;
  const read = (storageKey: string): CollectionState | null => {
    const raw = sessionStorage.getItem(storageKey);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string"
      || !paths.has(value.path) || !("search" in value) || typeof value.search !== "string"
      || (value.search !== "" && !value.search.startsWith("?")) || value.search.includes("#")
      || !("scrollY" in value) || typeof value.scrollY !== "number" || !Number.isFinite(value.scrollY) || value.scrollY < 0) {
      throw new Error("Invalid saved collection state");
    }
    return { path: value.path, search: value.search, scrollY: value.scrollY };
  };
  const report = (problem: unknown) => {
    console.error(problem);
    let notice = navigation.querySelector<HTMLElement>('[role="alert"]');
    if (!notice) {
      notice = document.createElement("p");
      notice.className = "reader-note";
      notice.setAttribute("role", "alert");
      navigation.append(notice);
    }
    notice.textContent = "Collection preferences could not be restored or saved. You can still switch collections.";
  };
  const save = () => sessionStorage.setItem(key(currentPath), JSON.stringify({
    path: currentPath, search: location.search, scrollY: window.scrollY,
  }));
  const refresh = () => {
    try {
      for (const link of links) {
        const path = new URL(link.href).pathname;
        const saved = read(key(path));
        link.href = path + (path === currentPath ? location.search : saved?.search ?? "");
      }
    } catch (problem) { report(problem); }
  };
  navigation.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>("a.collection-option");
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    try {
      save();
      const path = new URL(link.href).pathname;
      const saved = read(key(path));
      link.href = path + (saved?.search ?? "");
      if (saved) sessionStorage.setItem(`${key(path)}:pending`, JSON.stringify(saved));
    } catch (problem) { report(problem); }
  });
  window.addEventListener("pagehide", () => {
    try { save(); } catch (problem) { report(problem); }
  });
  window.addEventListener("pageshow", () => {
    refresh();
    try {
      const pending = read(pendingKey);
      sessionStorage.removeItem(pendingKey);
      if (pending?.path === currentPath && pending.search === location.search) {
        requestAnimationFrame(() => window.scrollTo({ top: pending.scrollY, behavior: "instant" }));
      }
    } catch (problem) { report(problem); }
  });
  window.addEventListener("popstate", refresh);
  refresh();
}
