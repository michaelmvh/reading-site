import { matches, readState, safeReturn, writeState, type FilterArticle, type FilterState } from "./model.js";

function required<T extends Element>(selector: string, scope: ParentNode = document): T {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`Missing reader element: ${selector}`);
  return element;
}

function stringArray(value: string | undefined): string[] {
  const parsed: unknown = JSON.parse(value ?? "");
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("Invalid reader filter metadata");
  return parsed;
}

function initialize(form: HTMLFormElement): void {
  const authorBoxes = [...form.querySelectorAll<HTMLInputElement>('[name="author"]')];
  const sourceBoxes = [...form.querySelectorAll<HTMLInputElement>('[name="source"]')];
  const mode = required<HTMLSelectElement>('[name="authors"]', form);
  const period = required<HTMLSelectElement>('[name="period"]', form);
  const options = { authors: authorBoxes.map((box) => box.value), sources: sourceBoxes.map((box) => box.value) };
  const cards = [...document.querySelectorAll<HTMLElement>("[data-article]")].map((element): FilterArticle & { element: HTMLElement } => ({
    element, date: element.dataset.date ?? "", defaultAuthor: element.dataset.defaultAuthor === "true",
    authors: stringArray(element.dataset.authors), sources: stringArray(element.dataset.sources),
  }));
  const error = required<HTMLElement>("[data-filter-error]");
  const showError = (problem: unknown) => {
    error.textContent = `${problem instanceof Error ? problem.message : "Cannot apply filters."} Clear filters to restore the default view.`;
    error.hidden = false;
  };
  const sync = (state: FilterState) => {
    mode.value = state.mode;
    period.value = state.period;
    for (const box of authorBoxes) box.checked = state.mode === "all" || (state.mode === "default" ? box.dataset.default === "true" : state.authors.includes(box.value));
    for (const box of sourceBoxes) box.checked = state.sources.includes(box.value);
  };
  const display = (state: FilterState, push: boolean) => {
    const query = writeState(state, options).toString();
    const returnPath = `${location.pathname}${query ? `?${query}` : ""}`;
    if (push && returnPath !== `${location.pathname}${location.search}`) history.pushState(null, "", returnPath);
    let visible = 0;
    for (const card of cards) {
      card.element.hidden = !matches(card, state);
      if (!card.element.hidden) visible += 1;
      const link = required<HTMLAnchorElement>("h2 a", card.element);
      const url = new URL(link.href);
      url.search = new URLSearchParams({ return: returnPath }).toString();
      link.href = url.href;
    }
    required<HTMLElement>("[data-filter-count]").textContent = `${visible} of ${cards.length} publications`;
    required<HTMLElement>("[data-filter-empty]").hidden = visible !== 0;
    required<HTMLElement>("[data-author-summary]").textContent = state.mode === "default" ? "Configured defaults" : state.mode === "all" ? "All tracked authors" : `${state.authors.length} selected`;
    required<HTMLElement>("[data-source-summary]").textContent = `${state.sources.length} selected`;
    error.hidden = true;
  };
  const restore = () => {
    try { const state = readState(new URLSearchParams(location.search), options); sync(state); display(state, false); }
    catch (problem) { showError(problem); }
  };
  const apply = () => {
    try {
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form)) {
        if (typeof value !== "string") throw new Error("Unexpected file in filter controls.");
        params.append(key, value);
      }
      const state = readState(params, options);
      const selected = sourceBoxes.filter((box) => box.checked);
      if (sourceBoxes.length && !selected.length) throw new Error("Select at least one paper source.");
      display(state, true);
    } catch (problem) { showError(problem); }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); apply(); });
  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "author") mode.value = authorBoxes.every((box) => box.checked) ? "all" : "custom";
    if (event.target === mode && mode.value !== "custom") {
      for (const box of authorBoxes) box.checked = mode.value === "all" || box.dataset.default === "true";
    }
    apply();
  });
  form.addEventListener("reset", (event) => {
    event.preventDefault(); const state = readState(new URLSearchParams(), options); sync(state); display(state, true);
  });
  window.addEventListener("popstate", restore);
  form.hidden = false;
  required<HTMLElement>("[data-filter-notice]").hidden = true;
  restore();
}

const main = document.querySelector<HTMLElement>("[data-static-root]");
const back = document.querySelector<HTMLAnchorElement>("a.back");
if (main?.dataset.staticRoot && back) {
  const target = safeReturn(new URLSearchParams(location.search).get("return"), main.dataset.staticRoot, location.origin);
  if (target) back.href = target;
}
const form = document.querySelector<HTMLFormElement>("[data-static-filters]");
if (form) {
  try { initialize(form); } catch (problem) {
    const error = document.querySelector<HTMLElement>("[data-filter-error]");
    if (error) { error.textContent = "Interactive filters could not load. The default listing is still available."; error.hidden = false; }
    console.error(problem);
  }
}
