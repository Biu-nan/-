const jsonWriteQueues = new Map();
export async function enqueueFileWrite(filePath, write) {
    const previous = jsonWriteQueues.get(filePath) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(write);
    const tracked = next.catch(() => undefined).then(() => {
        if (jsonWriteQueues.get(filePath) === tracked) {
            jsonWriteQueues.delete(filePath);
        }
    });
    jsonWriteQueues.set(filePath, tracked);
    return next;
}
//# sourceMappingURL=json-write-queue.js.map