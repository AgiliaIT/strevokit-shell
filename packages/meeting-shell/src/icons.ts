import { html, svg, type SVGTemplateResult, type TemplateResult } from "lit";

function icon(paths: SVGTemplateResult): TemplateResult {
  return html`<svg
    class="svk-icon"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >${paths}</svg>`;
}

export const microphoneIcon = (): TemplateResult =>
  icon(svg`<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />`);

export const microphoneOffIcon = (): TemplateResult =>
  icon(
    svg`<path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.2 5.6M12 18v3M3 3l18 18" />`,
  );

export const cameraIcon = (): TemplateResult =>
  icon(svg`<rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3z" />`);

export const cameraOffIcon = (): TemplateResult =>
  icon(
    svg`<path d="M10 6h4a2 2 0 0 1 2 2v4l6-3v10l-3-1.5M16 16v.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2M3 3l18 18" />`,
  );

export const shareScreenIcon = (): TemplateResult =>
  icon(svg`<rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4M12 13V8M9 10.5L12 8l3 2.5" />`);

export const peopleIcon = (): TemplateResult =>
  icon(svg`<circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a7 7 0 0 1 4 6" />`);

export const leaveIcon = (): TemplateResult =>
  icon(svg`<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h11" />`);

export const endMeetingIcon = (): TemplateResult =>
  icon(
    svg`<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.86 19.86 0 0 1-3.12-8.68A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><line x1="2" y1="2" x2="22" y2="22" />`,
  );

export const chevronIcon = (): TemplateResult => icon(svg`<path d="M6 9l6 6 6-6" />`);

export const soundIcon = (): TemplateResult =>
  icon(svg`<path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />`);

export const warningIcon = (): TemplateResult => icon(svg`<path d="M12 3l10 18H2zM12 10v4M12 17.5v.5" />`);

export const checkIcon = (): TemplateResult => icon(svg`<path d="M5 12l5 5 9-10" />`);
