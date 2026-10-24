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
  const mode = required<HTMLInputElement>('[name="authors"]', form);
  const period = required<HTMLSelectElement>('[name="period"]', form);
  const selectAll = form.querySelector<HTMLInputElement>("[data-select-all]");
  const authorPicker = form.querySelector<HTMLDetailsElement>("[data-author-picker]");
  let availableAuthorBoxes = authorBoxes;
  const pickers = [...form.querySelectorAll<HTMLDetailsElement>(".filter-multiselect")];
  const actions = required<HTMLElement>(".filter-actions", form);
  const options = { authors: authorBoxes.map((box) => box.value), sources: sourceBoxes.map((box) => box.value) };
  const cards = [...document.querySelectorAll<HTMLElement>("[data-article]")].map((element): FilterArticle & { element: HTMLElement } => ({
    element, date: element.dataset.date ?? "", defaultAuthor: element.dataset.defaultAuthor === "true",
    authors: stringArray(element.dataset.authors), sources: stringArray(element.dataset.sources),
  }));
  const error = required<HTMLElement>("[data-filter-error]");
  const showError = (problem: unknown) => {
    error.textContent = `${problem instanceof Error ? problem.message : "Cannot apply filters."} Clear filters to restore the default view.`;
    error.hidden = false;
    actions.hidden = false;
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
    const availableAuthors = new Set<string>();
    for (const card of cards) {
      if (card.sources.some((source) => state.sources.includes(source))) {
        for (const author of card.authors) availableAuthors.add(author);
      }
      card.element.hidden = !matches(card, state);
      if (!card.element.hidden) visible += 1;
      const link = required<HTMLAnchorElement>("h2 a", card.element);
      const url = new URL(link.href);
      url.search = new URLSearchParams({ return: returnPath }).toString();
      link.href = url.href;
    }
    required<HTMLElement>("[data-filter-count]").textContent = !query && visible === cards.length
      ? `${visible} ${visible === 1 ? "publication" : "publications"}` : `${visible} of ${cards.length} publications`;
    required<HTMLElement>("[data-filter-empty]").hidden = visible !== 0;
    if (selectAll && authorPicker) {
      availableAuthorBoxes = authorBoxes.filter((box) => availableAuthors.has(box.value));
      for (const box of authorBoxes) {
        const label = box.closest("label");
        if (!label) throw new Error("Missing author checkbox label");
        label.hidden = !availableAuthors.has(box.value);
      }
      authorPicker.hidden = availableAuthorBoxes.length === 0;
      if (authorPicker.hidden) authorPicker.open = false;
      const selected = availableAuthorBoxes.filter((box) => box.checked);
      selectAll.checked = selected.length > 0 && selected.length === availableAuthorBoxes.length;
      selectAll.indeterminate = selected.length > 0 && !selectAll.checked;
      required<HTMLElement>("[data-author-summary]").textContent = selectAll.checked ? "All tracked authors"
        : selected.length === 0 ? "No tracked authors" : selected.length === 1 ? selected[0].dataset.label! : `${selected.length} selected`;
    }
    const sources = sourceBoxes.filter((box) => box.checked);
    required<HTMLElement>("[data-source-summary]").textContent = sources.length === 1 ? sources[0].dataset.label! : `${sources.length} selected`;
    actions.hidden = !query;
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
      sync(state);
      display(state, true);
    } catch (problem) { showError(problem); }
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); apply(); });
  form.addEventListener("change", (event) => {
    const target = event.target;
    if (target === selectAll && selectAll) {
      for (const box of authorBoxes) box.checked = selectAll.checked;
      mode.value = selectAll.checked ? "all" : "custom";
    } else if (target instanceof HTMLInputElement && target.name === "author") {
      mode.value = availableAuthorBoxes.every((box) => box.checked) ? "all" : "custom";
    } else if (target instanceof HTMLInputElement && target.name === "source" && !sourceBoxes.some((box) => box.checked)) {
      target.checked = true;
      showError(new Error("Select at least one paper source."));
      return;
    }
    apply();
  });
  form.addEventListener("reset", (event) => {
    event.preventDefault();
    for (const picker of pickers) picker.open = false;
    const state = readState(new URLSearchParams(), options); sync(state); display(state, true);
  });
  const closeOutside = (event: Event) => {
    if (!(event.target instanceof Node)) return;
    for (const picker of pickers) if (picker.open && !picker.contains(event.target)) picker.open = false;
  };
  document.addEventListener("click", closeOutside);
  document.addEventListener("focusin", closeOutside);
  for (const picker of pickers) picker.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && picker.open) {
      event.preventDefault();
      picker.open = false;
      required<HTMLElement>("summary", picker).focus();
    }
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
  if (target) {
    try {
      const pathname = new URL(target, location.origin).pathname;
      const context = [...document.querySelectorAll<HTMLElement>("[data-article-feed]")].find((element) =>
        pathname === main.dataset.staticRoot ? element.dataset.defaultFeed === "true"
          : pathname === `${main.dataset.staticRoot}feeds/${element.dataset.articleFeed}/`);
      if (context) {
        const matched = stringArray(context.dataset.feedMatches);
        back.href = target;
        for (const author of document.querySelectorAll<HTMLElement>("[data-author-key]")) {
          const highlighted = matched.includes(author.dataset.authorKey!);
          const replacement = document.createElement(highlighted ? "strong" : "span");
          replacement.dataset.authorKey = author.dataset.authorKey;
          replacement.textContent = author.textContent;
          if (highlighted) replacement.className = "notable-author";
          author.replaceWith(replacement);
        }
        required<HTMLElement>(".author-note").hidden = matched.length === 0;
        const rss = `${main.dataset.staticRoot}feeds/${context.dataset.articleFeed}/feed.xml`;
        required<HTMLAnchorElement>("[data-feed-rss]").href = rss;
        const alternate = required<HTMLLinkElement>('link[rel="alternate"]');
        alternate.href = rss;
        alternate.title = context.dataset.feedTitle!;
        document.title = `${required<HTMLElement>("h1").textContent} · ${context.dataset.feedTitle}`;
      }
    } catch (problem) {
      const error = required<HTMLElement>("[data-navigation-error]");
      error.textContent = "The originating feed could not be restored. The article and its default feed remain available.";
      error.hidden = false;
      console.error(problem);
    }
  }
}
const form = document.querySelector<HTMLFormElement>("[data-static-filters]");
if (form) {
  try { initialize(form); } catch (problem) {
    const error = document.querySelector<HTMLElement>("[data-filter-error]");
    if (error) { error.textContent = "Interactive filters could not load. The default listing is still available."; error.hidden = false; }
    console.error(problem);
  }
}
