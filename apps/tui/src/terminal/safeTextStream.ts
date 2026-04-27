type ParserState = "text" | "esc" | "csi" | "string";

const MAX_PENDING_LENGTH = 8192;

export interface SafeTextStream {
  push(chunk: string): string;
  flush(): string;
  reset(): void;
}

export function createSafeTextStream(): SafeTextStream {
  let state: ParserState = "text";
  let stringTerminator: "bel-or-st" | "st" = "bel-or-st";
  let stringEscPending = false;
  let pendingLength = 0;

  const reset = () => {
    state = "text";
    stringTerminator = "bel-or-st";
    stringEscPending = false;
    pendingLength = 0;
  };

  const parse = (chunk: string, final: boolean): string => {
    let output = "";
    let index = 0;
    const input = chunk;

    while (index < input.length) {
      const code = input.charCodeAt(index);

      if (state === "text") {
        if (code === 0x1b) {
          state = "esc";
          pendingLength = 1;
          index += 1;
          continue;
        }
        if (code === 0x9b) {
          state = "csi";
          pendingLength = 1;
          index += 1;
          continue;
        }
        if (isC1StringControl(code)) {
          state = "string";
          stringTerminator = code === 0x9d ? "bel-or-st" : "st";
          pendingLength = 1;
          index += 1;
          continue;
        }
        if (isAllowedTextCode(code)) output += input[index];
        index += 1;
        continue;
      }

      if (state === "esc") {
        if (index >= input.length) break;
        if (code === 0x5b) {
          state = "csi";
          pendingLength += 1;
          index += 1;
          continue;
        }
        if (code === 0x5d || code === 0x50 || code === 0x58 || code === 0x5e || code === 0x5f) {
          state = "string";
          stringTerminator = code === 0x5d ? "bel-or-st" : "st";
          pendingLength += 1;
          index += 1;
          continue;
        }
        if (isEscapeIntermediateByte(code)) {
          index += 1;
          pendingLength += 1;
          while (index < input.length && isEscapeIntermediateByte(input.charCodeAt(index))) {
            index += 1;
            pendingLength += 1;
          }
          if (index >= input.length) break;
        }
        state = "text";
        pendingLength = 0;
        index += 1;
        continue;
      }

      if (state === "csi") {
        const startIndex = index;
        while (index < input.length && !isCsiFinalByte(input.charCodeAt(index))) {
          index += 1;
        }
        pendingLength += index - startIndex;
        if (index >= input.length) break;
        state = "text";
        pendingLength = 0;
        index += 1;
        continue;
      }

      if (state === "string") {
        while (index < input.length) {
          if (stringEscPending) {
            stringEscPending = false;
            if (input.charCodeAt(index) === 0x5c) {
              state = "text";
              pendingLength = 0;
              index += 1;
              break;
            }
          }

          const stringCode = input.charCodeAt(index);
          if (stringTerminator === "bel-or-st" && stringCode === 0x07) {
            state = "text";
            pendingLength = 0;
            index += 1;
            break;
          }
          if (stringCode === 0x9c) {
            state = "text";
            pendingLength = 0;
            index += 1;
            break;
          }
          if (stringCode === 0x1b) {
            stringEscPending = true;
          }
          pendingLength += 1;
          index += 1;
        }
      }
    }

    if (state !== "text" && !final) {
      if (state !== "string") pendingLength += input.length - index;
      if (pendingLength > MAX_PENDING_LENGTH) reset();
    } else if (final) {
      reset();
    }

    return output;
  };

  return {
    push: (chunk) => parse(chunk, false),
    flush: () => parse("", true),
    reset,
  };
}

export function sanitizeText(value: string): string {
  const stream = createSafeTextStream();
  return stream.push(value) + stream.flush();
}

export function containsUnsafeTerminalControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x1b || code === 0x7f || (code < 0x20 && !isSafeWhitespace(code))) return true;
    if (code >= 0x80 && code <= 0x9f) return true;
  }
  return false;
}

function isCsiFinalByte(code: number): boolean {
  return code >= 0x40 && code <= 0x7e;
}

function isEscapeIntermediateByte(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

function isC1StringControl(code: number): boolean {
  return code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f;
}

function isAllowedTextCode(code: number): boolean {
  return (code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f)) || isSafeWhitespace(code);
}

function isSafeWhitespace(code: number): boolean {
  return code === 0x0a;
}
