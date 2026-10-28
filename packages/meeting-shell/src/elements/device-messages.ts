import { html, nothing, type TemplateResult } from "lit";
import { LABELS, deviceCopy, shownText } from "../copy.js";
import type { DeviceKind, DeviceProblem, PerKind } from "../copy.js";
import { warningIcon } from "../icons.js";

export type DeviceProblems = PerKind<DeviceProblem | null>;

export const NO_PROBLEMS: DeviceProblems = Object.freeze({ camera: null, microphone: null });

/** ID of the message explaining a `kind` problem, for the toggle's `aria-describedby`. */
export function deviceMessageId(base: string, kind: DeviceKind): string {
  return `${base}-${kind}-message`;
}

/** The toggle's `aria-describedby` target, or `null` when the device has no problem. */
export function describedBy(base: string, problems: DeviceProblems, kind: DeviceKind): string | null {
  return problems[kind] ? deviceMessageId(base, kind) : null;
}

/**
 * Explains why each camera or microphone can't be used, in `kinds` order, with a "Try … again" button unless trying
 * again can't help (a browser without device support), and a Dismiss button. `onDismiss` gets whether the Dismiss
 * button had focus.
 */
export function deviceMessages(
  base: string,
  problems: DeviceProblems,
  kinds: readonly DeviceKind[],
  onRetry: (kind: DeviceKind) => void,
  onDismiss: (kind: DeviceKind, hadFocus: boolean) => void,
): TemplateResult | typeof nothing {
  if (!kinds.some((kind) => problems[kind])) return nothing;
  return html`<div class="svk-device-messages">
    ${kinds.map((kind) => {
      const problem = problems[kind];
      if (!problem) return nothing;
      const copy = deviceCopy(kind, problem);
      return html`<div class="svk-device-message" data-kind=${kind}>
        ${warningIcon()}
        <p class="svk-device-message-text" id=${deviceMessageId(base, kind)}>${shownText(copy)}</p>
        <div class="svk-device-message-actions">
          ${copy.retry
            ? html`<button type="button" class="svk-button svk-button-small" @click=${() => onRetry(kind)}>
                ${LABELS.tryDeviceAgain(kind)}
              </button>`
            : nothing}
          <button
            type="button"
            class="svk-button svk-button-small"
            aria-label=${LABELS.dismissDeviceMessage(kind)}
            @click=${(event: Event) => onDismiss(kind, hadFocus(event))}
          >
            ${LABELS.dismiss}
          </button>
        </div>
      </div>`;
    })}
  </div>`;
}

function hadFocus(event: Event): boolean {
  const button = event.currentTarget as HTMLElement;
  const root = button.getRootNode() as Document | ShadowRoot;
  return root.activeElement === button;
}
