import type {
    SuggestionInput,
    SuggestionRequest,
    SuggestionResponse,
} from "../workers/suggestions.types";

type WorkerPort = {
    postMessage: (message: SuggestionRequest) => void;
    onmessage: ((event: MessageEvent<SuggestionResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    terminate: () => void;
};

// Keep one calculation in flight and only the newest pending draft. Sending
// every hover to the worker would otherwise leave current results behind a queue.
export function createSuggestionWorker(
    worker: WorkerPort,
    receive: (response: SuggestionResponse) => void,
) {
    let revision = 0;
    let busy = false;
    let disposed = false;
    let failed = false;
    let pending: { id: number; input: SuggestionInput } | undefined;
    let previousDataset: SuggestionInput["dataset"] | undefined;
    let previousInteractions: SuggestionInput["interactions"] | undefined;

    function sendPending() {
        if (disposed || busy || !pending) return;
        const { id, input } = pending;
        pending = undefined;
        if (failed) {
            receive({
                id,
                error: "Recommendations could not start. Reload the app to retry.",
            });
            return;
        }
        const { dataset, interactions, ...draft } = input;
        const datasets =
            dataset !== previousDataset || interactions !== previousInteractions
                ? { dataset, interactions }
                : undefined;
        busy = true;
        try {
            worker.postMessage({ id, ...draft, datasets });
            previousDataset = dataset;
            previousInteractions = interactions;
        } catch (error) {
            busy = false;
            receive({
                id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    worker.onmessage = ({ data }) => {
        if (disposed) return;
        busy = false;
        if (data.id === revision) receive(data);
        sendPending();
    };
    worker.onerror = () => {
        if (disposed) return;
        failed = true;
        busy = false;
        pending = undefined;
        worker.terminate();
        receive({
            id: revision,
            error: "Recommendations stopped unexpectedly. Reload the app to retry.",
        });
    };

    return {
        request(input: SuggestionInput) {
            pending = { id: ++revision, input };
            sendPending();
        },
        clear() {
            revision++;
            pending = undefined;
        },
        dispose() {
            disposed = true;
            pending = undefined;
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
        },
    };
}
