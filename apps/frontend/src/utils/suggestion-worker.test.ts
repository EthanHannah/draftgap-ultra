/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createSuggestionWorker } from "./suggestion-worker";
import type {
    SuggestionInput,
    SuggestionRequest,
    SuggestionResponse,
} from "../workers/suggestions.types";

function setup() {
    const sent: SuggestionRequest[] = [];
    const received: SuggestionResponse[] = [];
    let terminated = false;
    const worker = {
        postMessage(message: SuggestionRequest) {
            sent.push(structuredClone(message));
        },
        onmessage: null as
            | ((event: MessageEvent<SuggestionResponse>) => void)
            | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
        terminate() {
            terminated = true;
        },
    };
    const client = createSuggestionWorker(worker, (response) =>
        received.push(response),
    );
    const input = {
        dataset: {},
        interactions: {},
        team: [[new Map(), 1]],
        enemy: [[new Map(), 1]],
        config: {},
        bans: [],
    } as unknown as SuggestionInput;
    const reply = (id: number) =>
        worker.onmessage?.(new MessageEvent<SuggestionResponse>("message", {
            data: { id, suggestions: [] },
        }));
    return {
        worker,
        client,
        input,
        sent,
        received,
        reply,
        terminated: () => terminated,
    };
}

describe("background draft recommendations", () => {
    test("coalesces rapid updates and never publishes stale results", () => {
        const { client, input, sent, received, reply } = setup();
        client.request(input);
        client.request({ ...input, bans: ["old"] });
        client.request({ ...input, bans: ["latest"] });
        expect(sent).toHaveLength(1);
        reply(1);
        expect(received).toHaveLength(0);
        expect(sent).toHaveLength(2);
        expect(sent[1].bans).toEqual(["latest"]);
        reply(3);
        expect(received.map((r) => r.id)).toEqual([3]);
    });

    test("clones datasets once and resends them after replacement", () => {
        const { client, input, sent, reply } = setup();
        client.request(input);
        expect(sent[0].datasets).toBeDefined();
        expect(sent[0].team[0][0]).toBeInstanceOf(Map);
        reply(1);
        client.request(input);
        expect(sent[1].datasets).toBeUndefined();
        reply(2);
        client.request({ ...input, interactions: { ...input.interactions } });
        expect(sent[2].datasets).toBeDefined();
    });

    test("leaving the draft discards pending work and in-flight results", () => {
        const { client, input, sent, received, reply } = setup();
        client.request(input);
        client.request(input);
        client.clear();
        reply(1);
        expect(sent).toHaveLength(1);
        expect(received).toHaveLength(0);
        client.request(input);
        reply(4);
        expect(received.map((r) => r.id)).toEqual([4]);
    });

    test("surfaces worker failures without leaving requests waiting", () => {
        const { client, worker, input, received, terminated } = setup();
        client.request(input);
        client.request(input);
        worker.onerror?.({} as ErrorEvent);
        expect(terminated()).toBe(true);
        expect(received[0]).toHaveProperty("error");
        expect(received[0].id).toBe(2);
        client.request(input);
        expect(received[1]).toHaveProperty("error");
    });

    test("disposal terminates the worker and prevents further updates", () => {
        const { client, input, received, reply, terminated } = setup();
        client.request(input);
        client.dispose();
        reply(1);
        expect(terminated()).toBe(true);
        expect(received).toHaveLength(0);
    });
});
