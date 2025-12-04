export enum FailureMode {
    Alert = 'alert',
    Revert = 'revert'
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace FailureMode {
    export function format(mode: FailureMode, text: string): string {
        if (mode === FailureMode.Alert) {
            return `[Failed to fetch title](${text})`;
        } else {
            return text;
        }
    }
}