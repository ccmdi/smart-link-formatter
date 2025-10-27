/**
 * 
 * @param url The extracted URL.
 * @param start The start position of the replacement text in the editor.
 * @param end The end position of the replacement text in the editor.
 */
export interface Extraction {
    url: string;
    start: number;
    end: number;
}