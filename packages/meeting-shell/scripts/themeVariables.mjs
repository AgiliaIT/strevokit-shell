// The --svk-* theme variables are public API: the list in docs/theming.md must equal the variables the stylesheet
// declares (check:docs), and removing one from the documented list breaks tenants' overrides (check:release).

/** Variables listed in the documentation's variable table: table rows that start with a backticked `--svk-*` name. */
export function documentedVariables(markdown) {
  return [...markdown.matchAll(/^\|\s*`(--svk-[\w-]+)`/gm)].map((match) => match[1]);
}

/** Variables the stylesheet declares (not merely uses), each once, in order of first declaration. */
export function declaredVariables(css) {
  return [...new Set([...css.matchAll(/(--svk-[\w-]+)\s*:/g)].map((match) => match[1]))];
}

/** Classifies changes to the documented variable list: removals break, additions are additive. */
export function diffThemeVariables(previousMarkdown, currentMarkdown) {
  const previous = new Set(documentedVariables(previousMarkdown));
  const current = new Set(documentedVariables(currentMarkdown));
  return {
    breaking: [...previous].filter((name) => !current.has(name)).map((name) => `removed theme variable ${name}`),
    additive: [...current].filter((name) => !previous.has(name)).map((name) => `added theme variable ${name}`),
  };
}
