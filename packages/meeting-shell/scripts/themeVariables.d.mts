import type { ApiDiff } from "./apiDiff.mjs";

export declare function documentedVariables(markdown: string): string[];

export declare function declaredVariables(css: string): string[];

export declare function diffThemeVariables(previousMarkdown: string, currentMarkdown: string): ApiDiff;
