// Angular (standalone component). CUSTOM_ELEMENTS_SCHEMA lets the template use <strevokit-meeting>; Angular binds
// [token] to the element's property and (svk-closed) to its event.
// The page asks your own backend for a join token (see backend-token.md and ../backend-api.md).
import { HttpClient } from "@angular/common/http";
import { Component, CUSTOM_ELEMENTS_SCHEMA, inject, input, signal, type OnInit } from "@angular/core";
import "@strevokit/shell";
import type { MeetingShellCloseReason, MeetingShellEventMap } from "@strevokit/shell";

// Add "node_modules/@strevokit/shell/dist/styles.css" to the "styles" array in angular.json, or import it from your
// global stylesheet with @import "@strevokit/shell/styles.css";

@Component({
  selector: "app-meeting",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (closed(); as reason) {
      <main>
        <p>The meeting has closed ({{ reason }}).</p>
        <button type="button" (click)="join()">Rejoin</button>
      </main>
    } @else if (token(); as joinToken) {
      <main class="call">
        <strevokit-meeting
          [token]="joinToken"
          realtime-url="wss://realtime.example.com"
          appearance="system"
          (svk-joined)="onJoined($event)"
          (svk-closed)="onClosed($event)"
        ></strevokit-meeting>
      </main>
    } @else {
      <p>Loading…</p>
    }
  `,
  styles: [".call { display: block; height: 100dvh; }"],
})
export class MeetingComponent implements OnInit {
  readonly meetingId = input.required<string>();
  readonly token = signal<string | null>(null);
  readonly closed = signal<MeetingShellCloseReason | null>(null);
  private readonly http = inject(HttpClient);

  ngOnInit(): void {
    this.join();
  }

  /** A join token is single-use, so every join (including a rejoin) fetches a fresh one. */
  join(): void {
    this.closed.set(null);
    this.token.set(null);
    this.http
      .post<{ token: string }>(`/api/meetings/${encodeURIComponent(this.meetingId())}/join-token`, {}, { withCredentials: true })
      .subscribe(({ token }) => this.token.set(token));
  }

  onJoined(event: Event): void {
    console.info("joined as", (event as MeetingShellEventMap["svk-joined"]).detail.role);
  }

  onClosed(event: Event): void {
    this.closed.set((event as MeetingShellEventMap["svk-closed"]).detail.reason);
  }
}
