const hasBuffer = (typeof Buffer !== 'undefined');
const hasTextEncoder = (typeof TextEncoder !== 'undefined');

export class VSBuffer {

    static alloc(byteLength: number): VSBuffer {
        if (hasBuffer) {
            return new VSBuffer(Buffer.allocUnsafe(byteLength));
        } else {
            return new VSBuffer(new Uint8Array(byteLength));
        }
    }

    static wrap(actual: Uint8Array): VSBuffer {
        if (hasBuffer && !(Buffer.isBuffer(actual))) {
            // https://nodejs.org/dist/latest-v10.x/docs/api/buffer.html#buffer_class_method_buffer_from_arraybuffer_byteoffset_length
            // Create a zero-copy Buffer wrapper around the ArrayBuffer pointed to by the Uint8Array
            actual = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
        }
        return new VSBuffer(actual);
    }

    static fromString(source: string): VSBuffer {
        if (hasBuffer) {
            return new VSBuffer(Buffer.from(source));
        } else if (hasTextEncoder) {
            if (!textEncoder) {
                textEncoder = new TextEncoder();
            }
            return new VSBuffer(textEncoder.encode(source));
        } else {
            return new VSBuffer(strings.encodeUTF8(source));
        }
    }

    readonly buffer: Uint8Array;
    readonly byteLength: number;

    private constructor(buffer: Uint8Array) {
        this.buffer = buffer;
        this.byteLength = this.buffer.byteLength;
    }

    toString(): string {
        if (hasBuffer) {
            return this.buffer.toString();
        } else if (hasTextDecoder) {
            if (!textDecoder) {
                textDecoder = new TextDecoder();
            }
            return textDecoder.decode(this.buffer);
        } else {
            return strings.decodeUTF8(this.buffer);
        }
    }

    slice(start?: number, end?: number): VSBuffer {
        // IMPORTANT: use subarray instead of slice because TypedArray#slice
        // creates shallow copy and NodeBuffer#slice doesn't. The use of subarray
        // ensures the same, performant, behaviour.
        return new VSBuffer(this.buffer.subarray(start, end));
    }

}

export interface VSBufferReadable {

    read(): VSBuffer | null;

}

export function bufferToReadable(buffer: VSBuffer): VSBufferReadable {
    let consumed = false;

    return {
        read: () => {
            if (consumed) {
                return null;
            }

            consumed = true;

            return buffer;
        }
    };
}

