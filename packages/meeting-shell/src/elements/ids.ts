let issued = 0;

/** A document-unique ID for markup the shell links with `for`, `aria-controls`, or `aria-describedby`. */
export function uniqueId(prefix: string): string {
  issued += 1;
  return `${prefix}-${issued}`;
}
