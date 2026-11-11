import { LitElement, html, nothing, type TemplateResult } from "lit";
import { AsyncDirective, directive, type ElementPart, type PartInfo, PartType } from "lit/async-directive.js";
import { LABELS } from "../copy.js";
import type { ParticipantView } from "../engine/meetingStore.js";
import { microphoneOffIcon, warningIcon } from "../icons.js";

export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return letters
    .map((word) => Array.from(word ?? "")[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

/** Plays a stream in the media element it is bound to, and lets go of it when the element leaves the page. */
class StreamSource extends AsyncDirective {
  #element: HTMLMediaElement | null = null;
  #stream: MediaStream | null = null;

  constructor(part: PartInfo) {
    super(part);
    if (part.type !== PartType.ELEMENT) throw new Error("streamSource() binds to a media element");
  }

  render(stream: MediaStream): typeof nothing {
    this.#stream = stream;
    this.#attach();
    return nothing;
  }

  override update(part: ElementPart, [stream]: [MediaStream]): typeof nothing {
    this.#element = part.element as HTMLMediaElement;
    return this.render(stream);
  }

  protected override disconnected(): void {
    if (this.#element) this.#element.srcObject = null;
  }

  protected override reconnected(): void {
    this.#attach();
  }

  #attach(): void {
    const element = this.#element;
    if (!element || element.srcObject === this.#stream) return;
    element.srcObject = this.#stream;
    void element.play().catch(() => {});
  }
}

const streamSource = directive(StreamSource);

/** A muted video playing `stream`; audio is played separately. */
export function streamVideo(stream: MediaStream, mirrored: boolean): TemplateResult {
  return html`<video
    class=${mirrored ? "svk-video svk-mirrored" : "svk-video"}
    autoplay
    playsinline
    muted
    .muted=${true}
    ${streamSource(stream)}
  ></video>`;
}

function tileName(participant: ParticipantView): string {
  return participant.isSelf ? `${participant.name} ${LABELS.you}` : participant.name;
}

function screenTileName(participant: ParticipantView): string {
  return `${tileName(participant)}, ${LABELS.sharedScreen}`;
}

/**
 * One participant's video, or their initials and name while the camera is off. With `variant` "screen" it shows the
 * participant's shared screen instead, unmirrored and without a visible name. The element is the list item.
 */
export class SvkVideoTile extends LitElement {
  static override properties = {
    participant: { attribute: false },
    variant: { attribute: false },
  };

  declare participant: ParticipantView | null;
  /** `"camera"` (the default) shows the camera; `"screen"` shows the shared screen. */
  declare variant: "camera" | "screen";

  constructor() {
    super();
    this.participant = null;
    this.variant = "camera";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-tile");
    this.setAttribute("role", "listitem");
  }

  protected override willUpdate(): void {
    const participant = this.participant;
    if (!participant) return;
    const screen = this.variant === "screen";
    this.setAttribute("aria-label", screen ? screenTileName(participant) : tileName(participant));
    this.dataset["variant"] = this.variant;
    this.dataset["connection"] = participant.connection;
  }

  protected override render(): TemplateResult | typeof nothing {
    const participant = this.participant;
    if (!participant) return nothing;
    if (this.variant === "screen") return this.#renderScreen(participant);
    const stream = participant.cameraOn ? participant.cameraStream : null;
    return html`${stream
        ? streamVideo(stream, participant.isSelf)
        : html`<div class="svk-avatar">
            <span class="svk-initials" aria-hidden="true">${initials(participant.name)}</span>
          </div>`}
      <div class="svk-tile-footer">
        <span class="svk-tile-name">${tileName(participant)}</span>
        ${participant.microphoneOn
          ? nothing
          : html`<span class="svk-badge" title=${LABELS.microphoneOffBadge}>
              ${microphoneOffIcon()}<span class="svk-visually-hidden">${LABELS.microphoneOffBadge}</span>
            </span>`}
      </div>
      ${this.#renderOverlay(participant)}`;
  }

  #renderScreen(participant: ParticipantView): TemplateResult | typeof nothing {
    const stream = participant.screenStream;
    if (!stream) return nothing;
    return streamVideo(stream, false);
  }

  #renderOverlay(participant: ParticipantView): TemplateResult | typeof nothing {
    if (participant.isSelf || participant.connection === "connected") return nothing;
    const interrupted = participant.connection === "interrupted";
    return html`<div class="svk-tile-overlay">
      ${interrupted ? warningIcon() : nothing}<span class="svk-text"
        >${interrupted ? LABELS.interrupted : LABELS.connecting}</span
      >
    </div>`;
  }
}
