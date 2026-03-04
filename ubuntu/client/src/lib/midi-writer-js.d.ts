declare module "midi-writer-js" {
  export class Track {
    addEvent(event: unknown): void;
  }
  export class NoteEvent {
    constructor(options: {
      pitch: string[];
      duration: string;
      velocity?: number;
      startTick?: number;
    });
  }
  export class ProgramChangeEvent {
    constructor(options: { instrument: number });
  }
  export class Writer {
    constructor(tracks: Track[]);
    dataUri(): string;
    buildFile(): Uint8Array;
  }
  const _default: {
    Track: typeof Track;
    NoteEvent: typeof NoteEvent;
    ProgramChangeEvent: typeof ProgramChangeEvent;
    Writer: typeof Writer;
  };
  export default _default;
}
