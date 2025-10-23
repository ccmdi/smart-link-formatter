export enum FailureMode {
    Alert = 'alert',
    Revert = 'revert'
}

export namespace FailureMode {
    export function format(mode: FailureMode, text: string): string {
        if (mode === FailureMode.Alert) {
            return `[Failed to fetch title](${text})`;
        } else {
            return text;
        }
    }
}